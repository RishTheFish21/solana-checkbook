/**
 * Offline signing for Anza's Ed25519 Programmatic Signer.
 *
 * How a check moves money, from the inside out:
 *
 *   execution message      v1 message holding the real instructions (the token transfer).
 *                          Its "blockhash" slot holds the check's nonce instead.
 *   Executor.Execute       instruction that consumes that nonce, then runs the execution message.
 *   authorization message  v1 message wrapping the Execute instruction. The check writer's key
 *                          signs THIS, offline. No blockhash, so the signature never expires.
 *   Signer.Submit          instruction carrying the signature + authorization message. Anyone can
 *                          put it in a normal transaction and pay the fee: that is "depositing".
 *
 * The signer program verifies the signature, then lets the writer's programmatic-signer PDA
 * (their "checking account") act as a signer for the transfer.
 *
 * The authorization-message layout is a port of `signer/client/src/message.rs` from
 * github.com/solana-program/ed25519-programmatic-signer (Apache-2.0).
 */
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransactionMessage,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getCompiledTransactionMessageEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  type Address,
  type Blockhash,
  type CompiledTransactionMessage,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";
import {
  findProgrammaticSignerPda,
  getExecuteInstruction,
  getSubmitInstruction,
} from "../../vendor/ed25519-programmatic-signer/src/index";
import { EXECUTOR_PROGRAM, NONCE_PROGRAM, SIGNER_PROGRAM } from "./config";

const messageEncoder = getCompiledTransactionMessageEncoder();
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

/** Authorization messages carry no lifetime; the system program id is the all-zero value. */
const ZERO_LIFETIME = "11111111111111111111111111111111" as Blockhash;
const NONCE_STEP_TAG = new TextEncoder().encode("spl-nonce::step::v1");

/** The programmatic-signer PDA for `authority`. It holds funds and has no private key. */
export async function programmaticSignerAddress(authority: Address): Promise<Address> {
  const [pda] = await findProgrammaticSignerPda({ authority }, { programAddress: SIGNER_PROGRAM });
  return pda;
}

/** Compiles `payload` as a v1 message with the nonce sitting where a blockhash would go. */
export function compileExecutionMessage(
  pda: Address,
  nonce: Address,
  payload: Instruction[]
): ReadonlyUint8Array {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(pda, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: nonce as string as Blockhash, lastValidBlockHeight: 0n },
        m
      ),
    (m) => appendTransactionMessageInstructions(payload, m)
  );
  return messageEncoder.encode(compileTransactionMessage(message));
}

/**
 * Builds the message the authority signs, for one authority.
 *
 * Account order: authority (writable signer slot), executor writable accounts, the executor
 * program id, then executor readonly accounts. Signer flags on the executor's accounts are
 * dropped: signer privilege comes only from PDA promotion inside the signer program.
 */
export function compileAuthorizationMessage(
  authority: Address,
  executorIx: Instruction
): ReadonlyUint8Array {
  const metas = executorIx.accounts ?? [];
  const isWritable = (role: AccountRole) =>
    role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;

  const writable: Address[] = [];
  const readonly: Address[] = [];
  for (const meta of metas) {
    if (meta.address === authority || meta.address === executorIx.programAddress) continue;
    const bucket = isWritable(meta.role) ? writable : readonly;
    if (!bucket.includes(meta.address)) bucket.push(meta.address);
  }
  // A writable occurrence wins over any readonly one.
  const readonlyOnly = readonly.filter((a) => !writable.includes(a));
  const staticAccounts = [authority, ...writable, executorIx.programAddress, ...readonlyOnly];
  const indexOf = (a: Address) => staticAccounts.indexOf(a);
  const data = executorIx.data ?? new Uint8Array();

  const message = {
    version: 1,
    header: {
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: readonlyOnly.length + 1,
    },
    configMask: 0,
    configValues: [],
    lifetimeToken: ZERO_LIFETIME,
    numInstructions: 1,
    numStaticAccounts: staticAccounts.length,
    staticAccounts,
    instructionHeaders: [
      {
        programAccountIndex: indexOf(executorIx.programAddress),
        numInstructionAccounts: metas.length,
        numInstructionDataBytes: data.length,
      },
    ],
    instructionPayloads: [
      {
        instructionAccountIndices: metas.map((m) => indexOf(m.address)),
        instructionData: data,
      },
    ],
  } as unknown as CompiledTransactionMessage;
  return messageEncoder.encode(message);
}

export type Presigned = {
  /** The Signer.Submit instruction. Put it in any transaction to execute the payload. */
  submit: Instruction;
  executionMessage: ReadonlyUint8Array;
  authorizationMessage: ReadonlyUint8Array;
};

/**
 * Signs `payload` against the current `nonce` of `nonceAccount`. Needs no network access.
 * `privateKey` is the authority's Ed25519 key (it never pays fees or signs transactions).
 */
export async function presign(
  authority: Address,
  privateKey: CryptoKey,
  nonceAccount: Address,
  nonce: Address,
  payload: Instruction[]
): Promise<Presigned> {
  const pda = await programmaticSignerAddress(authority);
  const executionMessage = compileExecutionMessage(pda, nonce, payload);
  const executorIx = getExecuteInstruction(
    {
      message: executionMessage,
      nonceAccount,
      nonceAuthority: createNoopSigner(pda),
      nonceProgram: NONCE_PROGRAM,
    },
    { programAddress: EXECUTOR_PROGRAM }
  );
  const authorizationMessage = compileAuthorizationMessage(authority, executorIx);
  const signature = await signBytes(privateKey, authorizationMessage);
  const submit = getSubmitInstruction(
    { signatures: [signature], message: authorizationMessage },
    { programAddress: SIGNER_PROGRAM }
  );
  return { submit, executionMessage, authorizationMessage };
}

async function sha256(...parts: ReadonlyUint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

/**
 * The value `nonceAccount` will hold after `executionMessage` runs at nonce `current`.
 * Mirrors `Nonce::derive_next_nonce` in the nonce program. Used to tell a cashed check
 * (nonce moved to exactly this value) from a stopped one (nonce moved somewhere else).
 */
export async function nextNonce(
  nonceAccount: Address,
  current: Address,
  executionMessage: ReadonlyUint8Array
): Promise<Address> {
  const next = await sha256(
    NONCE_STEP_TAG,
    addressEncoder.encode(NONCE_PROGRAM),
    addressEncoder.encode(nonceAccount),
    addressEncoder.encode(current),
    await sha256(executionMessage)
  );
  return addressDecoder.decode(next);
}
