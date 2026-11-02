import { useTechNav } from '../shell/nav';
const SECTIONS: { h: string; p: string }[] = [
  { h: 'Using AIPowerSalon Tech', p: 'The Technician app gives you your schedule, tickets, live service controls, cash confirmation, and earnings. Use it lawfully and keep your sign-in secure.' },
  { h: 'Your account', p: 'You are responsible for activity on your account. You can request account deactivation any time from More → Account Deactivation.' },
  { h: 'Tickets and cash', p: 'You can only act on tickets assigned to you and your branch. You cannot edit paid or closed tickets. Cash confirmations apply only to your own salon.' },
  { h: 'Acceptable use', p: 'Do not attempt to access other salons’ data or interfere with the service.' },
  { h: 'Changes', p: 'We may update these terms; continued use after an update means you accept the revised terms.' },
  { h: 'Contact', p: 'Questions? Email support@aipowersalon.com or contact your manager.' },
];
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function TechTermsScreen() {
  const nav = useTechNav();
  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={nav.back} aria-label="Back" className="tech-iconbtn"><Back /></button>
        <div style={{ margin: 0, fontSize: 19 }}>Terms of Service</div>
      </div>
      <div className="tech-main-2">
        <div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.9, marginBottom: 10 }}>The agreement for using the AIPowerSalon Technician app.</div>
        <div className="tech-muted" style={{ fontSize: 12, marginBottom: 10 }}>Last updated: June 2026</div>
        {SECTIONS.map((s) => (
          <div key={s.h} className="tech-card" style={{ marginBottom: 10, padding: 14 }}><div className="tech-h-serif" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{s.h}</div><div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.85 }}>{s.p}</div></div>
        ))}
      </div>
    </div>
  );
}
