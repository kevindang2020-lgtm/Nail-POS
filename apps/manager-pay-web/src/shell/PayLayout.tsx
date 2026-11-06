import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { usePayNav, type PayTab } from './nav';
import { EnableNotificationsBanner, pushPromptSnoozed, snoozePushPrompt } from '@aipowersalon/ui';
import { pushPermission, enablePush } from '../lib/push';
import logoupper from '../../public/brand/taptopay.png';
type IconProps = { active: boolean };
const s = (a: boolean) => (a ? 'var(--pay-primary)' : 'var(--pay-text-muted)');

const CheckoutIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <line x1="2" y1="10" x2="22" y2="10" />
    <path d="M6 15h2" />
    <path d="M16 15h2" />
  </svg>
);

const HistoryIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5 3-1.5 3 1.5V8z" />
    <path d="M14 2v6h6" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const ReportsIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="6" rx="1" />
    <rect x="13" y="7" width="3" height="10" rx="1" />
    <rect x="19" y="13" width="3" height="4" rx="1" />
  </svg>
);

const AccountIcon = ({ active }: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={s(active)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const TABS: { key: PayTab; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { key: 'checkout', label: 'Checkout', Icon: CheckoutIcon },
  { key: 'history', label: 'History', Icon: HistoryIcon },
  { key: 'reports', label: 'Reports', Icon: ReportsIcon },
  { key: 'account', label: 'Account', Icon: AccountIcon },
];

/** Nov 6 2026: notification permission is asked from this banner's tap, never at sign-in. PayLayout renders only signed in. */
function PushPrompt() {
  const [state, setState] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { let alive = true; void pushPermission().then((p) => { if (alive) setState(p); }); return () => { alive = false; }; }, []);
  const visible = state === 'prompt' && !hidden && !pushPromptSnoozed();
  return (
    <EnableNotificationsBanner visible={visible} reason="Get alerts when a ticket is ready to collect and when a payment goes through."
      onEnable={async () => { const ok = await enablePush(); if (ok) setHidden(true); return ok; }}
      onDismiss={() => { snoozePushPrompt(); setHidden(true); }} />
  );
}

export function PayLayout({ children }: { children: ReactNode }) {
  const nav = usePayNav();
  return (
    <div className="pay-app">
      <header className="brandbar">
        <img
          src={logoupper}
          alt="AI PowerSalon"
          className="brandbar-logo"
        />
      </header>
      <PushPrompt />
      <div className="pay-scroll">{children}</div>
      <nav className="pay-bottomnav" aria-label="Main Navigation">
        {TABS.map((t) => {
          const active = nav.tab === t.key && !nav.top;
          return (
            <button
              key={t.key}
              className={active ? 'active' : ''}
              onClick={() => nav.go(t.key)}
              aria-label={t.label}
              aria-current={active ? 'page' : undefined}
            >
              <t.Icon active={active} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
