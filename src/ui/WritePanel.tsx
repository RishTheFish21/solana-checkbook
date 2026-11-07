import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { isAddress, type Address, type KeyPairSigner } from "@solana/kit";
import { CURRENCY_LABEL, MINT, MINT_DECIMALS, PUBLIC_URL } from "../lib/config";
import { checkLink, encodeCheck, formatAmount, parseAmount, signCheck, type SignedCheck } from "../lib/check";
import { addWritten, getBlanks, nextCheckNumber, takeBlank } from "../lib/storage";
import type { Balances } from "../lib/bank";
import { CheckFace } from "./CheckFace";
import { QrScan } from "./QrScan";
import { useAction } from "./useAction";

type Props = { me: KeyPairSigner; balances?: Balances; refresh: () => Promise<void> };

type Signed = { check: SignedCheck; link: string; qr: string };

export function WritePanel({ me, balances, refresh }: Props) {
  const [payee, setPayee] = useState("");
  const [amountText, setAmountText] = useState("");
  const [memo, setMemo] = useState("");
  const [postDate, setPostDate] = useState(false);
  const [notBeforeText, setNotBeforeText] = useState(() => toLocalInput(Date.now() + 5 * 60_000));
  const [scanning, setScanning] = useState(false);
  const [signed, setSigned] = useState<Signed>();
  const [copied, setCopied] = useState(false);
  const { busy, error, setError, run } = useAction();

  const blanks = getBlanks();
  const previewAmount = useMemo(() => {
    try {
      return parseAmount(amountText, MINT_DECIMALS);
    } catch {
      return undefined;
    }
  }, [amountText]);
  const notBefore = postDate ? Math.floor(new Date(notBeforeText).getTime() / 1000) : undefined;
  const overdrawn = previewAmount !== undefined && balances?.checking !== undefined && previewAmount > balances.checking;

  async function sign() {
    if (!MINT) throw new Error("No currency is set up yet. Run `npm run setup:mint`.");
    if (!isAddress(payee.trim())) throw new Error("Enter the payee's account number (a Solana address), or scan their account QR.");
    if (payee.trim() === me.address) throw new Error("You can't write a check to yourself.");
    const amount = parseAmount(amountText, MINT_DECIMALS);
    if (notBefore !== undefined && !(notBefore > 0)) throw new Error("Pick a valid date and time.");
    const blank = takeBlank();
    if (!blank) throw new Error("You're out of checks. Order more first.");

    // Signing happens right here in the browser. No network needed.
    const check = await signCheck(
      {
        number: blank.number,
        writer: me.address,
        payee: payee.trim() as Address,
        amount,
        decimals: MINT_DECIMALS,
        mint: MINT,
        memo: memo.trim(),
        writtenAt: Math.floor(Date.now() / 1000),
        notBefore,
        nonceAccount: blank.nonceAccount,
        nonce: blank.nonce,
      },
      me.keyPair.privateKey
    );
    const encoded = encodeCheck(check);
    addWritten(check, encoded);
    const link = checkLink(encoded, PUBLIC_URL ?? (window.location.origin + window.location.pathname).replace(/\/$/, ""));
    const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: "L", margin: 1, width: 360 });
    setSigned({ check, link, qr });
    await refresh();
  }

  function reset() {
    setSigned(undefined);
    setPayee("");
    setAmountText("");
    setMemo("");
    setPostDate(false);
    setCopied(false);
  }

  if (signed) {
    const c = signed.check;
    return (
      <div className="desk">
        <div className="panel">
          <h2>Check {c.number} is signed</h2>
          <p>
            Give the payee this QR code or link. The {formatAmount(c.amount, c.decimals)} stays in your
            checking account until they deposit it.
          </p>
          <div className="actions">
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(signed.link); setCopied(true); }}>
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button type="button" className="secondary" onClick={() => window.print()}>Print check</button>
            <button type="button" className="quiet" onClick={reset}>Write another</button>
          </div>
          <p className="note">
            Changed your mind? Stop payment from the Register before it's deposited.
          </p>
          {!PUBLIC_URL && window.location.hostname === "localhost" ? (
            <p className="note warn">
              This link points to localhost, so a phone can't open it. Run <code>npm run dev:lan</code> and open
              the app at its network address, or set <code>VITE_PUBLIC_URL</code>.
            </p>
          ) : null}
        </div>
        <div className="check-stage printable">
          <h2 className="stage-title">Check {c.number}</h2>
          <CheckFace {...c} currency={CURRENCY_LABEL} qr={signed.qr} />
        </div>
      </div>
    );
  }

  return (
    <div className="desk">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          run("Signing", sign);
        }}
      >
        <h2>Write a check</h2>
        <label className="field">
          <span>Pay to the order of</span>
          <span className="inline">
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Payee's account number"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="secondary" onClick={() => setScanning((v) => !v)}>Scan</button>
          </span>
        </label>
        {scanning ? (
          <QrScan
            onResult={(text) => {
              setScanning(false);
              if (isAddress(text.trim())) setPayee(text.trim());
              else setError("That QR code isn't an account number.");
            }}
            onClose={() => setScanning(false)}
          />
        ) : null}

        <label className="field">
          <span>Amount ({CURRENCY_LABEL})</span>
          <input value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="25.00" inputMode="decimal" />
        </label>
        {overdrawn ? (
          <p className="note warn">That's more than your checking balance. You can still write it, but it will bounce until you add money.</p>
        ) : null}

        <label className="field">
          <span>Memo</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What it's for" maxLength={60} />
        </label>

        <fieldset className="field">
          <legend>Can be deposited</legend>
          <label className="choice">
            <input type="radio" checked={!postDate} onChange={() => setPostDate(false)} /> Right away
          </label>
          <label className="choice">
            <input type="radio" checked={postDate} onChange={() => setPostDate(true)} /> On or after
            <input type="datetime-local" value={notBeforeText} onChange={(e) => setNotBeforeText(e.target.value)} disabled={!postDate} />
          </label>
        </fieldset>

        <div className="actions">
          <button type="submit" disabled={!!busy || blanks.length === 0}>Sign check</button>
          <span className="note">{blanks.length} blank {blanks.length === 1 ? "check" : "checks"} left</span>
        </div>
        {blanks.length === 0 ? <p className="note">Order checks from the steps above to start writing.</p> : null}
        {error ? <p className="note error" role="alert">{error}</p> : null}
      </form>

      <div className="check-stage">
        <h2 className="stage-title">Preview</h2>
        <CheckFace
          number={blanks[0]?.number ?? nextCheckNumber()}
          writtenAt={Math.floor(Date.now() / 1000)}
          notBefore={notBefore}
          writer={me.address}
          payee={isAddress(payee.trim()) ? payee.trim() : undefined}
          amount={previewAmount}
          decimals={MINT_DECIMALS}
          memo={memo}
          currency={CURRENCY_LABEL}
          nonceAccount={blanks[0]?.nonceAccount}
        />
      </div>
    </div>
  );
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
