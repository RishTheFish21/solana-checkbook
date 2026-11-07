# Checkbook: stablecoin checks on Solana

Write a check, hand over a QR code, and the money stays in your account until it's deposited. Checks can be **post-dated**, **stopped**, and when the writer is short they **bounce** and can be **deposited again** later, just like paper checks. Signing happens offline.

Built for the MLH Solana Hackathon (Nov 6–8, 2026) on Anza's **Ed25519 Programmatic Signer**, one of the replacements for durable nonces (announced for removal in October 2026). It runs on devnet, and those programs are pre-audit.

## How it works

A check is a signed instruction that anyone can submit later:

```
your key signs (offline) ──► authorization message
                               └─ Executor.Execute: consume this check's nonce, then run:
                                    ├─ Lighthouse: fail if clock < post-date   (only if post-dated)
                                    ├─ Token: transfer $X from your checking account to payee
                                    └─ Memo: "Check #1001: Rent"
payee scans QR ──► Signer.Submit(signature, message) in a normal transaction ──► money moves
```

- **Checking account**: a PDA derived from your key by the signer program. It has no private key; it can only move money when your signature says so.
- **Blank checks**: each check uses its own *nonce account*. That's what makes it single-use, and lets checks be deposited in any order. "Order checks" creates them (about 0.0014 SOL rent each).
- **Post-dating**: a Lighthouse `AssertSysvarClock` instruction. Deposit too early and the whole transaction reverts.
- **Retryable**: a failed deposit (too early, insufficient funds) rolls back the nonce too, so the check stays good.
- **Stop payment**: the writer spends the nonce on an empty payload. The original check can never execute.
- **Status**: read straight from the chain. Nonce unchanged means outstanding. Nonce moved to exactly what this check produces means cashed. Moved anywhere else means stopped.
- **Tamper-proof**: the deposit screen decodes the *signed bytes*, not the labels. A swapped payee or edited amount is flagged before anything is sent, and the signer program rejects a forged signature on-chain too.
- **v1 transactions**: a deposit is about 1,350–1,460 bytes, over the old 1,232 limit, so it uses the v1 format (4,096 bytes, active on devnet).

## Quick start

You need Node 22+, and for setup, the Solana CLI with a devnet wallet.

```bash
npm install

# One-time: a devnet wallet with a little SOL to pay for setup
solana-keygen new            # skip if ~/.config/solana/id.json exists
solana airdrop 1 -u devnet   # or https://faucet.solana.com

# Checks the four programs exist on devnet, creates "Demo USD", writes .env.local
npm run setup:mint

npm run dev                  # http://localhost:5173
```

In the app, follow the four numbered steps: get devnet SOL, open accounts, order checks, add Demo USD.

**Two devices** (laptop writes, phone deposits): every browser is its own bank account. Run `npm run dev:lan`, open the app on the laptop **at its network address** (for example `http://192.168.1.20:5173`), so check links point somewhere your phone can reach. Then scan the check QR with the phone's camera app. The in-app camera scanner only works on `https://` or `localhost`. Deploying to Vercel or Netlify fixes both; set `VITE_PUBLIC_URL` there.

## Demo script (about 2 minutes)

1. **Write**: pay the phone's account $25, memo "Pizza". The check fills in as you type. Sign it and point out that no network is needed to sign.
2. **Deposit on the phone**: scan, see "Signature: Valid", deposit, and the PAID stamp lands. Open it on Explorer.
3. **Post-dated**: write one valid 2 minutes from now. Deposit: rejected, "Post-dated". Wait, press **Deposit again**, and it clears.
4. **Bounce**: write $500 against a smaller balance. Deposit: RETURNED. Add money, deposit again, and it clears.
5. **Stop payment**: write one, stop it from the Register, then try to deposit it: PAYMENT STOPPED.
6. Close on the pitch: the money never leaves your account until deposit, checks work across the world in seconds, and this runs on the brand-new durable-nonce replacement.

## Project layout

```
src/lib/signer.ts      offline signing: execution + authorization messages, next-nonce math
src/lib/check.ts       check payload, compact QR encoding, decode + verify signed contents
src/lib/bank.ts        devnet calls: accounts, order checks, deposit, stop payment, status
src/lib/errors.ts      on-chain failure → "post-dated" / "bounced" / "already used"
src/lib/storage.ts     local register (blank checks, written, received)
src/ui/                React screens: Write, Deposit, Register, and the check itself
vendor/                Anza's JS client (not on npm yet), Apache-2.0, unmodified
scripts/               setup-demo-mint.ts, dump-programs.sh
test/                  end-to-end test against the real program binaries
```

## Tests

The end-to-end test runs every outcome (deposit, double deposit, post-dated early and late, bounce and redeposit, stop payment, status detection, payee swap, forged amount) against the actual devnet program binaries in LiteSVM:

```bash
bash scripts/dump-programs.sh   # downloads the 4 program binaries into programs/fixtures
npm test
```

LiteSVM doesn't include the Memo program, so the test signs checks without the memo instruction.

## Known limits

- **Demo keys**: your signing key lives in browser `localStorage`, and the Demo USD mint authority is in `.env.local` (and so in the browser bundle). Devnet only, never real funds.
- **Fees**: whoever deposits pays about 0.000005 SOL plus, the first time, rent for their token account.
- **Pre-audit programs**: Anza's signer programs may change interface before audit.
- **Lighthouse on devnet**: `npm run setup:mint` checks that it's there. If it isn't, post-dating fails; everything else works.

## Stretch ideas

- **Fee sponsorship** with a paymaster (e.g. Kora), so payees need no SOL.
- **Certified checks**: lock the amount in escrow at signing time.
- **Hardware-wallet signing**, once wallets support signing these messages.
- **Paper checks**: the print layout already works; add a "void after" date (Lighthouse `LessThanOrEqual`).
- **Payroll**: write a batch of post-dated checks in one go.

## Credits

- Ed25519 Programmatic Signer and its JS client: Anza / solana-program (Apache-2.0)
- Lighthouse assertion program: Jac0xb (MIT)
- gitteri/nonce-replacement, used as a reference for the devnet program IDs and flow
