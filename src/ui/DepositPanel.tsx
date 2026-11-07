import { useCallback, useEffect, useState } from "react";
import type { KeyPairSigner } from "@solana/kit";
import { CURRENCY_LABEL, MINT, explorerTx } from "../lib/config";
import { formatAmount, type ReadCheck } from "../lib/check";
import { deposit, prepareDeposit, type Balances, type CheckStatus } from "../lib/bank";
import type { FailureKind } from "../lib/errors";
import { addReceived } from "../lib/storage";
import { CheckFace, type Stamp } from "./CheckFace";
import { QrScan } from "./QrScan";
import { short } from "./format";
import { useAction } from "./useAction";

type Props = { me: KeyPairSigner; balances?: Balances; refresh: () => Promise<void>; initial?: string };

type Outcome =
  | { ok: true; signature: string }
  | { ok: false; kind: FailureKind; detail: string };

const FAILURE_STAMP: Partial<Record<FailureKind, Stamp>> = {
  bounced: "returned",
  "too-early": "postdated",
  used: "stopped",
};

export function DepositPanel({ me, balances, refresh, initial }: Props) {
  const [input, setInput] = useState(initial ?? "");
  const [scanning, setScanning] = useState(false);
  const [loaded, setLoaded] = useState<{ check: ReadCheck; status: CheckStatus }>();
  const [outcome, setOutcome] = useState<Outcome>();
  const { busy, error, run } = useAction();

  const load = useCallback(
    (text: string) =>
      run("Reading check", async () => {
        setOutcome(undefined);
        setLoaded(await prepareDeposit(text));
      }),
    [run]
  );

  useEffect(() => {
    if (initial) load(initial);
  }, [initial, load]);

  async function depositNow() {
    if (!loaded) return;
    const result = await deposit(me, loaded.check);
    if (result.ok) {
      setOutcome({ ok: true, signature: result.signature });
      addReceived({
        number: loaded.check.number,
        writer: loaded.check.writer,
        amount: loaded.check.amount.toString(),
        decimals: loaded.check.decimals,
        memo: loaded.check.memo,
        signature: result.signature,
        depositedAt: Math.floor(Date.now() / 1000),
      });
      setLoaded({ ...loaded, status: "cashed" });
    } else {
      setOutcome({ ok: false, kind: result.failure.kind, detail: result.failure.detail });
    }
    await refresh();
  }

  const c = loaded?.check;
  const now = Date.now() / 1000;
  const tooEarly = c?.notBefore !== undefined && c.notBefore > now;
  const lowFees = (balances?.sol ?? 0n) < 1_000_000n;
  const wrongCurrency = c && MINT && c.mint !== MINT;

  let stamp: Stamp | undefined;
  if (outcome?.ok) stamp = "paid";
  else if (outcome && !outcome.ok) stamp = FAILURE_STAMP[outcome.kind];
  else if (loaded?.status === "cashed") stamp = "paid";
  else if (loaded?.status === "stopped") stamp = "stopped";

  return (
    <div className="desk">
      <div className="panel">
        <h2>Deposit a check</h2>
        <label className="field">
          <span>Check link</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste the link from the check, or scan its QR code"
            rows={3}
            spellCheck={false}
          />
        </label>
        <div className="actions">
          <button type="button" disabled={!!busy || !input.trim()} onClick={() => load(input)}>Read check</button>
          <button type="button" className="secondary" onClick={() => setScanning((v) => !v)}>Scan QR</button>
        </div>
        {scanning ? (
          <QrScan
            onResult={(text) => {
              setScanning(false);
              setInput(text);
              load(text);
            }}
            onClose={() => setScanning(false)}
          />
        ) : null}

        {c && loaded ? (
          <div className="verify">
            <h3>What this check does</h3>
            <dl>
              <dt>Pays</dt>
              <dd>
                {formatAmount(c.amount, c.decimals)} {CURRENCY_LABEL} to{" "}
                {c.payee === me.address ? "you" : <>account {short(c.payee)}</>}
              </dd>
              <dt>From</dt>
              <dd>Account {short(c.writer)}</dd>
              <dt>Signature</dt>
              <dd className={c.signatureValid ? "good" : "bad"}>{c.signatureValid ? "Valid" : "Invalid"}</dd>
              <dt>Status</dt>
              <dd>
                {loaded.status === "outstanding" ? "Not deposited yet" : loaded.status === "cashed" ? "Already deposited" : "Payment stopped by the writer"}
              </dd>
              {c.notBefore ? (
                <>
                  <dt>Date</dt>
                  <dd className={tooEarly ? "bad" : "good"}>
                    {tooEarly ? "Post-dated: " : "Valid from "}
                    {new Date(c.notBefore * 1000).toLocaleString()}
                  </dd>
                </>
              ) : null}
            </dl>
            {c.problems.map((p) => (
              <p key={p} className="note error">{p}</p>
            ))}
            {c.payee !== me.address ? (
              <p className="note">This check pays someone else. Depositing it still sends the money to them, not you.</p>
            ) : null}
            {wrongCurrency ? <p className="note warn">This check is in a different currency than this app is set up for.</p> : null}
            {lowFees ? <p className="note warn">You need a little devnet SOL to pay the network fee. Use the steps above.</p> : null}

            {loaded.status === "outstanding" && !outcome?.ok ? (
              <div className="actions">
                <button type="button" disabled={!!busy || c.problems.length > 0 || lowFees} onClick={() => run("Depositing", depositNow)}>
                  {outcome && !outcome.ok ? "Deposit again" : "Deposit check"}
                </button>
              </div>
            ) : null}

            {outcome?.ok ? (
              <p className="note good" role="status">
                Deposited. <a href={explorerTx(outcome.signature)} target="_blank" rel="noreferrer">View on Solana Explorer</a>
              </p>
            ) : null}
            {outcome && !outcome.ok ? <p className="note error" role="alert">{outcome.detail}</p> : null}
          </div>
        ) : null}

        {busy ? <p className="note" aria-live="polite">{busy}…</p> : null}
        {error ? <p className="note error" role="alert">{error}</p> : null}
      </div>

      <div className="check-stage">
        <h2 className="stage-title">Check</h2>
        {c ? (
          <CheckFace
            number={c.number}
            writtenAt={c.writtenAt}
            notBefore={c.notBefore}
            writer={c.writer}
            payee={c.payee}
            amount={c.amount}
            decimals={c.decimals}
            memo={c.memo}
            currency={CURRENCY_LABEL}
            nonceAccount={c.nonceAccount}
            stamp={stamp}
          />
        ) : (
          <div className="check-empty">The check you scan or paste shows up here, read straight from its signature.</div>
        )}
      </div>
    </div>
  );
}
