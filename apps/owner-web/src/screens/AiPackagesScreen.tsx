// AiPackagesScreen — owner view of the 15 paid AI assistant packages. Shows each package with the salon's subscription,
// usage meter, and access state (locked reason from the same gate the backend enforces). Owners can start a free trial
// or cancel; paid activation is handled in billing (not self-granted here).
import { useEffect, useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { ownerAiApi, type OwnerAiPackage } from '../api/ownerApi';

const money = (c: number) => `$${(c / 100).toLocaleString('en-US')}`;

export function AiPackagesScreen() {
  const { back } = useOwnerNav();
  const [pkgs, setPkgs] = useState<OwnerAiPackage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    ownerAiApi.packages()
      .then((r) => setPkgs(r.packages))
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to AI packages.' : e?.message || 'Unable to load AI packages.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startTrial = (code: string) => { setBusy(code); setNote(null); ownerAiApi.startTrial(code).then(() => { setNote('Trial started.'); load(); }).catch((e: any) => setNote(e?.message || 'Could not start the trial.')).finally(() => setBusy(null)); };
  const cancel = (code: string) => { setBusy(code); setNote(null); ownerAiApi.cancel(code).then(() => { setNote('Subscription cancelled.'); load(); }).catch((e: any) => setNote(e?.message || 'Could not cancel.')).finally(() => setBusy(null)); };

  const card: React.CSSProperties = { background: 'var(--owner-surface, #fff)', border: '1px solid var(--owner-line, #eee)', borderRadius: 14, padding: 14, marginBottom: 10 };
  const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: bg, color: fg });
  const btn: React.CSSProperties = { border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontFamily: 'inherit', background: 'var(--owner-accent, #A9824C)', color: '#fff' };
  const ghost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--owner-text, #333)', border: '1px solid var(--owner-line, #ddd)' };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>AI Packages</div></div>
        <span style={{ width: 36 }} />
      </header>

      <div style={{ padding: '8px 14px 24px' }}>
        {note ? <div className="owner-state" style={{ padding: '8px 0' }}>{note}</div> : null}
        {loading ? <div className="owner-state"><div className="big owner-serif">Loading…</div></div>
          : err ? <div className="owner-state">{err} <button style={{ ...ghost, marginLeft: 8 }} onClick={load}>Retry</button></div>
          : (pkgs ?? []).map((p) => {
            const sub = p.subscription;
            const active = p.accessible;
            const trialing = sub?.status === 'trialing';
            const pct = sub && sub.usageLimit > 0 ? Math.min(100, Math.round((p.used / sub.usageLimit) * 100)) : null;
            return (
              <div key={p.code} style={card}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{p.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--owner-muted, #777)', marginTop: 2 }}>{p.description}</div>
                  </div>
                  {active ? <span style={pill('#EAF5EE', '#3E8F57')}>{trialing ? 'Trial' : 'Active'}</span>
                    : <span style={pill('#F1EFEC', '#8A857C')}>{p.lockLabel || 'Locked'}</span>}
                </div>

                <div style={{ fontSize: 12.5, color: 'var(--owner-muted, #777)', margin: '8px 0' }}>
                  {money(p.monthlyPriceCents)}/mo · {p.includedUsageLimit.toLocaleString()} {p.usageUnit} included{p.trialDays > 0 ? ` · ${p.trialDays}-day trial` : ''}
                </div>

                {sub ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{p.used.toLocaleString()} / {sub.usageLimit === 0 ? '∞' : sub.usageLimit.toLocaleString()} {p.usageUnit}</span>
                      {p.remainingUsage >= 0 ? <span>{p.remainingUsage.toLocaleString()} left</span> : <span>Unlimited</span>}
                    </div>
                    {pct != null ? <div style={{ height: 6, background: '#EFEDEA', borderRadius: 99, marginTop: 4 }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#B85B4D' : 'var(--owner-accent, #A9824C)', borderRadius: 99 }} /></div> : null}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {p.trialAvailable ? <button style={btn} disabled={busy === p.code} onClick={() => startTrial(p.code)}>{busy === p.code ? '…' : 'Start Free Trial'}</button> : null}
                  {sub && sub.status !== 'cancelled' ? <button style={ghost} disabled={busy === p.code} onClick={() => cancel(p.code)}>{busy === p.code ? '…' : 'Cancel'}</button> : null}
                  {!sub && !p.trialAvailable ? <span style={{ fontSize: 12, color: 'var(--owner-muted, #777)', alignSelf: 'center' }}>Subscribe via billing</span> : null}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}
