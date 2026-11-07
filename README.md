# Solana Checkbook: stablecoin checks on Solana

Solana Checkbook lets you write someone a check in digital dollars and hand it to them as a QR code or a link, while the money stays in your account until they actually deposit it. Checks can be post-dated so they can't be cashed early, you can stop payment on one any time before it's deposited, and if you don't have enough money when it's deposited it bounces the way a paper check would, then clears once you top up and the payee tries again. Signing a check happens entirely offline, so nothing touches the network until the payee deposits it.

**Try it live:** [rishthefish21.github.io/solana-checkbook](https://rishthefish21.github.io/solana-checkbook/) (Solana devnet, demo money only)

I built this for the MLH Solana Hackathon (Nov 6–8, 2026) on top of Anza's **Ed25519 Programmatic Signer**, which is one of the replacements for durable nonces now that Solana has announced durable nonces will be removed. A payment signed with the new signer stays valid until it's used, can be cancelled, and survives a failed attempt, which happens to be exactly how a paper check behaves. Everything here runs on devnet, and Anza's programs haven't been audited yet.

## How it works

Under the hood, a check is a signed instruction that anyone can submit later on your behalf:

```
your key signs (offline) ──► authorization message
                               └─ Executor.Execute: consume this check's nonce, then run:
                                    ├─ Lighthouse: fail if clock < post-date   (only if post-dated)
                                    ├─ Token: transfer $X from your checking account to payee
                                    └─ Memo: "Check #1001: Rent"
payee scans QR ──► Signer.Submit(signature, message) in a normal transaction ──► money moves
```

Your **checking account** is a PDA that the signer program derives from your key. It has no private key of its own, so the only way money leaves it is when your signature says so.

Every **blank check** is backed by its own nonce account, which is what makes each check single-use and also means checks can be deposited in any order rather than one after another. The "Order checks" step creates these accounts, and each one costs about 0.0014 SOL in rent.

**Post-dating** is done with a Lighthouse `AssertSysvarClock` instruction inside the signed payment, so if someone deposits the check too early the whole transaction reverts. Because a failed deposit also rolls back the nonce, the check is still good afterward, and the same is true when a deposit fails because the writer doesn't have enough money. That's what makes checks **retryable**.

To **stop payment**, the writer spends the check's nonce on an empty payload first, which means the original check can never execute after that.

The app works out each check's **status** by reading the chain directly. If the nonce hasn't changed, the check is still outstanding; if it moved to exactly the value this check would produce, the check was cashed; and if it moved to anything else, payment was stopped.

Checks are also **tamper-proof**, because the deposit screen decodes the signed bytes rather than trusting the labels printed on the check. A swapped payee or an edited amount gets flagged before anything is sent, and the signer program rejects a forged signature on-chain as well.

Finally, a deposit comes out to roughly 1,350–1,460 bytes, which is over the old 1,232-byte transaction limit, so deposits use Solana's newer **v1 transaction format**, which allows up to 4,096 bytes and is already active on devnet.

## Running it locally

You'll need Node 22 or newer, plus a devnet wallet with a little SOL to pay for the one-time setup.

```bash
npm install

# The setup script pays with ~/.config/solana/id.json by default,
# or with any keypair file you point FUNDER_KEYPAIR at.
solana-keygen new            # skip this if you already have a wallet

# Checks that the four programs exist on devnet, creates "Demo USD", and writes .env.local
npm run setup:mint

npm run dev                  # http://localhost:5173
```

Solana has closed the command-line devnet airdrop, so `solana airdrop` no longer works. To fund the wallet, paste its address into [faucet.solana.com](https://faucet.solana.com) with devnet selected.

Once the app is open, the passbook at the top walks you through the four setup steps: getting devnet SOL for fees, opening your accounts, ordering checks, and adding Demo USD.

**Using two devices.** Every browser gets its own wallet, so a laptop and a phone act like two separate bank customers. If you're running locally, start the server with `npm run dev:lan` and open the app on the laptop at its network address (something like `http://192.168.1.20:5173`) so the check links point somewhere your phone can reach, then scan the check's QR code with the phone's camera. The in-app camera scanner only works over `https://` or on `localhost`, so the live GitHub Pages site is the easiest way to test with a phone.

## Deploying

The site deploys to GitHub Pages through `.github/workflows/deploy.yml` on every push to `main`. The workflow reads `VITE_RPC_URL`, `VITE_MINT`, `VITE_MINT_DECIMALS` and `VITE_CURRENCY_LABEL` from the repository's Actions variables, and `VITE_DEMO_MINT_AUTHORITY` from an Actions secret, and it sets the base path and public URL for you so check links point at the live site.

## Project layout

```
src/lib/signer.ts      offline signing: execution + authorization messages, next-nonce math
src/lib/check.ts       check payload, compact QR encoding, decode + verify signed contents
src/lib/bank.ts        devnet calls: accounts, order checks, deposit, stop payment, status
src/lib/errors.ts      on-chain failure → "post-dated" / "bounced" / "already used"
src/lib/storage.ts     local register (blank checks, written, received)
src/ui/                React screens: Write, Deposit, Register, the check itself, and the desktop
vendor/                Anza's JS client (not on npm yet), Apache-2.0, unmodified
scripts/               setup-demo-mint.ts, dump-programs.sh
test/                  end-to-end test against the real program binaries
```

## Tests

The end-to-end test runs every outcome against the actual devnet program binaries inside LiteSVM: a normal deposit, a second deposit of the same check, a post-dated check deposited both early and late, a bounce followed by a redeposit, stop payment, status detection, a swapped payee, and a forged amount.

```bash
bash scripts/dump-programs.sh   # downloads the 4 program binaries into programs/fixtures
npm test
```

LiteSVM doesn't ship with the Memo program, so the test signs its checks without the memo instruction.

## Known limits

This is a devnet prototype, and a few shortcuts make it easy to demo but wouldn't be acceptable with real money. Your signing key lives in the browser's `localStorage`, and the Demo USD mint authority is built into the site so that anyone can give themselves test dollars.

Whoever deposits a check pays the network fee, which is about 0.000005 SOL, plus the rent for a token account the first time they receive money.

Anza's signer programs are pre-audit, so their interface may still change. The setup script also checks that Lighthouse is deployed on devnet, because post-dated checks depend on it even though everything else would keep working without it.

## Where it could go next

The most useful next step would be **fee sponsorship** through a paymaster such as Kora, so that people receiving checks never need to hold SOL at all. After that, **certified checks** would lock the amount in escrow at signing time, which protects the payee the same way a bank's certified check does.

Beyond those, it would be good to support **hardware-wallet signing** once wallets can sign these messages, to add a "void after" date to printed checks using Lighthouse's `LessThanOrEqual` assertion, and to let employers write a batch of post-dated **payroll** checks in one go.

## Credits

- Ed25519 Programmatic Signer and its JS client: Anza / solana-program (Apache-2.0)
- Lighthouse assertion program: Jac0xb (MIT)
- gitteri/nonce-replacement, used as a reference for the devnet program IDs and flow
