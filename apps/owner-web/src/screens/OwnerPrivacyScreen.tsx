import { useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { ownerAccountApi } from '../api/ownerApi';

const SECTIONS: { h: string; p: string }[] = [
  { h: 'What we collect', p: 'Your owner account details (name, email), the business and branch data you manage, and usage needed to operate the dashboard. We do not sell personal information.' },
  { h: 'How we use it', p: 'To show your business performance, bookings, staff, and finance reports, send the alerts you opt into, and operate and improve the service.' },
  { h: 'Your business data', p: 'Reports are scoped to your business only. You never see other tenants’ data, and full payment-gateway secrets are never exposed in the app.' },
  { h: 'Retention', p: 'Business and financial records are retained as required by law. Account deactivation disables access but does not delete records the business must keep.' },
  { h: 'Contact', p: 'Questions about privacy? Email privacy@aipowersalon.com.' },
];

export function OwnerPrivacyScreen() {
  const { back } = useOwnerNav();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Download the data the law says is yours.
  //
  // GET /owner/me/privacy-export has been live all along, building a complete JSON payload of the personal data
  // held against this account. This screen said "Email privacy@aipowersalon.com." — so a right of access that
  // exists on the server took a support ticket and a human to exercise, which is not a right of access.
  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const data = await ownerAccountApi.privacyExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `aipowersalon-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || 'Couldn’t prepare your export. Try again, or email privacy@aipowersalon.com.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Privacy Policy</div></div>
        <div style={{ width: 40 }} />
      </header>
      <div style={{ padding: '4px 14px 18px', display: 'grid', gap: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Last updated: June 2026</div>
        {SECTIONS.map((s) => (
          <div key={s.h} className="owner-chartcard"><div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>{s.h}</div><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{s.p}</div></div>
        ))}

        <div className="owner-chartcard">
          <div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>Download your data</div>
          <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 10 }}>
            Get a copy of the personal data held against your account, as a JSON file. Financial and audit records
            the business is required by law to keep are retained and are not included.
          </div>
          {err ? <div style={{ fontSize: 12.5, color: '#B3403C', marginBottom: 8 }}>{err}</div> : null}
          <button
            onClick={download}
            disabled={busy}
            style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #A96F22', background: '#A96F22', color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
          >
            {busy ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
      </div>
    </>
  );
}
