/**
 * One-time devnet setup:
 *   1. Checks that the programmatic-signer programs and Lighthouse exist on the cluster.
 *   2. Creates a "Demo USD" mint whose authority is a throwaway "bank" key.
 *   3. Writes .env.local so the app can hand out demo dollars.
 *
 * Usage: npm run setup:mint
 * Pays with ~/.config/solana/id.json (or FUNDER_KEYPAIR), which needs ~0.05 devnet SOL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getInitializeMint2Instruction, getMintSize, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const RPC_URL = process.env.VITE_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_URL.replace(/^http/, "ws"));

const PROGRAMS: Record<string, string> = {
  "Ed25519 Signer": "EdSigVfK1DkeMrjFNDMjwfQaJPhPTtX7jW8uPv3oKEgN",
  "Message Executor": "ExecxgyHYsAXB4c5dZodV1zJZ9hqfsDCYkRDRATrpkFR",
  Nonce: "Noncediea1fH12usShuQAz28UhgAeuE5Maf32LsMUQB",
  Lighthouse: "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
};

async function main() {
  console.log(`Cluster: ${RPC_URL}\n`);
  let missing = false;
  for (const [name, id] of Object.entries(PROGRAMS)) {
    const { value } = await rpc.getAccountInfo(id as Address, { encoding: "base64" }).send();
    const ok = Boolean(value?.executable);
    if (!ok) missing = true;
    console.log(`${ok ? "found  " : "MISSING"}  ${name.padEnd(17)} ${id}`);
  }
  if (missing) {
    console.log(
      "\nA program is missing on this cluster. If it's Lighthouse, post-dated checks won't work:\n" +
        "set VITE_LIGHTHOUSE_PROGRAM_ID to a deployment you control, or skip post-dating.\n"
    );
  }

  const funderPath = process.env.FUNDER_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(funderPath)) {
    throw new Error(`No funder keypair at ${funderPath}. Run \`solana-keygen new\` and \`solana airdrop 1 -u devnet\`.`);
  }
  const funder = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(funderPath, "utf8"))));
  const { value: balance } = await rpc.getBalance(funder.address).send();
  console.log(`\nFunder ${funder.address}: ${Number(balance) / 1e9} SOL`);
  if (balance < 20_000_000n) throw new Error("Funder needs at least 0.02 devnet SOL. Try https://faucet.solana.com");

  // The bank key only ever mints demo dollars. It goes into .env.local (and so into the browser).
  const bank = await generateKeyPairSigner(true);
  const bankSecret = new Uint8Array([
    ...new Uint8Array(await crypto.subtle.exportKey("pkcs8", bank.keyPair.privateKey)).slice(-32),
    ...new Uint8Array(await crypto.subtle.exportKey("raw", bank.keyPair.publicKey)),
  ]);
  mkdirSync(".keys", { recursive: true });
  writeFileSync(".keys/demo-mint-authority.json", JSON.stringify([...bankSecret]));

  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(funder, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAccountInstruction({ payer: funder, newAccount: mint, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
          getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: bank.address }),
        ],
        m
      )
  );
  const tx = await signTransactionMessageWithSigners(message);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(tx as never, { commitment: "confirmed" });
  console.log(`Created mint ${mint.address} (tx ${getSignatureFromTransaction(tx)})`);

  const env = [
    `# Written by npm run setup:mint. Devnet only.`,
    `VITE_RPC_URL=${RPC_URL}`,
    `VITE_MINT=${mint.address}`,
    `VITE_MINT_DECIMALS=6`,
    `VITE_CURRENCY_LABEL=Demo USD`,
    `VITE_DEMO_MINT_AUTHORITY=${JSON.stringify([...bankSecret])}`,
    "",
  ].join("\n");
  writeFileSync(".env.local", env);
  console.log("\nWrote .env.local. Start the app with: npm run dev");
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
