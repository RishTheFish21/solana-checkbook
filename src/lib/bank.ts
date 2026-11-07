/**
 * Everything that talks to the network. Signing a check needs none of this; ordering checks,
 * depositing, and stopping payment do.
 */
import {
  airdropFactory,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  getTokenDecoder,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getInitializeInstruction,
  getNonceDecoder,
} from "../../vendor/ed25519-programmatic-signer/src/index";
import { DEMO_MINT_AUTHORITY, MINT, MINT_DECIMALS, NONCE_PROGRAM, RPC_URL, WS_URL } from "./config";
import { readCheck, signStopPayment, type ReadCheck, type SignedCheck } from "./check";
import { explainFailure, type Failure } from "./errors";
import { nextNonce, programmaticSignerAddress } from "./signer";

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

export type SendResult = { ok: true; signature: Signature } | { ok: false; failure: Failure };

/**
 * Builds, simulates, and sends. Transactions that carry a check use the v1 format, which allows
 * 4096 bytes (a check's Submit instruction alone is ~800). v1 needs explicit resource limits.
 */
export async function send(feePayer: KeyPairSigner, instructions: Instruction[], { v1 = false } = {}): Promise<SendResult> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: v1 ? 1 : 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) =>
      v1
        ? setTransactionMessageLoadedAccountsDataSizeLimit(
            4 * 1024 * 1024,
            setTransactionMessageComputeUnitLimit(400_000, m)
          )
        : m
  );
  const transaction = await signTransactionMessageWithSigners(message);

  // Simulate first: it gives us logs, which is how we tell "bounced" from "post-dated".
  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  if (simulation.value.err) {
    return {
      ok: false,
      failure: explainFailure(simulation.value.logs ?? [], JSON.stringify(simulation.value.err, bigintReplacer)),
    };
  }
  // Narrow the lifetime type for the confirmation helper.
  await sendAndConfirm(transaction as Parameters<typeof sendAndConfirm>[0], { commitment: "confirmed" });
  return { ok: true, signature: getSignatureFromTransaction(transaction) };
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

// ---------- identity ----------

const SEED_KEY = "checkbook.secret";

/**
 * This browser's key. It is both the account holder's identity (checks are paid to it) and the
 * key that signs checks. Kept in localStorage: fine for a devnet demo, not for real money.
 */
export async function loadIdentity(): Promise<KeyPairSigner> {
  let stored = localStorage.getItem(SEED_KEY);
  if (!stored) {
    stored = JSON.stringify([...crypto.getRandomValues(new Uint8Array(32))]);
    localStorage.setItem(SEED_KEY, stored);
  }
  return createKeyPairSignerFromPrivateKeyBytes(Uint8Array.from(JSON.parse(stored)));
}

// ---------- balances ----------

export async function checkingAddress(owner: Address, mint = requireMint()): Promise<Address> {
  const pda = await programmaticSignerAddress(owner);
  const [ata] = await findAssociatedTokenPda({ owner: pda, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export async function walletAddress(owner: Address, mint = requireMint()): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export async function tokenBalance(account: Address): Promise<bigint | undefined> {
  const acc = await fetchEncodedAccount(rpc, account, { commitment: "confirmed" });
  if (!acc.exists) return undefined;
  return getTokenDecoder().decode(acc.data).amount;
}

export async function solBalance(owner: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(owner, { commitment: "confirmed" }).send();
  return value;
}

export type Balances = { sol: bigint; checking?: bigint; wallet?: bigint };

export async function balances(owner: Address): Promise<Balances> {
  const [sol, checking, wallet] = await Promise.all([
    solBalance(owner),
    MINT ? checkingAddress(owner).then(tokenBalance) : Promise.resolve(undefined),
    MINT ? walletAddress(owner).then(tokenBalance) : Promise.resolve(undefined),
  ]);
  return { sol, checking, wallet };
}

export function requireMint(): Address {
  if (!MINT) throw new Error("No currency set up yet. Run `npm run setup:mint`, then restart the app.");
  return MINT;
}

// ---------- setup ----------

export async function requestAirdrop(owner: Address): Promise<void> {
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  await airdrop({ recipientAddress: owner, lamports: lamports(1_000_000_000n), commitment: "confirmed" });
}

/** Creates this person's wallet and checking token accounts. Safe to run twice. */
export async function openAccounts(me: KeyPairSigner): Promise<SendResult> {
  const mint = requireMint();
  const pda = await programmaticSignerAddress(me.address);
  return send(me, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: me,
      ata: await walletAddress(me.address),
      owner: me.address,
      mint,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: me,
      ata: await checkingAddress(me.address),
      owner: pda,
      mint,
    }),
  ]);
}

