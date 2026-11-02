import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PayNavProvider } from '../shell/nav';
import { CheckoutQueueScreen } from './CheckoutQueueScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: {
    readiness: vi.fn(),
    queue: vi.fn(),
  },
}));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

// The realtime client is mocked at the module boundary so the test can DELIVER an event and assert the screen
// reacted — rather than asserting the hook was merely called, which would pass even if nothing were wired.
const listeners: { event: ((d: { event: string }) => void)[]; reconcile: (() => void)[] } = { event: [], reconcile: [] };
// vi.mock is hoisted above const declarations, so the spy has to be hoisted with it.
const { connectSpy } = vi.hoisted(() => ({ connectSpy: vi.fn() }));
vi.mock('@aipowersalon/realtime-client', () => ({
  createRealtimeClient: () => ({
    connect: connectSpy,
    status: () => 'connected',
    onEvent: (fn: (d: { event: string }) => void) => { listeners.event.push(fn); return () => undefined; },
    onReconcile: (fn: () => void) => { listeners.reconcile.push(fn); return () => undefined; },
    onStatus: () => () => undefined,
  }),
  FallbackPoller: class { onStatus() {} stop() {} },
}));

const renderScreen = () => render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);

describe('CheckoutQueueScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); listeners.event = []; listeners.reconcile = []; });

  it('renders queue tickets with masked phone + formatted amount, and an honest readiness banner', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({
      count: 1,
      items: [{ ticketId: 'tk1', ticketNumber: '204', customerName: 'Jordan Lee', customerPhoneLast4: '1234', servicesLabel: 'Gel Manicure +1', totalDueCents: 3233, status: 'ready' }],
    });
    renderScreen();
    expect(await screen.findByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('$32.33')).toBeInTheDocument();
    expect(await screen.findByText('Ready to take payments', { exact: false })).toBeInTheDocument();
  });

  it('shows the Tap-to-Pay-not-set-up banner honestly when the device cannot take payment', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'tap_to_pay_setup_required', canTakePayment: false, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 0, items: [] });
    renderScreen();
    expect(await screen.findByText('Tap to Pay is not set up on this device yet.', { exact: false })).toBeInTheDocument();
  });

  it('every filter chip sends a filter the API accepts (wave 4: "In Service" / "Unpaid" sent in_service / unpaid → 400 INVALID_FILTER)', async () => {
    // the server's list-queries enum for GET /mobile-checkout/queue (modules/checkout/src/mobile-checkout/mobile-checkout.list-queries.ts)
    const SERVER_FILTERS = ['all', 'ready', 'in_progress', 'failed', 'paid'];
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 0, items: [] });
    renderScreen();
    const chips = await screen.findAllByRole('button');
    for (const label of ['All', 'Ready', 'In Progress', 'Failed']) {
      chips.find((b) => b.textContent === label)!.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    const sent = (mobileCheckoutApi.queue as any).mock.calls.map((c: any[]) => c[0]?.filter);
    expect(new Set(sent)).toEqual(new Set(['all', 'ready', 'in_progress', 'failed']));
    for (const f of sent) expect(SERVER_FILTERS).toContain(f);
  });

  it('shows an empty state when there are no tickets', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 0, items: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('No tickets to check out')).toBeInTheDocument());
  });
});

describe('CheckoutQueueScreen stays fresh (Constitution 9)', () => {
  beforeEach(() => { vi.clearAllMocks(); connectSpy.mockClear(); listeners.event = []; listeners.reconcile = []; });

  const item = (name: string) => ({ ticketId: 'tk1', ticketNumber: '204', customerName: name, customerPhoneLast4: '1234', servicesLabel: 'Gel Manicure', amountCents: 3233, status: 'ready' });

  it('THE BUG THIS FIXES: a ticket paid at the front desk leaves the manager list', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValueOnce({ count: 1, items: [item('Jordan Lee')] })
                                    .mockResolvedValue({ count: 0, items: [] });
    render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);
    expect(await screen.findByText('Jordan Lee')).toBeInTheDocument();

    listeners.event.forEach((fn) => fn({ event: 'ticket_paid' }));       // the POS takes the payment

    await waitFor(() => expect(screen.queryByText('Jordan Lee')).not.toBeInTheDocument());
  });

  it('an unrelated event does NOT refetch — a payment screen must not churn for a cash drawer', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 1, items: [item('Jordan Lee')] });
    render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);
    await screen.findByText('Jordan Lee');
    const before = (mobileCheckoutApi.queue as any).mock.calls.length;

    listeners.event.forEach((fn) => fn({ event: 'cash_drawer_movement' }));

    await new Promise((r) => setTimeout(r, 30));
    expect((mobileCheckoutApi.queue as any).mock.calls.length).toBe(before);
  });

  it('a reconcile (stream resumed after a gap) refetches', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 1, items: [item('Jordan Lee')] });
    render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);
    await screen.findByText('Jordan Lee');
    const before = (mobileCheckoutApi.queue as any).mock.calls.length;

    listeners.reconcile.forEach((fn) => fn());

    await waitFor(() => expect((mobileCheckoutApi.queue as any).mock.calls.length).toBeGreaterThan(before));
  });

  it('the stream is actually CONNECTED — registering listeners on a client that never connects delivers nothing', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 1, items: [item('Jordan Lee')] });
    render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);
    await screen.findByText('Jordan Lee');
    expect(connectSpy).toHaveBeenCalled();
  });

  it('a live refresh does NOT blank the list — no loading flash while another till closes a ticket', async () => {
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 1, items: [item('Jordan Lee')] });
    render(<PayNavProvider><CheckoutQueueScreen /></PayNavProvider>);
    await screen.findByText('Jordan Lee');

    listeners.event.forEach((fn) => fn({ event: 'checkout_total_recalculated' }));

    // The name stays on screen throughout: setItems(null) belongs to the filter/search path, not this one.
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
  });
});

describe('M6-6: the front desk sends a ticket to THIS phone', () => {
  beforeEach(() => { vi.clearAllMocks(); listeners.event = []; listeners.reconcile = []; });
  it('a checkout_sent_to_mobile for this phone shows the banner; one for another phone does not', async () => {
    const { DEVICE_ID } = await import('../util/session');
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.queue as any).mockResolvedValue({ count: 1, items: [{ ticketId: 'tk1', ticketNumber: '204', customerName: 'Jordan Lee', totalDueCents: 3233, status: 'ready' }] });
    renderScreen();
    await screen.findByText('Jordan Lee');
    listeners.event.forEach((fn) => fn({ event: 'checkout_sent_to_mobile', payload: { ticketId: 'tk1', deviceId: 'some-other-phone' } } as any));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('sent ticket', { exact: false })).not.toBeInTheDocument();
    listeners.event.forEach((fn) => fn({ event: 'checkout_sent_to_mobile', payload: { ticketId: 'tk1', deviceId: DEVICE_ID } } as any));
    expect(await screen.findByText('The front desk sent ticket #204 to this phone.', { exact: false })).toBeInTheDocument();
  });
});
