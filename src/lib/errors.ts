/**
 * Turns a failed deposit into what a bank would tell you.
 *
 * Errors bubble up through the CPI chain (Submit -> Execute -> Token / Lighthouse), so the
 * top-level error code alone is ambiguous: Token's "insufficient funds" and the Executor's
 * "invalid message" are both custom error 1. The first "Program X failed" line in the logs is the
 * innermost failure, so that is what we match on.
 */
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { EXECUTOR_PROGRAM, LIGHTHOUSE_PROGRAM, NONCE_PROGRAM, SIGNER_PROGRAM } from "./config";

export type FailureKind = "too-early" | "bounced" | "used" | "bad-signature" | "other";

export type Failure = { kind: FailureKind; detail: string };

const TOKEN_INSUFFICIENT_FUNDS = 0x1;
const LIGHTHOUSE_ASSERTION_FAILED = 0x1771; // 6001
const EXECUTOR_NONCE_MISMATCH = 0x3;
const NONCE_NONCE_MISMATCH_NAMES = ["NonceMismatch"];

export function innermostFailure(logs: readonly string[]): { program: string; code?: number; text: string } | undefined {
  for (const line of logs) {
    const match = /^Program (\w+) failed: (.*)$/.exec(line);
    if (!match) continue;
    const code = /custom program error: 0x([0-9a-f]+)/i.exec(match[2]);
    return { program: match[1], code: code ? parseInt(code[1], 16) : undefined, text: match[2] };
  }
  return undefined;
}

export function explainFailure(logs: readonly string[], fallback?: string): Failure {
  const failure = innermostFailure(logs);
  if (failure) {
    if (failure.program === LIGHTHOUSE_PROGRAM && failure.code === LIGHTHOUSE_ASSERTION_FAILED) {
      return { kind: "too-early", detail: "This check is post-dated. Deposit it on or after its date." };
    }
    if (failure.program === TOKEN_PROGRAM_ADDRESS && failure.code === TOKEN_INSUFFICIENT_FUNDS) {
      return {
        kind: "bounced",
        detail:
          "Returned for insufficient funds. The writer's checking account is short. The check is still good: deposit it again once they add money.",
      };
    }
    if (
      (failure.program === EXECUTOR_PROGRAM && failure.code === EXECUTOR_NONCE_MISMATCH) ||
      (failure.program === NONCE_PROGRAM &&
        NONCE_NONCE_MISMATCH_NAMES.some((n) => failure.text.includes(n)))
    ) {
      return { kind: "used", detail: "This check was already deposited, or the writer stopped payment on it." };
    }
    if (failure.program === SIGNER_PROGRAM) {
      return { kind: "bad-signature", detail: `The check's signature was rejected (${failure.text}).` };
    }
    return { kind: "other", detail: `Program ${failure.program} failed: ${failure.text}` };
  }
  return { kind: "other", detail: fallback ?? "The deposit failed for an unknown reason." };
}
