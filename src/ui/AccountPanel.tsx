import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { KeyPairSigner } from "@solana/kit";
import { CURRENCY_LABEL, MINT, MINT_DECIMALS, explorerAddress } from "../lib/config";
import { formatAmount } from "../lib/check";
import {
  getDemoDollars,
  moveToChecking,
  openAccounts,
  orderChecks,
  type Balances,
} from "../lib/bank";
import { addBlanks, getBlanks, reserveCheckNumbers } from "../lib/storage";
import { sol } from "./format";
import { useAction } from "./useAction";

type Props = { me: KeyPairSigner; balances?: Balances; refresh: () => Promise<void> };

export function AccountPanel({ me, balances, refresh }: Props) {
  const { busy, error, run } = useAction();
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<string>();
  // Read on every render; App re-renders after any action via refresh().
  const blankCount = getBlanks().length;
  const [copied, setCopied] = useState(false);
  const [copiedForFaucet, setCopiedForFaucet] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(me.address, { margin: 1, width: 220 }).then(setQr);
  }, [me.address]);

  const fail = (r: { ok: boolean; failure?: { detail: string } } | undefined) => {
    if (r && !r.ok) throw new Error(r.failure?.detail ?? "That didn't go through.");
  };

  const steps = [
    {
      label: "Get devnet SOL for network fees",
      done: (balances?.sol ?? 0n) > 10_000_000n,
      action: (
        <>
          {/* Solana closed the RPC airdrop on devnet (HTTP 410), so send people to the web faucet. */}
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(me.address); setCopiedForFaucet(true); }}>
            {copiedForFaucet ? "Address copied" : "Copy my address"}
          </button>
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">Open the faucet</a>
          <button type="button" className="quiet" disabled={!!busy} onClick={() => run("Checking balance", refresh)}>
            I got it, check again
          </button>
        </>
      ),
    },
    {
      label: "Open your checking account",
      done: balances?.checking !== undefined,
      action: (
        <button type="button" disabled={!!busy || !MINT} onClick={() => run("Opening accounts", async () => { fail(await openAccounts(me)); await refresh(); })}>
          Open accounts
        </button>
      ),
    },
    {
      label: "Order checks",
      done: blankCount > 0,
      action: (
        <button type="button" disabled={!!busy} onClick={() => run("Ordering checks", async () => {
          const first = reserveCheckNumbers(4);
          addBlanks(await orderChecks(me, 4, first));
          await refresh();
        })}>
          Order 4 checks
        </button>
      ),
    },
    {
      label: `Add ${CURRENCY_LABEL} to checking`,
      done: (balances?.checking ?? 0n) > 0n,
      action: (
        <button type="button" disabled={!!busy || balances?.checking === undefined} onClick={() => run("Adding money", async () => { fail(await getDemoDollars(me, 100)); await refresh(); })}>
          Add 100
        </button>
      ),
    },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <section className="account" aria-label="Your account">
      <h2>Passbook</h2>
      <div className="ledger">
        <div className="ledger-cell">
          <span className="ledger-label">Checking</span>
          <span className="ledger-value">{balances?.checking !== undefined ? formatAmount(balances.checking, MINT_DECIMALS) : "Not open"}</span>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Received</span>
          <span className="ledger-value">{balances?.wallet !== undefined ? formatAmount(balances.wallet, MINT_DECIMALS) : "0.00"}</span>
          {balances?.wallet ? (
            <button type="button" className="quiet" disabled={!!busy} onClick={() => run("Moving money", async () => { fail(await moveToChecking(me, balances.wallet!)); await refresh(); })}>
              Move to checking
            </button>
          ) : null}
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Blank checks</span>
          <span className="ledger-value">{blankCount}</span>
          {allDone ? (
            <button type="button" className="quiet" disabled={!!busy} onClick={() => run("Ordering checks", async () => {
              addBlanks(await orderChecks(me, 4, reserveCheckNumbers(4)));
                  await refresh();
            })}>Order 4 more</button>
          ) : null}
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Fee balance</span>
          <span className="ledger-value">{balances ? `${sol(balances.sol)} SOL` : "…"}</span>
        </div>
        <div className="ledger-cell ledger-account">
          <span className="ledger-label">Account number</span>
          <span className="account-number">
            <a href={explorerAddress(me.address)} target="_blank" rel="noreferrer">{me.address.slice(0, 6)}…{me.address.slice(-6)}</a>
            <button type="button" className="quiet" onClick={async () => { await navigator.clipboard.writeText(me.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="quiet" onClick={() => setShowQr((v) => !v)}>{showQr ? "Hide QR" : "Show QR"}</button>
          </span>
        </div>
      </div>

      {showQr && qr ? (
        <div className="account-qr">
          <img src={qr} alt="Your account number as a QR code" />
          <p>Show this to someone writing you a check. They scan it to fill in "Pay to the order of".</p>
        </div>
      ) : null}

      {!MINT ? (
        <p className="note warn">No currency is set up yet. Run <code>npm run setup:mint</code>, then restart <code>npm run dev</code>.</p>
      ) : null}

      {!allDone ? (
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span className="step-label">{s.label}</span>
              {s.done ? <span className="step-done">Done</span> : <span className="step-action">{s.action}</span>}
            </li>
          ))}
        </ol>
      ) : null}

      {busy ? <p className="note" aria-live="polite">{busy}…</p> : null}
      {error ? <p className="note error" role="alert">{error}</p> : null}
    </section>
  );
}
