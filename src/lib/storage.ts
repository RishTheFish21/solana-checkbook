/** Local records: blank checks, the register of checks you wrote, and checks you received. */
import type { Address } from "@solana/kit";
import type { CheckLabels, SignedCheck } from "./check";
import { fromBase64Url, toBase64Url } from "./check";
import type { BlankCheck, CheckStatus } from "./bank";

const KEYS = { blanks: "checkbook.blanks", written: "checkbook.written", received: "checkbook.received", next: "checkbook.next" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getBlanks(): BlankCheck[] {
  return load<BlankCheck[]>(KEYS.blanks, []);
}
export function addBlanks(blanks: BlankCheck[]) {
  save(KEYS.blanks, [...getBlanks(), ...blanks]);
}
export function takeBlank(): BlankCheck | undefined {
  const [first, ...rest] = getBlanks();
  save(KEYS.blanks, rest);
  return first;
}
export function nextCheckNumber(): number {
  return load<number>(KEYS.next, 1001);
}
export function reserveCheckNumbers(count: number): number {
  const first = nextCheckNumber();
  save(KEYS.next, first + count);
  return first;
}

type StoredLabels = Omit<CheckLabels, "amount"> & { amount: string };
export type WrittenRecord = {
  labels: StoredLabels;
  submitData: string;
  executionMessage: string;
  status: CheckStatus;
  encoded: string;
};

export function getWritten(): WrittenRecord[] {
  return load<WrittenRecord[]>(KEYS.written, []);
}
export function addWritten(check: SignedCheck, encoded: string) {
  const { submitData, executionMessage, amount, ...rest } = check;
  const record: WrittenRecord = {
    labels: { ...rest, amount: amount.toString() },
    submitData: toBase64Url(submitData),
    executionMessage: toBase64Url(executionMessage),
    status: "outstanding",
    encoded,
  };
  save(KEYS.written, [record, ...getWritten()]);
}
export function setWrittenStatus(nonceAccount: Address, status: CheckStatus) {
  save(
    KEYS.written,
    getWritten().map((r) => (r.labels.nonceAccount === nonceAccount ? { ...r, status } : r))
  );
}
export function toSignedCheck(record: WrittenRecord): SignedCheck {
  return {
    ...record.labels,
    amount: BigInt(record.labels.amount),
    submitData: fromBase64Url(record.submitData),
    executionMessage: fromBase64Url(record.executionMessage),
  };
}

export type ReceivedRecord = {
  number: number;
  writer: Address;
  amount: string;
  decimals: number;
  memo: string;
  signature: string;
  depositedAt: number;
};
export function getReceived(): ReceivedRecord[] {
  return load<ReceivedRecord[]>(KEYS.received, []);
}
export function addReceived(record: ReceivedRecord) {
  save(KEYS.received, [record, ...getReceived()]);
}
