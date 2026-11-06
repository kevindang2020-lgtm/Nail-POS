import { useEffect, type ReactNode, type ComponentType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { EnableNotificationsBanner, pushPromptSnoozed, snoozePushPrompt } from '@aipowersalon/ui';
import { usePushPrompt } from '@aipowersalon/mobile-sdk/web-push';
import { useAuth } from '../auth/AuthContext';

// Five-tab bottom navigation per the reference (Home · Appointments · Deals · Wallet · Profile).
// Fixed to the bottom, safe-area aware, ≥48pt targets, active tab in the gold brand color. Each screen renders
// its own header, so the layout is just the scroll area + nav.
type IconProps = { active: boolean };
const stroke = (a: boolean) => (a ? 'var(--customer-primary)' : 'var(--customer-text-secondary)');
const Home = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
const Receipt = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6" /></svg>);
const Pin = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>);
const Cal = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const Star = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill={active ? 'var(--customer-primary)' : 'none'} stroke={stroke(active)} strokeWidth="2" strokeLinejoin="round"><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 18.8 6.2 21.7l1.1-6.4L2.6 9.8l6.5-.9z" /></svg>);
const Wallet = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12h3M3 9h13a2 2 0 012 2" /></svg>);
const User = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill="none" stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>);
const Sparkle = ({ active }: IconProps) => (<svg viewBox="0 0 24 24" fill={active ? 'var(--customer-primary)' : 'none'} stroke={stroke(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5l2.2 6 6 2.2-6 2.2L12 19l-2.2-6.1-6-2.2 6-2.2z" /></svg>);
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

/** Nov 6 2026: notification permission is asked from this banner's tap, never at sign-in. */
function PushPrompt() {
  const { principal } = useAuth();
  const p = usePushPrompt(!!principal, pushPromptSnoozed, snoozePushPrompt);
  return <EnableNotificationsBanner visible={p.visible} onEnable={p.enable} onDismiss={p.dismiss} reason="Get reminders for your appointments, your turn in line and your receipts." />;
}

export function CustomerLayout({ children }: { children: ReactNode }) {
  const nav = useNavigate();

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

      <PushPrompt />
      <main className="cust-main" style={{ width: '100%', maxWidth: 640, margin: '0 auto', minHeight: '100vh', boxSizing: 'border-box', paddingTop: 'max(14px, env(safe-area-inset-top))', paddingBottom: '76px' }}>{children}</main>
      <nav className="cust-nav" aria-label="Primary">
        {TABS.map(({ to, end, label, Icon }) => (
          <NavLink key={to} to={to} end={end || undefined} aria-label={label}>
            {({ isActive }) => (<><Icon active={isActive} /><span>{label}</span></>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
