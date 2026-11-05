import { useOwnerNav } from '../shell/nav';

const SECTIONS: { h: string; p: string }[] = [
  { h: 'Using AIPowerSalon Owner', p: 'The Owner app gives you dashboards, booking overview, staff performance, finance reports, and alerts for your business. Use it lawfully and keep your sign-in secure.' },
  { h: 'Your account', p: 'You are responsible for activity on your account. You can request account deactivation at any time from More → Account Deactivation.' },
  { h: 'Data accuracy', p: 'Reports are generated from your operational data. Figures are provided to help you run your business and are not a substitute for your own accounting.' },
  { h: 'Acceptable use', p: 'Do not attempt to access other tenants’ data or interfere with the service.' },
  { h: 'Changes', p: 'We may update these terms; continued use after an update means you accept the revised terms.' },
  { h: 'Contact', p: 'Questions? Email support@aipowersalon.com.' },
];

export function OwnerTermsScreen() {
  const { back } = useOwnerNav();
  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Terms of Service</div></div>
        <div style={{ width: 40 }} />
      </header>
      <div style={{ padding: '4px 14px 18px', display: 'grid', gap: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Last updated: June 2026</div>
        {SECTIONS.map((s) => (
          <div key={s.h} className="owner-chartcard"><div className="owner-serif" style={{ fontWeight: 700, marginBottom: 6 }}>{s.h}</div><div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{s.p}</div></div>
        ))}
      </div>
    </>
  );
}
