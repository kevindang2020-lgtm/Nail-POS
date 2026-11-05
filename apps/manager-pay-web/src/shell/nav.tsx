import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// The Payment App's 4-tab bar plus a pushed-screen STACK for the checkout flow (ticket → tap-to-pay → success).
export type PayTab = 'checkout' | 'history' | 'reports' | 'account';
export type Screen =
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'tapToPay'; ticketId: string; idempotencyKey: string; amountCents: number }
  | { kind: 'success'; ticketId: string; amountCents: number };

interface PayNav {
  tab: PayTab;
  stack: Screen[];
  top: Screen | null;
  go: (t: PayTab) => void;
  openTicket: (ticketId: string) => void;
  openTapToPay: (ticketId: string, idempotencyKey: string, amountCents: number) => void;
  openSuccess: (ticketId: string, amountCents: number) => void;
  back: () => void;
  resetToCheckout: () => void;
}

const noop = () => {};
const Ctx = createContext<PayNav>({
  tab: 'checkout', stack: [], top: null, go: noop, openTicket: noop, openTapToPay: noop, openSuccess: noop, back: noop, resetToCheckout: noop,
});

export function PayNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<PayTab>('checkout');
  const [stack, setStack] = useState<Screen[]>([]);
  const value = useMemo<PayNav>(() => ({
    tab, stack, top: stack.length ? stack[stack.length - 1] : null,
    go: (t) => { setStack([]); setTab(t); },
    openTicket: (ticketId) => setStack([{ kind: 'ticket', ticketId }]),
    openTapToPay: (ticketId, idempotencyKey, amountCents) => setStack((s) => [...s, { kind: 'tapToPay', ticketId, idempotencyKey, amountCents }]),
    openSuccess: (ticketId, amountCents) => setStack((s) => [...s, { kind: 'success', ticketId, amountCents }]),
    back: () => setStack((s) => s.slice(0, -1)),
    resetToCheckout: () => { setStack([]); setTab('checkout'); },
  }), [tab, stack]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePayNav = () => useContext(Ctx);
