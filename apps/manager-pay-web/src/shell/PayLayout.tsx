import type { ReactNode } from 'react';
import { usePayNav, type PayTab } from './nav';
import { useT } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// The phone shell every screen renders inside: persistent brand bar, a single scrolling content area, and the
// fixed 4-tab bottom nav (gold header logo, line-icon tabs).
// Mandate §58–§60: while the customer holds the phone (handoff / tap / verifying / success-in-handoff) the tab bar and
// the brand bar's staff affordances are NOT rendered — nothing to swipe or tap into the queue, history or reports.
type IconProps = { active: boolean };
const stroke = (a: boolean) => (a ? 'var(--pay-primary)' : 'var(--pay-text-muted)');
const CheckoutIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="3" /><line x1="2" y1="10" x2="22" y2="10" /><path d="M6 15h2" /><path d="M16 15h2" />
  </svg>
);
const HistoryIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5 3-1.5 3 1.5V8z" /><path d="M14 2v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const ReportsIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="13" y="7" width="3" height="10" rx="1" /><rect x="19" y="13" width="3" height="4" rx="1" />
  </svg>
);
const AccountIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const TABS: { key: PayTab; Icon: (p: IconProps) => ReactNode }[] = [
  { key: 'checkout', Icon: CheckoutIcon },
  { key: 'history', Icon: HistoryIcon },
  { key: 'reports', Icon: ReportsIcon },
  { key: 'account', Icon: AccountIcon },
];

const Brandbar = () => (
  <header className="brandbar">
    <img src="/brand/aipowersalon-header-logo.png" alt="AI PowerSalon" className="brandbar-logo" draggable={false} />
  </header>
);

export function PayLayout({ children, readyCount = 0 }: { children: ReactNode; readyCount?: number }) {
  const tr = useT();   // C6 §97 (Phase 13): tab labels in EN / VI
  const nav = usePayNav();
  if (nav.locked) {
    return (
      <div className="pay-app pay-handoff" data-locked="true">
        <Brandbar />
        <div className="pay-scroll">{children}</div>
      </div>
    );
  }
  return (
    <div className="pay-app">
      <Brandbar />
      <div className="pay-scroll">{children}</div>
      <nav className="pay-bottomnav" aria-label="Main">
        {TABS.map((t) => {
          const active = nav.tab === t.key && !nav.top;
          const label = tr(t.key === 'account' ? 'pay.nav.more' : `nav.${t.key}`);
          return (
            <button key={t.key} className={active ? 'active' : ''} onClick={() => nav.go(t.key)} aria-label={label} aria-current={active ? 'page' : undefined}>
              <t.Icon active={active} />
              <span>{label}</span>
              {t.key === 'checkout' && readyCount > 0 && <span className="pay-navbadge" aria-label={`${readyCount} ready for payment`}>{readyCount}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