export type BlankCheck = { number: number; nonceAccount: Address; nonce: Address };

/**
 * "Order checks": creates `count` nonce accounts controlled by your checking account. Each one is
 * a blank check: it can be written (signed) offline, and used exactly once.
 * Costs about 0.0014 SOL of rent per check.
 */
export async function orderChecks(me: KeyPairSigner, count: number, firstNumber: number): Promise<BlankCheck[]> {
  const pda = await programmaticSignerAddress(me.address);
  const space = BigInt(getNonceDecoder().fixedSize);
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
  const accounts = await Promise.all(Array.from({ length: count }, () => generateKeyPairSigner()));

  // Two checks per transaction keeps each one comfortably under the size limit.
  for (let i = 0; i < accounts.length; i += 2) {
    const instructions: Instruction[] = [];
    for (const account of accounts.slice(i, i + 2)) {
      instructions.push(
        getCreateAccountInstruction({ payer: me, newAccount: account, lamports: rent, space, programAddress: NONCE_PROGRAM }),
        getInitializeInstruction({ nonceAccount: account.address, authority: pda }, { programAddress: NONCE_PROGRAM })
      );
    }
    const result = await send(me, instructions);
    if (!result.ok) throw new Error(`Ordering checks failed: ${result.failure.detail}`);
  }
  const blanks: BlankCheck[] = [];
  for (const [i, account] of accounts.entries()) {
    blanks.push({ number: firstNumber + i, nonceAccount: account.address, nonce: await storedNonce(account.address) });
  }
  return blanks;
}

export async function storedNonce(nonceAccount: Address): Promise<Address> {
  const acc = await fetchEncodedAccount(rpc, nonceAccount, { commitment: "confirmed" });
  if (!acc.exists) throw new Error("That check's nonce account doesn't exist.");
  return getNonceDecoder().decode(acc.data).nonce;
}

/** Hands out demo dollars from the devnet demo mint into your checking account. */
export async function getDemoDollars(me: KeyPairSigner, wholeDollars: number): Promise<SendResult> {
  if (!DEMO_MINT_AUTHORITY) throw new Error("Demo dollars aren't set up. Run `npm run setup:mint`.");
  const authority = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(DEMO_MINT_AUTHORITY)));
  const mint = requireMint();
  return send(me, [
    getMintToInstruction({
      mint,
      token: await checkingAddress(me.address),
      mintAuthority: authority,
      amount: BigInt(wholeDollars) * 10n ** BigInt(MINT_DECIMALS),
    }),
  ]);
}

/** Moves money you received (wallet) into checking, so you can write checks against it. */
export async function moveToChecking(me: KeyPairSigner, amount: bigint): Promise<SendResult> {
  const mint = requireMint();
  return send(me, [
    getTransferCheckedInstruction({
      source: await walletAddress(me.address),
      mint,
      destination: await checkingAddress(me.address),
      authority: me,
      amount,
      decimals: MINT_DECIMALS,
    }),
  ]);
}

// ---------- deposit, stop payment, status ----------

export type CheckStatus = "outstanding" | "cashed" | "stopped";

/** Reads the check's nonce account: unchanged means outstanding; moved by this check means cashed. */
export async function checkStatus(nonceAccount: Address, nonce: Address, executionMessage: Uint8Array): Promise<CheckStatus> {
  const current = await storedNonce(nonceAccount);
  if (current === nonce) return "outstanding";
  if (current === (await nextNonce(nonceAccount, nonce, executionMessage))) return "cashed";
  return "stopped";
}

export async function prepareDeposit(encoded: string): Promise<{ check: ReadCheck; status: CheckStatus }> {
  const check = await readCheck(encoded);
  const status = await checkStatus(check.nonceAccount, check.nonce, check.executionMessage);
  return { check, status };
}

/** Deposits a check. `me` pays the network fee and, if needed, opens the payee's token account. */
export async function deposit(me: KeyPairSigner, check: ReadCheck): Promise<SendResult> {
  return send(
    me,
    [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: me,
        ata: check.destination,
        owner: check.payee,
        mint: check.mint,
      }),
      check.submit,
    ],
    { v1: true }
  );
}

/** Voids a check you wrote by spending its nonce on an empty payload. */
export async function stopPayment(me: KeyPairSigner, check: SignedCheck): Promise<SendResult> {
  const stop = await signStopPayment(check, me.keyPair.privateKey);
  return send(me, [stop.submit], { v1: true });
}
