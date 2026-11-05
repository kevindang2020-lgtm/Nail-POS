import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// Lightweight in-app navigation for the technician phone app (the app uses a state machine, not a URL router).
// Five primary tabs plus two pushed views: a ticket detail (by id) and the Queue screen.
export type TechTab = 'home' | 'schedule' | 'tickets' | 'earnings' | 'more';
type Pushed = { kind: 'ticket'; ticketId: string } | { kind: 'queue' } | { kind: 'notifications' } | { kind: 'settings' } | { kind: 'profile' } | { kind: 'followups' } | { kind: 'cashPending' } | { kind: 'cashHandoff' } | { kind: 'privacy' } | { kind: 'terms' } | { kind: 'deleteAccount' } | { kind: 'reportProduct' } | { kind: 'workplaces' } | { kind: 'payroll' } | { kind: 'myDeals' } | { kind: 'messages' } | { kind: 'serviceHistory' } | { kind: 'help' } | null;

interface TechNav {
  tab: TechTab; pushed: Pushed;
  go: (t: TechTab) => void;
  openTicket: (id: string) => void;
  openQueue: () => void;
  openNotifications: () => void;
  openSettings: () => void;
  openProfile: () => void;
  openFollowUps: () => void;
  openCashPending: () => void;
  openServiceHistory: () => void;
  openCashHandoff: () => void;
  openPrivacy: () => void;
  openTerms: () => void;
  openDeleteAccount: () => void;
  openReportProduct: () => void;
  openWorkplaces: () => void;
  openPayroll: () => void;
  openMyDeals: () => void;
  openMessages: () => void;
  openHelp: () => void;
  back: () => void;
}
const Ctx = createContext<TechNav | null>(null);
export const useTechNav = (): TechNav => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTechNav must be used within TechNavProvider');
  return v;
};

export function TechNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TechTab>(() => {
    try {
      const saved = sessionStorage.getItem('aps_tech_target_tab');
      if (saved) {
        sessionStorage.removeItem('aps_tech_target_tab');
        return saved as TechTab;
      }
    } catch { /* ignore */ }
    return 'home';
  });

  const [pushed, setPushed] = useState<Pushed>(() => {
    try {
      const saved = sessionStorage.getItem('aps_tech_target_pushed');
      if (saved) {
        sessionStorage.removeItem('aps_tech_target_pushed');
        return JSON.parse(saved);
      }
    } catch { /* ignore */ }
    return null;
  });
  const value = useMemo<TechNav>(() => ({
    tab, pushed,
    go: (t) => { setPushed(null); setTab(t); },
    openTicket: (id) => setPushed({ kind: 'ticket', ticketId: id }),
    openQueue: () => setPushed({ kind: 'queue' }),
    openNotifications: () => setPushed({ kind: 'notifications' }),
    openSettings: () => setPushed({ kind: 'settings' }),
    openProfile: () => setPushed({ kind: 'profile' }),
    openFollowUps: () => setPushed({ kind: 'followups' }),
    openCashPending: () => setPushed({ kind: 'cashPending' }),
    openServiceHistory: () => setPushed({ kind: 'serviceHistory' }),
    openCashHandoff: () => setPushed({ kind: 'cashHandoff' }),
    openPrivacy: () => setPushed({ kind: 'privacy' }),
    openTerms: () => setPushed({ kind: 'terms' }),
    openDeleteAccount: () => setPushed({ kind: 'deleteAccount' }),
    openReportProduct: () => setPushed({ kind: 'reportProduct' }),
    openWorkplaces: () => setPushed({ kind: 'workplaces' }),
    openPayroll: () => setPushed({ kind: 'payroll' }),
    openMyDeals: () => setPushed({ kind: 'myDeals' }),
    openMessages: () => setPushed({ kind: 'messages' }),
    openHelp: () => setPushed({ kind: 'help' }),
    back: () => setPushed(null),
  }), [tab, pushed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
