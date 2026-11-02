import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// The Payment App's 4-tab bar plus a pushed-screen STACK for the checkout flow (ticket → handoff → tap-to-pay → success).
// Mandate §57–§61 / §133: while the phone is in the customer's hands (handoff, the tap, verifying) the navigation is
// LOCKED — no tab bar, no back, no history swipe into another customer's data; only "Return to Staff" (biometric) opens it.
export type PayTab = 'checkout' | 'history' | 'reports' | 'account';
export type Screen =
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'handoff'; ticketId: string; version: string; subtotalCents: number; balanceCents: number; tipCents: number; salonName?: string }
  | { kind: 'tapToPay'; ticketId: string; idempotencyKey: string; amountCents: number; handoff?: boolean; recovered?: boolean }
  | { kind: 'verifying'; ticketId: string; idempotencyKey: string; amountCents: number; handoff?: boolean }
  | { kind: 'success'; ticketId: string; amountCents: number; handoff?: boolean; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string };

interface PayNav {
  tab: PayTab;
  stack: Screen[];
  top: Screen | null;
  /** §60: customer-facing screens lock the navigation (no tabs, no back, no swipe into staff screens). */
  locked: boolean;
  go: (t: PayTab) => void;
  openTicket: (ticketId: string) => void;
  openHandoff: (s: Omit<Extract<Screen, { kind: 'handoff' }>, 'kind'>) => void;
  openTapToPay: (ticketId: string, idempotencyKey: string, amountCents: number, opts?: { handoff?: boolean; recovered?: boolean }) => void;
  openVerifying: (ticketId: string, idempotencyKey: string, amountCents: number, opts?: { handoff?: boolean }) => void;
  openSuccess: (ticketId: string, amountCents: number, opts?: { handoff?: boolean; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string }) => void;
  back: () => void;
  resetToCheckout: () => void;
  /** §61 Return to Staff: unlock after the device owner proved themselves (the caller verifies biometrics first). */
  returnToStaff: () => void;
}

const LOCKED_KINDS = new Set(['handoff', 'verifying']);
const noop = () => {};
const Ctx = createContext<PayNav>({
  tab: 'checkout', stack: [], top: null, locked: false, go: noop, openTicket: noop, openHandoff: noop, openTapToPay: noop, openVerifying: noop, openSuccess: noop, back: noop, resetToCheckout: noop, returnToStaff: noop,
});

function isLocked(top: Screen | null): boolean {
  if (!top) return false;
  if (LOCKED_KINDS.has(top.kind)) return true;
  return (top.kind === 'tapToPay' || top.kind === 'success') && !!top.handoff;
}

export function PayNavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<PayTab>('checkout');
  const [stack, setStack] = useState<Screen[]>([]);
  const top = stack.length ? stack[stack.length - 1] : null;
  const locked = isLocked(top);
  // §60: trap the browser / WebView history while locked so a swipe-back cannot leave the customer screen
  useEffect(() => {
    if (!locked || typeof window === 'undefined' || !window.history?.pushState) return;
    const push = () => { try { window.history.pushState({ apsLock: true }, ''); } catch { /* no history in this host */ } };
    push();
    const onPop = () => push();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [locked]);
  const value = useMemo<PayNav>(() => ({
    tab, stack, top, locked,
    go: (t) => { if (locked) return; setStack([]); setTab(t); },
    openTicket: (ticketId) => { if (locked) return; setStack([{ kind: 'ticket', ticketId }]); },
    openHandoff: (s) => setStack((st) => [...st, { kind: 'handoff', ...s }]),
    openTapToPay: (ticketId, idempotencyKey, amountCents, opts) => setStack((s) => [...s, { kind: 'tapToPay', ticketId, idempotencyKey, amountCents, handoff: opts?.handoff, recovered: opts?.recovered }]),
    openVerifying: (ticketId, idempotencyKey, amountCents, opts) => setStack((s) => [...s.filter((x) => x.kind !== 'tapToPay' && x.kind !== 'verifying'), { kind: 'verifying', ticketId, idempotencyKey, amountCents, handoff: opts?.handoff }]),
    openSuccess: (ticketId, amountCents, opts) => setStack((s) => [...s.filter((x) => x.kind !== 'tapToPay' && x.kind !== 'verifying'), { kind: 'success', ticketId, amountCents, handoff: opts?.handoff, cardBrand: opts?.cardBrand, cardLast4: opts?.cardLast4, paymentId: opts?.paymentId }]),
    // back is refused while locked (the customer holds the phone); a handoff screen's own Cancel goes through returnToStaff
    back: () => { if (locked) return; setStack((s) => s.slice(0, -1)); },
    resetToCheckout: () => { if (locked) return; setStack([]); setTab('checkout'); },
    returnToStaff: () => { setStack([]); setTab('checkout'); },
  }), [tab, stack, top, locked]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePayNav = () => useContext(Ctx);
