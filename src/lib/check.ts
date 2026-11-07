/**
 * A check is a presigned Signer.Submit instruction plus human-readable labels.
 *
 * The labels are only for display while writing. On deposit, `readCheck` decodes the signed bytes
 * and reports what the signature actually authorizes, and flags any label that disagrees.
 */
import {
  createDecoderThatConsumesEntireByteArray,
  getAddressDecoder,
  getAddressEncoder,
  createNoopSigner,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getU64Decoder,
  getI64Decoder,
  getI64Encoder,
  verifySignature,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type SignatureBytes,
} from "@solana/kit";
import { getAddMemoInstruction, MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getExecuteInstructionDataDecoder,
  getSubmitInstruction,
  getSubmitInstructionDataDecoder,
} from "../../vendor/ed25519-programmatic-signer/src/index";
import { LIGHTHOUSE_PROGRAM } from "./config";
import { presign, programmaticSignerAddress } from "./signer";

export type CheckLabels = {
  number: number;
  writer: Address;
  payee: Address;
  /** Base units of the mint (for 6 decimals, 1_000_000n is 1.00). */
  amount: bigint;
  decimals: number;
  mint: Address;
  memo: string;
  /** Unix seconds when the check was written. */
  writtenAt: number;
  /** Unix seconds before which the check cannot be deposited. Omitted for checks payable now. */
  notBefore?: number;
  nonceAccount: Address;
  /** The nonce this check consumes. */
  nonce: Address;
};

export type SignedCheck = CheckLabels & {
  /** Signer.Submit instruction data: the writer's signature and the authorization message. */
  submitData: Uint8Array;
  /** The inner execution message, kept so the writer can tell "cashed" from "stopped". */
  executionMessage: Uint8Array;
};

// ---------- building ----------

const ASSERT_SYSVAR_CLOCK = 15;
const LOG_LEVEL_SILENT = 0;
const CLOCK_UNIX_TIMESTAMP = 4;
const GREATER_THAN_OR_EQUAL = 4;
const TRANSFER_CHECKED = 12;

/** Lighthouse instruction that fails while the cluster clock is earlier than `unixSeconds`. */
export function assertNotBeforeInstruction(unixSeconds: number): Instruction {
  const data = new Uint8Array(12);
  data.set([ASSERT_SYSVAR_CLOCK, LOG_LEVEL_SILENT, CLOCK_UNIX_TIMESTAMP]);
  data.set(getI64Encoder().encode(BigInt(unixSeconds)), 3);
  data[11] = GREATER_THAN_OR_EQUAL;
  return { programAddress: LIGHTHOUSE_PROGRAM, accounts: [], data };
}

export type SignOptions = {
  /** Adds an on-chain memo ("Check #1001: Rent") so the explorer shows what it was for. */
  memo?: boolean;
};

/** The instructions a check runs when deposited. */
export async function checkPayload(labels: CheckLabels, options: SignOptions = {}): Promise<Instruction[]> {
  const pda = await programmaticSignerAddress(labels.writer);
  const tokenProgram = TOKEN_PROGRAM_ADDRESS;
  const [source] = await findAssociatedTokenPda({ owner: pda, mint: labels.mint, tokenProgram });
  const [destination] = await findAssociatedTokenPda({
    owner: labels.payee,
    mint: labels.mint,
    tokenProgram,
  });
  const payload: Instruction[] = [];
  if (labels.notBefore) payload.push(assertNotBeforeInstruction(labels.notBefore));
  payload.push(
    getTransferCheckedInstruction({
      source,
      mint: labels.mint,
      destination,
      authority: createNoopSigner(pda),
      amount: labels.amount,
      decimals: labels.decimals,
    })
  );
  if (options.memo ?? true) payload.push(getAddMemoInstruction({ memo: memoText(labels) }));
  return payload;
}

function memoText(labels: CheckLabels): string {
  const base = `Check #${labels.number}`;
  return labels.memo ? `${base}: ${labels.memo}`.slice(0, 80) : base;
}

/** Signs a check offline. `privateKey` belongs to `labels.writer`. */
export async function signCheck(
  labels: CheckLabels,
  privateKey: CryptoKey,
  options: SignOptions = {}
): Promise<SignedCheck> {
  const payload = await checkPayload(labels, options);
  const presigned = await presign(labels.writer, privateKey, labels.nonceAccount, labels.nonce, payload);
  return {
    ...labels,
    submitData: Uint8Array.from(presigned.submit.data ?? []),
    executionMessage: Uint8Array.from(presigned.executionMessage),
  };
}

/** Signs the "void" payload that stops payment: an empty execution at the same nonce. */
export async function signStopPayment(check: CheckLabels, privateKey: CryptoKey) {
  return presign(check.writer, privateKey, check.nonceAccount, check.nonce, []);
}

