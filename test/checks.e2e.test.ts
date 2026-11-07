/**
 * End-to-end: every check outcome, run against the real program binaries in LiteSVM.
 *
 * Needs the program .so files in programs/fixtures (run `bash scripts/dump-programs.sh` once).
 * Covers: deposit, double-deposit, post-dated (rejected early, accepted later), bounce then
 * redeposit, stop payment, status detection, and tamper detection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  getInitializeInstruction,
  getNonceDecoder,
} from "../vendor/ed25519-programmatic-signer/src/index";
import {
  EXECUTOR_PROGRAM,
  LIGHTHOUSE_PROGRAM,
  NONCE_PROGRAM,
  SIGNER_PROGRAM,
} from "../src/lib/config";
import {
  encodeCheck,
  readCheck,
  signCheck,
  signStopPayment,
  type CheckLabels,
} from "../src/lib/check";
import { explainFailure } from "../src/lib/errors";
import { nextNonce, programmaticSignerAddress } from "../src/lib/signer";

const FIXTURES = process.env.FIXTURES_DIR ?? join(import.meta.dirname, "..", "programs", "fixtures");
const files = {
  signer: join(FIXTURES, "spl_ed25519_signer_program.so"),
  executor: join(FIXTURES, "spl_message_executor_program.so"),
  nonce: join(FIXTURES, "spl_nonce_program.so"),
  lighthouse: join(FIXTURES, "lighthouse.so"),
};
const missing = Object.values(files).filter((f) => !existsSync(f));

const DECIMALS = 6;
// LiteSVM does not ship the Memo program, so checks in this test skip the memo instruction.
const NO_MEMO = { memo: false };
const dollars = (n: number) => BigInt(Math.round(n * 100)) * 10_000n;

type Result = { ok: true; logs: string[] } | { ok: false; logs: string[] };

function makeHarness() {
  const svm = new LiteSVM();
  svm.addProgramFromFile(SIGNER_PROGRAM, files.signer);
  svm.addProgramFromFile(EXECUTOR_PROGRAM, files.executor);
  svm.addProgramFromFile(NONCE_PROGRAM, files.nonce);
  svm.addProgramFromFile(LIGHTHOUSE_PROGRAM, files.lighthouse);

  const setTime = (unix: number) => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(unix)));
  };

  const send = async (feePayer: KeyPairSigner, ixs: Instruction[], version: 0 | 1 = 0): Promise<Result> => {
    svm.expireBlockhash();
    const message = pipe(
      createTransactionMessage({ version }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
      (m) => (version === 1 ? setTransactionMessageLoadedAccountsDataSizeLimit(4 * 1024 * 1024, setTransactionMessageComputeUnitLimit(400_000, m)) : m)
    );
    const tx = await signTransactionMessageWithSigners(message);
    const result = svm.sendTransaction(tx);
    if (result instanceof FailedTransactionMetadata) { const logs = result.meta().logs(); if (!logs.length) logs.push(`tx error: ${result.toString()}`); return { ok: false, logs }; }
    return { ok: true, logs: result.logs() };
  };

  const tokenBalance = (account: Address) => {
    const acc = svm.getAccount(account);
    if (!acc.exists) return 0n;
    return getTokenDecoder().decode(acc.data).amount;
  };

  const storedNonce = (account: Address): Address => {
    const acc = svm.getAccount(account);
    assert.ok(acc.exists, "nonce account exists");
    return getNonceDecoder().decode(acc.data).nonce;
  };

  return { svm, setTime, send, tokenBalance, storedNonce };
}

test("checks: deposit, post-date, bounce, stop payment, tamper", { skip: missing.length ? `missing fixtures: ${missing.join(", ")}` : false }, async () => {
  const h = makeHarness();
  const now = 1_762_400_000;
  h.setTime(now);

  const bank = await generateKeyPairSigner(); // mint authority + pays setup
  const writer = await generateKeyPairSigner();
  const payee = await generateKeyPairSigner();
  for (const s of [bank, writer, payee]) h.svm.airdrop(s.address, lamports(5_000_000_000n));

  // Demo mint, writer's checking account (PDA's token account) with $100.
  const mint = await generateKeyPairSigner();
  const pda = await programmaticSignerAddress(writer.address);
  const [checking] = await findAssociatedTokenPda({ owner: pda, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [payeeAta] = await findAssociatedTokenPda({ owner: payee.address, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const mintRent = h.svm.minimumBalanceForRentExemption(BigInt(getMintSize()));
  let r = await h.send(bank, [
    getCreateAccountInstruction({ payer: bank, newAccount: mint, lamports: mintRent, space: getMintSize(), programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: DECIMALS, mintAuthority: bank.address }),
    getCreateAssociatedTokenIdempotentInstruction({ payer: bank, ata: checking, owner: pda, mint: mint.address }),
    getMintToInstruction({ mint: mint.address, token: checking, mintAuthority: bank, amount: dollars(100) }),
  ]);
  assert.ok(r.ok, `setup failed:\n${r.logs.join("\n")}`);

  // "Order checks": four nonce accounts whose authority is the writer's PDA.
  const nonceSize = BigInt(getNonceDecoder().fixedSize);
  const blanks: Address[] = [];
  for (let i = 0; i < 4; i++) {
    const acct = await generateKeyPairSigner();
    r = await h.send(writer, [
      getCreateAccountInstruction({ payer: writer, newAccount: acct, lamports: h.svm.minimumBalanceForRentExemption(nonceSize), space: nonceSize, programAddress: NONCE_PROGRAM }),
      getInitializeInstruction({ nonceAccount: acct.address, authority: pda }, { programAddress: NONCE_PROGRAM }),
    ]);
    assert.ok(r.ok, `order checks failed:\n${r.logs.join("\n")}`);
    blanks.push(acct.address);
  }

  const labels = (n: number, amount: bigint, extra: Partial<CheckLabels> = {}): CheckLabels => ({
    number: 1000 + n,
    writer: writer.address,
    payee: payee.address,
    amount,
    decimals: DECIMALS,
    mint: mint.address,
    memo: "",
    writtenAt: now,
    nonceAccount: blanks[n],
    nonce: h.storedNonce(blanks[n]),
    ...extra,
  });

  // Payee deposits: creates their token account if needed, then submits. Payee pays the fee.
  const deposit = async (encoded: string, { allowProblems = false } = {}) => {
    const read = await readCheck(encoded);
    if (!allowProblems) assert.deepEqual(read.problems, []);
    return h.send(payee, [
      getCreateAssociatedTokenIdempotentInstruction({ payer: payee, ata: payeeAta, owner: payee.address, mint: mint.address }),
      read.submit,
    ], 1);
  };

  // 1) A plain check for $25: clears.
  const checkA = await signCheck(labels(0, dollars(25), { memo: "Pizza" }), writer.keyPair.privateKey, NO_MEMO);
  const encodedA = encodeCheck(checkA);
  r = await deposit(encodedA);
  assert.ok(r.ok, `deposit A failed:\n${r.logs.join("\n")}`);
  assert.equal(h.tokenBalance(payeeAta), dollars(25));
  assert.equal(h.tokenBalance(checking), dollars(75));
  // Status: nonce moved to exactly the successor of A's execution message, so "cashed".
  assert.equal(h.storedNonce(blanks[0]), await nextNonce(blanks[0], checkA.nonce, checkA.executionMessage));

  // 2) Depositing A again fails as "used".
  r = await deposit(encodedA);
  assert.ok(!r.ok);
  assert.equal(explainFailure(r.logs).kind, "used");

  // 3) Post-dated one hour out: rejected now, nonce untouched, accepted after the date.
  const checkB = await signCheck(labels(1, dollars(10), { notBefore: now + 3600, memo: "Rent" }), writer.keyPair.privateKey, NO_MEMO);
  const nonceBBefore = h.storedNonce(blanks[1]);
  r = await deposit(encodeCheck(checkB));
  assert.ok(!r.ok);
  assert.equal(explainFailure(r.logs).kind, "too-early");
  assert.equal(h.storedNonce(blanks[1]), nonceBBefore, "a failed deposit leaves the check usable");
  h.setTime(now + 3601);
  r = await deposit(encodeCheck(checkB));
  assert.ok(r.ok, `deposit B after date failed:\n${r.logs.join("\n")}`);
  assert.equal(h.tokenBalance(payeeAta), dollars(35));

  // 4) $500 against a $65 balance: bounces, stays valid, clears after a top-up.
  const checkC = await signCheck(labels(2, dollars(500)), writer.keyPair.privateKey, NO_MEMO);
  r = await deposit(encodeCheck(checkC));
  assert.ok(!r.ok);
  assert.equal(explainFailure(r.logs).kind, "bounced");
  r = await h.send(bank, [getMintToInstruction({ mint: mint.address, token: checking, mintAuthority: bank, amount: dollars(500) })]);
  assert.ok(r.ok);
  r = await deposit(encodeCheck(checkC));
  assert.ok(r.ok, `redeposit C failed:\n${r.logs.join("\n")}`);
  assert.equal(h.tokenBalance(payeeAta), dollars(535));

  // 5) Stop payment on D, then the deposit fails as "used" and status reads "stopped".
  const checkD = await signCheck(labels(3, dollars(5)), writer.keyPair.privateKey, NO_MEMO);
  const stop = await signStopPayment(checkD, writer.keyPair.privateKey);
  r = await h.send(writer, [stop.submit], 1);
  assert.ok(r.ok, `stop payment failed:\n${r.logs.join("\n")}`);
  r = await deposit(encodeCheck(checkD));
  assert.ok(!r.ok);
  assert.equal(explainFailure(r.logs).kind, "used");
  const afterStop = h.storedNonce(blanks[3]);
  assert.notEqual(afterStop, checkD.nonce);
  assert.notEqual(afterStop, await nextNonce(blanks[3], checkD.nonce, checkD.executionMessage));
  assert.equal(h.tokenBalance(payeeAta), dollars(535), "stopped check paid nothing");

  // 6) Tampering is caught before any transaction is sent.
  //    a) Swapping the payee shown on the check: the signed destination doesn't match.
  const thief = await generateKeyPairSigner();
  const swapped = encodeCheck({ ...checkA, payee: thief.address });
  const readSwapped = await readCheck(swapped);
  assert.ok(readSwapped.problems.some((p) => p.includes("payee")));
  assert.equal(readSwapped.destination, payeeAta, "money would still go to the real payee");
  //    b) Editing the signed bytes (the amount) breaks the signature.
  const forged = { ...checkA, submitData: Uint8Array.from(checkA.submitData) };
  const amountBytes = new Uint8Array(new BigUint64Array([dollars(25)]).buffer);
  const at = findSubarray(forged.submitData, amountBytes);
  assert.ok(at >= 0, "found the amount in the signed bytes");
  forged.submitData[at + 1] ^= 0xff;
  const readForged = await readCheck(encodeCheck(forged));
  assert.equal(readForged.signatureValid, false);
  assert.ok(readForged.problems.some((p) => p.includes("signature")));
  r = await deposit(encodeCheck(forged), { allowProblems: true });
  assert.ok(!r.ok, "the signer program rejects a forged check on-chain too");
  assert.equal(explainFailure(r.logs).kind, "bad-signature");

  // 7) Status reads back from the chain alone.
  const readA = await readCheck(encodedA);
  assert.equal(readA.writer, writer.address);
  assert.equal(readA.amount, dollars(25));
  assert.equal(readA.memo, "Pizza");
});

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
