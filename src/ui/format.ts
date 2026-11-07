export function short(address: string, keep = 4): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep)}`;
}

export function sol(lamports: bigint): string {
  return (Number(lamports) / 1e9).toFixed(3);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const context = (err as { context?: { __serverMessage?: string } }).context;
    return context?.__serverMessage ?? err.message;
  }
  return String(err);
}