// ---------- encoding (QR / link) ----------
//
// Binary layout, then base64url once (keeps the QR code scannable):
//   u8 version | u32 check number | 32B payee | i64 writtenAt | u8 memo length | memo utf8 | Submit data
// Everything else (writer, amount, date, nonce...) is read back out of the signed Submit data, so
// the only unsigned fields are the payee's wallet (checked against the signed destination), the
// check number, the memo, and the written date.

const WIRE_VERSION = 1;
const addressCodec = { enc: getAddressEncoder(), dec: getAddressDecoder() };

export function encodeCheck(check: SignedCheck): string {
  const memo = new TextEncoder().encode(check.memo).slice(0, 80);
  const out = new Uint8Array(1 + 4 + 32 + 8 + 1 + memo.length + check.submitData.length);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = WIRE_VERSION;
  view.setUint32(o, check.number, true);
  o += 4;
  out.set(addressCodec.enc.encode(check.payee), o);
  o += 32;
  view.setBigInt64(o, BigInt(check.writtenAt), true);
  o += 8;
  out[o++] = memo.length;
  out.set(memo, o);
  o += memo.length;
  out.set(check.submitData, o);
  return toBase64Url(out);
}

type Unsigned = { number: number; payee: Address; writtenAt: number; memo: string; submitData: Uint8Array };

function decodeWire(encoded: string): Unsigned {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(extractPayload(encoded));
  } catch {
    throw new Error("That isn't a check. Scan the QR code on a check, or paste its link.");
  }
  if (bytes.length < 50) throw new Error("That isn't a check. Scan the QR code on a check, or paste its link.");
  if (bytes[0] !== WIRE_VERSION) throw new Error("This check was made by a different version of the app.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 1;
  const number = view.getUint32(o, true);
  o += 4;
  const payee = addressCodec.dec.decode(bytes.slice(o, o + 32));
  o += 32;
  const writtenAt = Number(view.getBigInt64(o, true));
  o += 8;
  const memoLength = bytes[o++];
  const memo = new TextDecoder().decode(bytes.slice(o, o + memoLength));
  o += memoLength;
  return { number, payee, writtenAt, memo, submitData: bytes.slice(o) };
}

/** Accepts a bare payload, a full link, or a link with `#deposit=...`. */
function extractPayload(input: string): string {
  const trimmed = input.trim();
  const marker = trimmed.indexOf("deposit=");
  return marker >= 0 ? trimmed.slice(marker + "deposit=".length) : trimmed;
}

export function checkLink(encoded: string, origin: string): string {
  return `${origin}/#deposit=${encoded}`;
}

// ---------- reading what the signature actually authorizes ----------

export type ReadCheck = {
  /** Decoded from the signed bytes: this is exactly what a deposit will do. */
  writer: Address;
  writerChecking: Address;
  nonceAccount: Address;
  nonce: Address;
  amount: bigint;
  decimals: number;
  mint: Address;
  destination: Address;
  notBefore?: number;
  signedMemo?: string;
  /** Not signed: shown for convenience, and `payee` is checked against `destination`. */
  number: number;
  payee: Address;
  memo: string;
  writtenAt: number;
  signatureValid: boolean;
  /** Plain-language problems. Empty when the check is safe to show and deposit. */
  problems: string[];
  submit: Instruction;
  executionMessage: Uint8Array;
};

const compiledDecoder = createDecoderThatConsumesEntireByteArray(getCompiledTransactionMessageDecoder());

type DecodedV1 = {
  version: 1;
  staticAccounts: Address[];
  lifetimeToken: string;
  instructionHeaders: { programAccountIndex: number }[];
  instructionPayloads: { instructionAccountIndices: number[]; instructionData: ReadonlyUint8Array }[];
};

function decodeV1(bytes: ReadonlyUint8Array): DecodedV1 {
  const message = compiledDecoder.decode(bytes) as unknown as DecodedV1 & { version: unknown };
  if (message.version !== 1) throw new Error("Unsupported message version inside the check.");
  return message;
}

