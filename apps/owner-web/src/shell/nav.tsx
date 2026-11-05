import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
export type OwnerTab = 'home' | 'live' | 'approvals' | 'branches' | 'reports' | 'staff' | 'more';
type Pushed = { kind: 'bookings' } | { kind: 'techDetail'; technicianId: string } | { kind: 'alerts' } | { kind: 'audit' } | { kind: 'expenses' } | { kind: 'hardwarePayment' } | { kind: 'cashHandoff' } | { kind: 'cashDrawer' } | { kind: 'cashSummary' } | { kind: 'privacy' } | { kind: 'terms' } | { kind: 'deleteAccount' } | { kind: 'aiPackages' } | { kind: 'tickets' } | { kind: 'profile' } | { kind: 'payroll'; periodId?: string } | { kind: 'customers' } | { kind: 'giftCards' } | { kind: 'inventory' } | { kind: 'marketing' } | { kind: 'payments' } | { kind: 'aiCenter' } | { kind: 'memberships' } | { kind: 'settings' } | { kind: 'notifications' } | null;
interface OwnerNav { tab: OwnerTab; pushed: Pushed; go: (t: OwnerTab) => void; openBookings: () => void; openTechDetail: (id: string) => void; openAlerts: () => void; openAudit: () => void; openExpenses: () => void; openHardwarePayment: () => void; openCashHandoff: () => void; openCashDrawer: () => void; openCashSummary: () => void; openPrivacy: () => void; openTerms: () => void; openDeleteAccount: () => void; openAiPackages: () => void; openTickets: () => void; openProfile: () => void; openPayroll: (periodId?: string) => void; openCustomers: () => void; openGiftCards: () => void; openInventory: () => void; openMarketing: () => void; openPayments: () => void; openAiCenter: () => void; openMemberships: () => void; openSettings: () => void; openNotifications: () => void; back: () => void }
const Ctx = createContext<OwnerNav>({ tab: 'home', pushed: null, go: () => {}, openBookings: () => {}, openTechDetail: () => {}, openAlerts: () => {}, openAudit: () => {}, openExpenses: () => {}, openHardwarePayment: () => {}, openCashHandoff: () => {}, openCashDrawer: () => {}, openCashSummary: () => {}, openPrivacy: () => {}, openTerms: () => {}, openDeleteAccount: () => {}, openAiPackages: () => {}, openTickets: () => {}, openProfile: () => {}, openPayroll: () => {}, openCustomers: () => {}, openGiftCards: () => {}, openInventory: () => {}, openMarketing: () => {}, openPayments: () => {}, openAiCenter: () => {}, openMemberships: () => {}, openSettings: () => {}, openNotifications: () => {}, back: () => {} });
export function OwnerNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<OwnerTab>(() => {
    try {
      const saved = sessionStorage.getItem('aps_owner_target_tab');
      if (saved) {
        sessionStorage.removeItem('aps_owner_target_tab');
        return saved as OwnerTab;
      }
    } catch { /* ignore */ }
    return 'home';
  });

  const [pushed, setPushed] = useState<Pushed>(() => {
    try {
      const saved = sessionStorage.getItem('aps_owner_target_pushed');
      if (saved) {
        sessionStorage.removeItem('aps_owner_target_pushed');
        return JSON.parse(saved);
      }
    } catch { /* ignore */ }
    return null;
  });
  const value = useMemo(() => ({
    tab, pushed,
    go: (t: OwnerTab) => { setPushed(null); setTab(t); },
    openBookings: () => setPushed({ kind: 'bookings' }),
    openTechDetail: (technicianId: string) => setPushed({ kind: 'techDetail', technicianId }),
    openAlerts: () => setPushed({ kind: 'alerts' }),
    openAudit: () => setPushed({ kind: 'audit' }),
    openExpenses: () => setPushed({ kind: 'expenses' }),
    openHardwarePayment: () => setPushed({ kind: 'hardwarePayment' }),
    openCashHandoff: () => setPushed({ kind: 'cashHandoff' }),
    openCashDrawer: () => setPushed({ kind: 'cashDrawer' }),
    openCashSummary: () => setPushed({ kind: 'cashSummary' }),
    openPrivacy: () => setPushed({ kind: 'privacy' }),
    openTerms: () => setPushed({ kind: 'terms' }),
    openDeleteAccount: () => setPushed({ kind: 'deleteAccount' }),
    openAiPackages: () => setPushed({ kind: 'aiPackages' }),
    openTickets: () => setPushed({ kind: 'tickets' }),
    openProfile: () => setPushed({ kind: 'profile' }),
    openPayroll: (periodId?: string) => setPushed({ kind: 'payroll', periodId }),
    openCustomers: () => setPushed({ kind: 'customers' }),
    openGiftCards: () => setPushed({ kind: 'giftCards' }),
    openInventory: () => setPushed({ kind: 'inventory' }),
    openMarketing: () => setPushed({ kind: 'marketing' }),
    openPayments: () => setPushed({ kind: 'payments' }),
    openAiCenter: () => setPushed({ kind: 'aiCenter' }),
    openMemberships: () => setPushed({ kind: 'memberships' }),
    openSettings: () => setPushed({ kind: 'settings' }),
    openNotifications: () => setPushed({ kind: 'notifications' }),
    back: () => setPushed(null),
  }), [tab, pushed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useOwnerNav = () => useContext(Ctx);
