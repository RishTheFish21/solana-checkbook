import { amountInWords, formatAmount } from "../lib/check";
import { short } from "./format";

export type Stamp = "paid" | "returned" | "stopped" | "postdated";

const STAMP_TEXT: Record<Stamp, string> = {
  paid: "Paid",
  returned: "Returned",
  stopped: "Payment stopped",
  postdated: "Post-dated",
};

type Props = {
  number?: number;
  writtenAt?: number;
  notBefore?: number;
  writer?: string;
  payee?: string;
  amount?: bigint;
  decimals: number;
  memo?: string;
  currency: string;
  nonceAccount?: string;
  /** Data URL of the QR code. Shown in the signature area once the check is signed. */
  qr?: string;
  stamp?: Stamp;
};

function dateText(unix?: number) {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function CheckFace(p: Props) {
  const hasAmount = p.amount !== undefined && p.amount > 0n;
  return (
    <figure className="check" aria-label={`Check ${p.number ?? ""}`}>
      <div className="check-top">
        <div className="check-drawer">
          <span className="check-drawer-name">{p.writer ? `Account ${short(p.writer)}` : "Your checking account"}</span>
          <span className="check-drawer-bank">{p.currency} on Solana devnet</span>
        </div>
        <div className="check-meta">
          <span className="check-number">{p.number ?? "----"}</span>
          <span className="check-field check-date">
            <span className="check-label">Date</span>
            <span className="hand">{dateText(p.writtenAt)}</span>
          </span>
          {p.notBefore ? (
            <span className="check-postdate">Not valid before {dateText(p.notBefore)},{" "}
              {new Date(p.notBefore * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
      </div>

      <div className="check-payline">
        <span className="check-field check-payee">
          <span className="check-label">Pay to the<br />order of</span>
          <span className="hand">{p.payee ? short(p.payee, 6) : ""}</span>
        </span>
        <span className="check-amountbox">
          <span className="check-dollar">$</span>
          <span className="hand">{hasAmount ? formatAmount(p.amount!, p.decimals) : ""}</span>
        </span>
      </div>

      <div className="check-field check-words">
        <span className="hand">{hasAmount ? amountInWords(p.amount!, p.decimals) : ""}</span>
        <span className="check-label check-dollars">Dollars</span>
      </div>

      <div className="check-bottom">
        <span className="check-field check-memo">
          <span className="check-label">Memo</span>
          <span className="hand">{p.memo}</span>
        </span>
        <span className="check-signature">
          {p.qr ? <img src={p.qr} alt="Signed check QR code. Scan to deposit." /> : <span className="check-unsigned">Not signed yet</span>}
        </span>
      </div>

      <div className="micr" aria-hidden="true">
        ⑆{p.nonceAccount ? p.nonceAccount.slice(0, 9) : "000000000"}⑆ {p.writer ? p.writer.slice(0, 10) : "0000000000"}⑈ {p.number ?? "0000"}
      </div>

      {p.stamp ? (
        <div key={p.stamp} className={`stamp stamp-${p.stamp}`} role="status">
          {STAMP_TEXT[p.stamp]}
        </div>
      ) : null}
    </figure>
  );
}
