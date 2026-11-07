import { useCallback, useEffect, useState } from "react";
import type { KeyPairSigner } from "@solana/kit";
import { balances as fetchBalances, loadIdentity, type Balances } from "../lib/bank";
import { AccountPanel } from "./AccountPanel";
import { DepositPanel } from "./DepositPanel";
import { RegisterPanel } from "./RegisterPanel";
import { WritePanel } from "./WritePanel";
import { BankScene } from "./BankScene";
import { Pixels, type IconName } from "./Pixels";
import { describeError } from "./format";

type Tab = "write" | "deposit" | "register";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "write", label: "Write", icon: "write" },
  { id: "deposit", label: "Deposit", icon: "deposit" },
  { id: "register", label: "Register", icon: "register" },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function linkedCheck(): string | undefined {
  const hash = window.location.hash;
  return hash.includes("deposit=") ? hash : undefined;
}

export function App() {
  const [me, setMe] = useState<KeyPairSigner>();
  const [balances, setBalances] = useState<Balances>();
  const [loadError, setLoadError] = useState<string>();
  const [initialCheck] = useState(linkedCheck);
  const [tab, setTab] = useState<Tab>(initialCheck ? "deposit" : "write");

  useEffect(() => {
    loadIdentity().then(setMe, (err) => setLoadError(describeError(err)));
  }, []);

  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      setBalances(await fetchBalances(me.address));
      setLoadError(undefined);
    } catch (err) {
      setLoadError(`Couldn't reach the network: ${describeError(err)}`);
    }
  }, [me]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const now = useClock();
  const day = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/,/g, "");

  return (
    <>
      <BankScene />
      <header className="menubar">
        <span className="menubar-item menubar-brand">
          <Pixels name="bank" size={18} />
          Solana Checkbook
        </span>
        <span className="menubar-item menubar-net">Devnet</span>
        <span className="menubar-spacer" />
        <span className="menubar-item menubar-date">{day}</span>
        <span className="menubar-item">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      </header>

      <div className="app">
        {loadError ? <p className="note error dialog" role="alert">{loadError}</p> : null}
        {me ? <AccountPanel me={me} balances={balances} refresh={refresh} /> : <p className="note dialog">Opening your passbook…</p>}

        {me ? (
          <main role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            {tab === "write" ? <WritePanel me={me} balances={balances} refresh={refresh} /> : null}
            {tab === "deposit" ? <DepositPanel me={me} balances={balances} refresh={refresh} initial={initialCheck} /> : null}
            {tab === "register" ? <RegisterPanel me={me} refresh={refresh} /> : null}
          </main>
        ) : null}

        <footer className="foot">
          Devnet demo. Your signing key is stored in this browser. Built on Anza's Ed25519 Programmatic Signer (pre-audit).
        </footer>
      </div>

      <nav className="dock" role="tablist" aria-label="Checkbook">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "dock-item active" : "dock-item"}
            onClick={() => setTab(t.id)}
          >
            <Pixels name={t.icon} size={32} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