export async function readCheck(encoded: string): Promise<ReadCheck> {
  const wire = decodeWire(encoded);
  let submitArgs, authorization, execution, executionBytes;
  try {
    submitArgs = getSubmitInstructionDataDecoder().decode(wire.submitData);
    authorization = decodeV1(submitArgs.message);
    const executorPayload = authorization.instructionPayloads[0];
    executionBytes = getExecuteInstructionDataDecoder().decode(executorPayload.instructionData).message;
    execution = decodeV1(executionBytes);
  } catch {
    throw new Error("This check is damaged. Ask the writer to send it again.");
  }
  const writer = authorization.staticAccounts[0];
  const executorPayload = authorization.instructionPayloads[0];
  const nonceAccount = authorization.staticAccounts[executorPayload.instructionAccountIndices[1]];

  const signatureOption = submitArgs.signatures[0];
  let signatureValid = false;
  if (signatureOption && signatureOption.__option === "Some") {
    try {
      signatureValid = await verifySignature(
        await getPublicKeyFromAddress(writer),
        signatureOption.value as SignatureBytes,
        submitArgs.message
      );
    } catch {
      signatureValid = false;
    }
  }

  let transfer: { amount: bigint; decimals: number; source: Address; mint: Address; destination: Address } | undefined;
  let notBefore: number | undefined;
  let signedMemo: string | undefined;
  let unexpected = 0;
  execution.instructionHeaders.forEach((header, i) => {
    const program = execution.staticAccounts[header.programAccountIndex];
    const { instructionData: data, instructionAccountIndices: idx } = execution.instructionPayloads[i];
    if (program === TOKEN_PROGRAM_ADDRESS && data[0] === TRANSFER_CHECKED && !transfer) {
      transfer = {
        amount: getU64Decoder().decode(data.slice(1, 9)),
        decimals: data[9],
        source: execution.staticAccounts[idx[0]],
        mint: execution.staticAccounts[idx[1]],
        destination: execution.staticAccounts[idx[2]],
      };
    } else if (program === LIGHTHOUSE_PROGRAM && data[0] === ASSERT_SYSVAR_CLOCK && data[2] === CLOCK_UNIX_TIMESTAMP) {
      notBefore = Number(getI64Decoder().decode(data.slice(3, 11)));
    } else if (program === MEMO_PROGRAM_ADDRESS) {
      signedMemo = new TextDecoder().decode(data as Uint8Array);
    } else {
      unexpected++;
    }
  });
  if (!transfer) throw new Error("This check doesn't contain a payment.");

  const problems: string[] = [];
  if (!signatureValid) problems.push("The writer's signature doesn't match this check. It may have been altered.");
  if (unexpected) problems.push("This check contains instructions other than a payment.");
  const [payeeAccount] = await findAssociatedTokenPda({
    owner: wire.payee,
    mint: transfer.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  if (payeeAccount !== transfer.destination) problems.push("The payee shown is not the account this check pays.");
  const writerPda = await programmaticSignerAddress(writer);
  const [writerChecking] = await findAssociatedTokenPda({
    owner: writerPda,
    mint: transfer.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  if (writerChecking !== transfer.source) problems.push("This check draws on an account the writer doesn't control.");

  const submit = getSubmitInstruction({
    signatures: submitArgs.signatures.map((s) => (s.__option === "Some" ? s.value : null)),
    message: submitArgs.message,
  });

  return {
    writer,
    writerChecking,
    nonceAccount,
    nonce: execution.lifetimeToken as Address,
    amount: transfer.amount,
    decimals: transfer.decimals,
    mint: transfer.mint,
    destination: transfer.destination,
    notBefore,
    signedMemo,
    number: wire.number,
    payee: wire.payee,
    memo: wire.memo,
    writtenAt: wire.writtenAt,
    signatureValid,
    problems,
    submit,
    executionMessage: Uint8Array.from(executionBytes),
  };
}

// ---------- helpers ----------

export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const cents = ((abs % base) * 100n) / base;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeText}.${cents.toString().padStart(2, "0")}`;
}

export function parseAmount(text: string, decimals: number): bigint {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) throw new Error("Enter an amount like 25 or 25.50.");
  const [whole, frac = ""] = clean.split(".");
  const base = 10n ** BigInt(decimals);
  const amount = BigInt(whole) * base + (BigInt(frac.padEnd(2, "0")) * base) / 100n;
  if (amount <= 0n) throw new Error("The amount must be more than zero.");
  return amount;
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
  const rest = n % 100;
  if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(" ");
}

/** "One hundred twenty-five and 50/100", the way a check spells it out. */
export function amountInWords(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  let whole = Number(amount / base);
  const cents = Number(((amount % base) * 100n) / base);
  if (whole === 0) return `Zero and ${String(cents).padStart(2, "0")}/100`;
  const scales = ["", " thousand", " million", " billion"];
  const chunks: string[] = [];
  for (let i = 0; whole > 0 && i < scales.length; i++) {
    const chunk = whole % 1000;
    if (chunk) chunks.unshift(under1000(chunk) + scales[i]);
    whole = Math.floor(whole / 1000);
  }
  const words = chunks.join(" ");
  return `${words[0].toUpperCase()}${words.slice(1)} and ${String(cents).padStart(2, "0")}/100`;
}

export function toBase64Url(bytes: ReadonlyUint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
