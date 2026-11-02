import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PayNavProvider, usePayNav } from './nav';
import { PayLayout } from './PayLayout';

// Mandate §57–§61 / §133: Customer Handoff Mode locks the navigation — no tab bar, no back, no tab switch; only
// Return to Staff unlocks it.
let nav: ReturnType<typeof usePayNav>;
function Probe() { nav = usePayNav(); return <div>top:{nav.top?.kind ?? 'none'}</div>; }
const renderShell = () => render(<PayNavProvider><PayLayout><Probe /></PayLayout></PayNavProvider>);

describe('Customer Handoff Mode navigation lock', () => {
  it('hides the tab bar and refuses back / tab switches while the customer holds the phone', () => {
    renderShell();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    act(() => nav.openTicket('tk1'));
    act(() => nav.openHandoff({ ticketId: 'tk1', version: 'v1', subtotalCents: 3000, balanceCents: 3233, tipCents: 0 }));
    expect(nav.locked).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    act(() => nav.back()); act(() => nav.go('history')); act(() => nav.resetToCheckout()); act(() => nav.openTicket('tk-other'));
    expect(screen.getByText('top:handoff')).toBeInTheDocument();
    act(() => nav.openTapToPay('tk1', 'K1', 3233, { handoff: true }));
    expect(nav.locked).toBe(true);
    act(() => nav.openSuccess('tk1', 3233, { handoff: true }));
    expect(nav.locked).toBe(true);
    act(() => nav.back());
    expect(screen.getByText('top:success')).toBeInTheDocument();
    act(() => nav.returnToStaff());
    expect(nav.locked).toBe(false);
    expect(screen.getByText('top:none')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('a staff-mode payment (no handoff) keeps the navigation open', () => {
    renderShell();
    act(() => nav.openTicket('tk1'));
    act(() => nav.openTapToPay('tk1', 'K1', 3233));
    expect(nav.locked).toBe(false);
    act(() => nav.openVerifying('tk1', 'K1', 3233));
    expect(nav.locked).toBe(true);   // Verifying Payment never lets anyone leave mid-answer
  });
});
