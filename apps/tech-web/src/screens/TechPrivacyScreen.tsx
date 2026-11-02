import { useState } from 'react';
import { useTechNav } from '../shell/nav';
import { techApi } from '../api/techApi';
const SECTIONS: { h: string; p: string }[] = [
  { h: 'What we collect', p: 'Your technician account details (name, contact), and the work data you generate — tickets, services, and earnings. We do not sell personal information.' },
  { h: 'How we use it', p: 'To show your schedule, tickets, and earnings, send the notifications you opt into, and operate and improve the service.' },
  { h: 'Your access', p: 'You only see data for the salon and branch you are assigned to. You cannot view owner-only reports unless your role allows it.' },
  { h: 'Retention', p: 'Tickets, commissions, and financial records tied to your work are retained as required by law. Account deactivation disables access but does not delete those records.' },
  { h: 'Contact', p: 'Questions about privacy? Email privacy@aipowersalon.com.' },
];
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function TechPrivacyScreen() {
  const nav = useTechNav();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const data = await techApi.privacyExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `aipowersalon-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || 'Couldn’t prepare your export. Try again later.');
    } finally { setBusy(false); }
  };

  const exportCard = (
    <div style={{ border: '1px solid var(--tech-border)', borderRadius: 12, padding: 12, marginTop: 12, background: 'var(--tech-surface)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Download your data</div>
      <div className="tech-muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>
        A copy of the personal data held against your account, as a JSON file. Your profile, portfolio, followers
        and rating belong to you at every salon you work at.
      </div>
      {err ? <div style={{ fontSize: 12.5, color: '#B3403C', marginBottom: 8 }}>{err}</div> : null}
      <button className="tech-btn" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download my data'}</button>
    </div>
  );
  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={nav.back} aria-label="Back" className="tech-iconbtn"><Back /></button>
        <div style={{ margin: 0, fontSize: 19 }}>Privacy Policy</div>
      </div>
      <div className="tech-main-2">
        <div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.9, marginBottom: 10 }}>How AIPowerSalon collects, uses, and protects your information as a technician.</div>
        <div className="tech-muted" style={{ fontSize: 12, marginBottom: 10 }}>Last updated: June 2026</div>
        {SECTIONS.map((s) => (
          <div key={s.h} className="tech-card" style={{ marginBottom: 10, padding: 14 }}><div className="tech-h-serif" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{s.h}</div><div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.85 }}>{s.p}</div></div>
        ))}
        {exportCard}
      </div>
    </div>
  );
}
