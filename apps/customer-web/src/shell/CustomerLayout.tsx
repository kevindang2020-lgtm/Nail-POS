import { useEffect, type ReactNode, type ComponentType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useRemoteFlag, useModuleNotice, useT } from '@aipowersalon/mobile-sdk';

// Five-tab bottom navigation per the reference (Home · Appointments · Deals · Wallet · Profile).
// Fixed to the bottom, safe-area aware, ≥48pt targets, active tab in the gold brand color. Each screen renders
// its own header, so the layout is just the scroll area + nav.
type IconProps = { active: boolean };
const stroke = (a: boolean) => (a ? 'var(--customer-primary)' : 'var(--customer-text-secondary)');
const Home = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
const Cal = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const Wallet = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12h3M3 9h13a2 2 0 012 2" /></svg>);
const User = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>);
const Tag = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-7 7a2 2 0 0 1-2.8 0l-7.5-7.5A2 2 0 0 1 3 11.5z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>);

type Tab = { to: string; end?: boolean; label: string; Icon: ComponentType<IconProps> };
// Reference bottom navigation: Home · Appointments · Deals · Wallet · Profile.
// Find Salons, Showcase, Rewards, and Receipts remain fully routed — reachable from Home shortcuts and Profile rows.
const TABS: Tab[] = [
  { to: '/', end: true, label: 'Home', Icon: Home },
  { to: '/appointments', label: 'Appointments', Icon: Cal },
  { to: '/deals', label: 'Deals', Icon: Tag },
  { to: '/wallet', label: 'Wallet', Icon: Wallet },
  { to: '/profile', label: 'Profile', Icon: User },
];

/** '/' → nav.home, '/appointments' → nav.appointments … (a tab without a key keeps its English label). */
const navKey = (to: string) => 'nav.' + (to === '/' ? 'home' : to.replace(/^\//, ''));

export function CustomerLayout({ children }: { children: ReactNode }) {
  const tr = useT();   // C6 §97 (Phase 13): tab labels in EN / VI
  const nav = useNavigate();
  // BUILD_PLAN Phase 13 B (Constitution 6 §52, §54): the Deals tab follows the remote flag `deals` (/app-config) and hides
  // while the deals engine kill switch is on — no store release needed to pull a broken deals screen.
  const dealsFlag = useRemoteFlag('deals', true);
  const dealsDown = useModuleNotice('deals');
  const tabs = dealsFlag && !dealsDown ? TABS : TABS.filter((t) => t.to !== '/deals');

  useEffect(() => {
    try {
      const target = sessionStorage.getItem('aps_customer_target_route');
      if (target) {
        sessionStorage.removeItem('aps_customer_target_route');
        nav(target, { replace: true });
      }
    } catch { /* ignore */ }
  }, [nav]);
  return (
    <div className="cust-app" style={{ minHeight: '100vh' }}>

      <main className="cust-main" style={{ maxWidth: 560, width: '100%', margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', paddingTop: 'max(14px, env(safe-area-inset-top, 47px))' }}>{children}</main>
      <nav className="cust-nav" aria-label="Primary">
        {tabs.map(({ to, end, label, Icon }) => (
          <NavLink key={to} to={to} end={end || undefined} aria-label={tr(navKey(to), undefined) === navKey(to) ? label : tr(navKey(to))}>
            {({ isActive }) => (<><Icon active={isActive} /><span>{tr(navKey(to)) === navKey(to) ? label : tr(navKey(to))}</span></>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
