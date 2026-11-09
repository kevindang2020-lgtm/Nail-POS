// Three Ways to Pay (SUNMI Nov 9 2026): three equal cards always shown, server states, holds, existing actions only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ channels: vi.fn(), check: vi.fn(), sendToPhone: vi.fn(), sendApp: vi.fn(), verifyApp: vi.fn() }));
vi.mock('../api/posPaymentChannelsApi', () => ({ posPaymentChannelsApi: { channels: m.channels, check: m.check } }));
vi.mock('../api/posMobilePaymentsApi', () => ({ posMobilePaymentsApi: { sendToPhone: m.sendToPhone } }));
vi.mock('../api/posSkipLineApi', () => ({ posSkipLineApi: { sendAppPayment: m.sendApp, verifyAppPayment: m.verifyApp } }));
import { PaymentChannelsDialog } from './PaymentChannelsDialog';

const ch = (key: string, o: Record<string, unknown> = {}) => ({ key, state: 'ready', reason: null, mode: 'uat', actionAllowed: true, actionHeldBy: null, lastVerifiedAt: '2026-11-09T10:00:00Z', facts: {}, ...o });
const resp = (o: Record<string, unknown> = {}) => ({
  checkedAt: '2026-11-09T10:00:00Z', branch: { id: 'b', name: 'Main' }, liveMode: false,
  merchant: { configured: true, masked: '••••4321', environment: 'sandbox', scope: 'tenant', status: 'active', pausedByPlatform: false, blockedReason: null },
  ticket: { id: 't1', number: '12', status: 'unpaid', inProgressVia: null, appPromptOpen: false, dueCents: 5388, paidCents: 0, balanceCents: 5388, paidVia: null, paidAt: null, hasCustomer: true },
  channels: [ch('clover_compact', { facts: { terminalLabel: 'Front desk', hsnMasked: '••••5678', merchantMasked: '••••4321' } }), ch('tap_to_pay_iphone', { facts: { devices: [{ deviceId: 'd1', label: 'Kevin iPhone', userName: 'Kevin' }], onlinePhones: 1, capablePhones: 1 } }), ch('customer_app', { facts: { appPaymentsEnabled: true, hostedTokenizer: true, customerSavedCards: 1 } })],
  ...o,
});
const renderIt = (props: Partial<{ ticketId: string | null; onUseClover: () => void; onClose: () => void }> = {}) => render(<MemoryRouter><PaymentChannelsDialog ticketId={'ticketId' in props ? props.ticketId! : 't1'} onClose={props.onClose ?? (() => {})} onUseClover={props.onUseClover ?? (() => {})} /></MemoryRouter>);
beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });

describe('Three Ways to Pay', () => {
  it('shows three channel cards with the server balance and no card-number field', async () => {
    m.channels.mockResolvedValue(resp());
    renderIt();
    const cards = await screen.findAllByTestId('payment-channel-card');
    expect(cards.map((c) => c.getAttribute('data-channel'))).toEqual(['clover_compact', 'tap_to_pay_iphone', 'customer_app']);
    expect(screen.getByTestId('pcw-balance').textContent).toContain('53.88');
    expect(within(cards[0]).getByText('••••5678', { exact: false })).toBeInTheDocument();
    expect(document.querySelector('input[autocomplete="cc-number"], input[name*="card" i], input[name*="cvv" i]')).toBeNull();
    expect(screen.getAllByText(/Test mode/).length).toBe(3);
  });
  it('a blocked channel stays visible with its reason and a disabled action', async () => {
    m.channels.mockResolvedValue(resp({ channels: [ch('clover_compact', { state: 'setup_required', reason: 'NO_TERMINAL', actionAllowed: false }), ch('tap_to_pay_iphone', { state: 'provider_pending', reason: 'APPLE_ENTITLEMENT_PENDING', actionAllowed: false }), ch('customer_app')] }));
    renderIt();
    const cards = await screen.findAllByTestId('payment-channel-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText(/No card terminal is paired/)).toBeInTheDocument();
    expect(within(cards[0]).getByTestId('pcw-use-clover')).toBeDisabled();
    expect(within(cards[1]).getByText(/Apple/)).toBeInTheDocument();
  });
  it('Use Clover Compact hands back to the workspace card button (no charge from here)', async () => {
    m.channels.mockResolvedValue(resp()); const use = vi.fn(); const close = vi.fn();
    renderIt({ onUseClover: use, onClose: close });
    fireEvent.click(await screen.findByTestId('pcw-use-clover'));
    expect(use).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalled();
  });
  it('send to phone and to the Customer App use the existing endpoints', async () => {
    m.channels.mockResolvedValue(resp()); m.sendToPhone.mockResolvedValue({ sent: true }); m.sendApp.mockResolvedValue({});
    renderIt();
    fireEvent.click(await screen.findByTestId('pcw-send-phone'));
    await waitFor(() => expect(m.sendToPhone).toHaveBeenCalledWith('t1', 'd1'));
    await waitFor(() => expect(screen.getByTestId('pcw-send-app')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('pcw-send-app'));
    await waitFor(() => expect(m.sendApp).toHaveBeenCalledWith('t1'));
  });
  it('a payment in progress holds every channel; unknown says verify first', async () => {
    const held = (by: string) => [ch('clover_compact', { actionAllowed: false, actionHeldBy: by }), ch('tap_to_pay_iphone', { actionAllowed: false, actionHeldBy: by, facts: { devices: [{ deviceId: 'd1', label: 'P' }] } }), ch('customer_app', { actionAllowed: false, actionHeldBy: by })];
    m.channels.mockResolvedValue(resp({ ticket: { ...resp().ticket, status: 'unknown', inProgressVia: 'clover_compact' }, channels: held('verify_first') }));
    renderIt();
    expect(await screen.findByText(/Do not charge again/)).toBeInTheDocument();
    expect(screen.getByTestId('pcw-use-clover')).toBeDisabled();
    expect(screen.getByTestId('pcw-send-phone')).toBeDisabled();
    expect(screen.getByTestId('pcw-send-app')).toBeDisabled();
    expect(screen.getByTestId('pcw-held-customer_app').textContent).toMatch(/Verify/);
  });
  it('Check Three Payment Channels is read-only and shows the screen-fit line', async () => {
    m.channels.mockResolvedValue(resp());
    m.check.mockResolvedValue({ overall: 'PROVIDER_APPROVAL_PENDING', checkedAt: '2026-11-09T10:00:00Z', checks: [{ key: 'live_mode', area: 'compliance', state: 'PROVIDER_APPROVAL_PENDING', reason: 'PRODUCTION_PAYMENTS_DISABLED' }, { key: 'no_side_effects', area: 'shared', state: 'PASSED', reason: null }] });
    renderIt();
    fireEvent.click(await screen.findByTestId('pcw-check'));
    const h = await screen.findByTestId('pcw-health');
    expect(await within(h).findByText(/until Fiserv certification/)).toBeInTheDocument();
    expect(within(h).getByTestId('pcw-chk-screen_fit')).toBeInTheDocument();
    expect(m.sendApp).not.toHaveBeenCalled(); expect(m.sendToPhone).not.toHaveBeenCalled();
  });
});
