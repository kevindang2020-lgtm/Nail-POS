import type { ReactNode } from 'react';
import { SalonSwitcher } from './SalonSwitcher';
import { useOwnerNav, type OwnerTab } from './nav';
import { OwnerBranchSelector } from './OwnerBranchSelector';

// Fixed, safe-area-aware 5-tab bottom navigation (Home · Live · Approvals · Reports · More) matching the reference
// poster. Active tab uses champagne gold; ≥48pt targets; each screen renders its own header inside the scroll area.
type IconProps = { active: boolean };
const s = (a: boolean) => (a ? 'var(--owner-primary)' : 'var(--owner-text-muted)');
const Home = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
const Live = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 8L9 4l-3 8H2" /></svg>);
const Reports = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" /><rect x="13" y="7" width="3" height="10" /></svg>);
const Approvals = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>);
const More = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2.4" strokeLinecap="round"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>);

const TABS: { key: OwnerTab; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'live', label: 'Live', Icon: Live },
  { key: 'approvals', label: 'Approvals', Icon: Approvals },
  { key: 'reports', label: 'Reports', Icon: Reports },
  { key: 'more', label: 'More', Icon: More },
];

export function OwnerLayout({ children }: { children: ReactNode }) {
  const { tab, go } = useOwnerNav();
  return (
    <div className="owner-app">
      <header className="brandbar">

        {/* SALON first, then BRANCH within it. A branch only means anything inside a salon, so the salon switcher
            sits above the existing branch selector rather than replacing it. */}
        <SalonSwitcher />
      </header>
      <OwnerBranchSelector />
      <div className="owner-scroll">{children}</div>
      <nav className="owner-bottomnav" aria-label="Primary">
        {TABS.map(({ key, label, Icon }) => {
          const active = tab === key || (key === 'more' && (tab === 'branches' || tab === 'staff'));
          return (
            <button key={key} className={active ? 'active' : ''} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => go(key)}>
              <Icon active={active} /><span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
