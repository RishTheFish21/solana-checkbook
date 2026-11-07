import { useCallback, useEffect, useState } from "react";
import type { KeyPairSigner } from "@solana/kit";
import { PUBLIC_URL, explorerTx } from "../lib/config";
import { checkLink, formatAmount } from "../lib/check";
import { checkStatus, stopPayment } from "../lib/bank";
import { getReceived, getWritten, setWrittenStatus, toSignedCheck, type WrittenRecord } from "../lib/storage";
import { short } from "./format";
import { useAction } from "./useAction";

type Props = { me: KeyPairSigner; refresh: () => Promise<void> };

const STATUS_TEXT = { outstanding: "Outstanding", cashed: "Cashed", stopped: "Stopped" } as const;

export function RegisterPanel({ me, refresh }: Props) {
  const [written, setWritten] = useState<WrittenRecord[]>(getWritten());
  const [copied, setCopied] = useState<number>();
  const { busy, error, run } = useAction();
  const received = getReceived();

  const refreshStatuses = useCallback(
    () =>
      run("Checking statuses", async () => {
        for (const record of getWritten()) {
          if (record.status !== "outstanding") continue;
          const check = toSignedCheck(record);
          setWrittenStatus(check.nonceAccount, await checkStatus(check.nonceAccount, check.nonce, check.executionMessage));
        }
        setWritten(getWritten());
      }),
    [run]
  );

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);

  async function stop(record: WrittenRecord) {
    const check = toSignedCheck(record);
    // Make sure it hasn't been deposited in the meantime.
    const status = await checkStatus(check.nonceAccount, check.nonce, check.executionMessage);
    if (status !== "outstanding") {
      setWrittenStatus(check.nonceAccount, status);
      setWritten(getWritten());
      throw new Error(status === "cashed" ? `Check ${check.number} was already deposited.` : `Check ${check.number} is already stopped.`);
    }
    const result = await stopPayment(me, check);
    if (!result.ok) throw new Error(result.failure.detail);
    setWrittenStatus(check.nonceAccount, "stopped");
    setWritten(getWritten());
    await refresh();
  }

  const date = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="register">
      <div className="register-head">
        <h2>Register</h2>
        <button type="button" className="secondary" disabled={!!busy} onClick={refreshStatuses}>Refresh statuses</button>
      </div>
      {busy ? <p className="note" aria-live="polite">{busy}…</p> : null}
      {error ? <p className="note error" role="alert">{error}</p> : null}

      <div className="table-wrap">
        <table>
          <caption>Checks you wrote</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Date</th>
              <th scope="col">Pay to</th>
              <th scope="col">Memo</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {written.length === 0 ? (
              <tr><td colSpan={7} className="empty">No checks written yet. Write one from the Write tab.</td></tr>
            ) : (
              written.map((r) => (
                <tr key={r.labels.nonceAccount}>
                  <td>{r.labels.number}</td>
                  <td>
                    {date(r.labels.writtenAt)}
                    {r.labels.notBefore ? <span className="sub">valid {date(r.labels.notBefore)}</span> : null}
                  </td>
                  <td>{short(r.labels.payee)}</td>
                  <td>{r.labels.memo}</td>
                  <td className="num">{formatAmount(BigInt(r.labels.amount), r.labels.decimals)}</td>
                  <td><span className={`status status-${r.status}`}>{STATUS_TEXT[r.status]}</span></td>
                  <td className="row-actions">
                    {r.status === "outstanding" ? (
                      <>
                        <button type="button" className="quiet" onClick={async () => {
                          await navigator.clipboard.writeText(checkLink(r.encoded, PUBLIC_URL ?? (window.location.origin + window.location.pathname).replace(/\/$/, "")));
                          setCopied(r.labels.number);
                        }}>
                          {copied === r.labels.number ? "Copied" : "Copy link"}
                        </button>
                        <button type="button" className="danger" disabled={!!busy} onClick={() => run(`Stopping payment on ${r.labels.number}`, () => stop(r))}>
                          Stop payment
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table>
          <caption>Checks you deposited</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Date</th>
              <th scope="col">From</th>
              <th scope="col">Memo</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col"><span className="sr-only">Transaction</span></th>
            </tr>
          </thead>
          <tbody>
            {received.length === 0 ? (
              <tr><td colSpan={6} className="empty">Nothing deposited yet.</td></tr>
            ) : (
              received.map((r) => (
                <tr key={r.signature}>
                  <td>{r.number}</td>
                  <td>{date(r.depositedAt)}</td>
                  <td>{short(r.writer)}</td>
                  <td>{r.memo}</td>
                  <td className="num">{formatAmount(BigInt(r.amount), r.decimals)}</td>
                  <td><a href={explorerTx(r.signature)} target="_blank" rel="noreferrer">Explorer</a></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
