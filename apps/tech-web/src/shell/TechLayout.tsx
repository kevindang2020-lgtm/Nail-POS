import type { ReactNode } from 'react';
import { useTechNav, type TechTab } from './nav';
import { EnableNotificationsBanner, pushPromptSnoozed, snoozePushPrompt } from '@aipowersalon/ui';
import { usePushPrompt } from '@aipowersalon/mobile-sdk/web-push';
import { useAuth } from '../auth/AuthContext';

// Fixed, safe-area-aware 5-tab bottom navigation (Home · Schedule · Tickets · Earnings · More) matching the reference.
// Active tab uses champagne gold; ≥48pt targets; each screen renders its own header inside the scrollable area.
type IconProps = { active?: boolean };
const s = (a?: boolean) => (a ? 'var(--tech-primary)' : 'var(--tech-text-muted)');
const Home = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>);
const Cal = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
const Ticket = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8z" /><path d="M12 6v12" strokeDasharray="2 3" /></svg>);
const Dollar = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>);
const More = ({ active }: IconProps) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" /><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /><circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" /></svg>);

const TABS: { key: TechTab; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'schedule', label: 'Schedule', Icon: Cal },
  { key: 'tickets', label: 'Tickets', Icon: Ticket },
  { key: 'earnings', label: 'Earnings', Icon: Dollar },
  { key: 'more', label: 'More', Icon: More },
];

/** Nov 6 2026: notification permission is asked from this banner's tap, never at sign-in. */
function PushPrompt() {
  const { principal } = useAuth();
  const p = usePushPrompt(!!principal, pushPromptSnoozed, snoozePushPrompt);
  return <EnableNotificationsBanner visible={p.visible} onEnable={p.enable} onDismiss={p.dismiss} reason="Get alerts when a guest is assigned to you and when your turn is up." />;
}

export function TechLayout({ children }: { children: ReactNode }) {
  const { tab, pushed, go } = useTechNav();
  const activeTab = pushed ? null : tab;
  return (
    <div className="tech-app">

      <PushPrompt />
      <div className="tech-main">{children}</div>
      <nav className="tech-bottomnav" aria-label="Primary">
        {TABS.map(({ key, label, Icon }) => {
          const active = activeTab === key;
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
