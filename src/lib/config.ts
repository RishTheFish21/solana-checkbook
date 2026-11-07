import { address, type Address } from "@solana/kit";

/**
 * Settings come from Vite (`import.meta.env`, browser) or `process.env` (Node scripts and tests).
 * Every value has a working devnet default except the demo mint, which `npm run setup:mint` creates.
 */
const viteEnv: Record<string, string | undefined> =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const nodeEnv: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

function setting(name: string): string | undefined {
  return viteEnv[`VITE_${name}`] ?? nodeEnv[`VITE_${name}`] ?? nodeEnv[name];
}

export const RPC_URL = setting("RPC_URL") ?? "https://api.devnet.solana.com";
export const WS_URL = setting("WS_URL") ?? RPC_URL.replace(/^http/, "ws");
export const CLUSTER = setting("CLUSTER") ?? "devnet";

/** Anza's Ed25519 Programmatic Signer programs (canonical devnet deployment, pre-audit). */
export const SIGNER_PROGRAM: Address = address(
  setting("SIGNER_PROGRAM_ID") ?? "EdSigVfK1DkeMrjFNDMjwfQaJPhPTtX7jW8uPv3oKEgN"
);
export const EXECUTOR_PROGRAM: Address = address(
  setting("EXECUTOR_PROGRAM_ID") ?? "ExecxgyHYsAXB4c5dZodV1zJZ9hqfsDCYkRDRATrpkFR"
);
export const NONCE_PROGRAM: Address = address(
  setting("NONCE_PROGRAM_ID") ?? "Noncediea1fH12usShuQAz28UhgAeuE5Maf32LsMUQB"
);

/** Lighthouse assertion program, used to post-date checks with a clock assertion. */
export const LIGHTHOUSE_PROGRAM: Address = address(
  setting("LIGHTHOUSE_PROGRAM_ID") ?? "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"
);

/** The stablecoin the checks are written in. Set by `npm run setup:mint`. */
export const MINT: Address | undefined = setting("MINT") ? address(setting("MINT")!) : undefined;
export const MINT_DECIMALS = Number(setting("MINT_DECIMALS") ?? "6");
export const CURRENCY_LABEL = setting("CURRENCY_LABEL") ?? "Demo USD";

/**
 * Secret key (JSON byte array) of the demo mint's authority, so the app can hand out demo dollars.
 * Devnet only. Never put a real key here: anything in a VITE_ variable ships to the browser.
 */
export const DEMO_MINT_AUTHORITY = setting("DEMO_MINT_AUTHORITY");

/** Where check links point. Set it to your LAN or deployed URL so a phone can open them. */
export const PUBLIC_URL = setting("PUBLIC_URL");

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}
export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;
}
