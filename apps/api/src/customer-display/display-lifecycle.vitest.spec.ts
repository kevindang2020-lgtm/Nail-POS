// display-lifecycle.vitest.spec.ts — 23-inch dual-screen spec §36–§46, §96, §100–§103, §107: the display FOLLOWS the
// checkout (its own device channel + the session and ticket rooms), says "Verifying payment" when a card charge lost
// its answer, is released only once the checkout is unequivocally complete, and never shows a finished customer again.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { CustomerDisplayService, DisplayError, PAYMENT_VERIFY_AFTER_MS, STALE_COMPLETED_MS } from './customer-display.service';
import { DEFAULT_CHECKOUT_SETTINGS, buildCustomerDisplayCheckout, computeTotals } from '@aipowersalon/checkout';
import type { CustomerDisplayCheckout } from '@aipowersalon/api-contracts/customer';
import type { DisplayDataPort, DisplaySessionRow } from './customer-display.repository';

const DEVICE_TOKEN = 'device-token-1';
const DEVICE = { id: 'dev-1', tenantId: 't1', branchId: 'b1' };

function row(over: Partial<DisplaySessionRow> = {}): DisplaySessionRow {
  return {
    id: 'sess-1', tenantId: 't1', branchId: 'b1', state: 'showing_ticket', ticketId: 'tk-1', ticketNumber: '#12', customerId: 'c1',
    publicTokenHash: 'x', selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: new Date(Date.now() + 600_000).toISOString(),
    closedAt: null, ticketStatus: 'ready_for_checkout', lastPaymentStatus: null, lastPaymentAt: null, ticketPaidAt: null, changedAtMs: 1_000, ...over,
  };
}

// The ticket the session points at, projected by the checkout module's own builder (as KyselyCheckoutRepository does).
function projectionFor(r: DisplaySessionRow, over: { tipCents?: number; discountCents?: number; method?: 'card' | 'cash' } = {}): CustomerDisplayCheckout {
  const lines = [{ serviceName: 'Gel Manicure', technicianName: 'Olivia Tran', priceCents: 4500 }, { serviceName: 'Spa Pedicure', technicianName: 'Lisa Ngo', priceCents: 500 }];
  const discount = over.discountCents ?? 0;
  const totals = computeTotals(5000 - discount, over.tipCents ?? 0, DEFAULT_CHECKOUT_SETTINGS, over.method ?? 'card', 0);
  return buildCustomerDisplayCheckout({ ticketNumber: '#12', createdAt: '2026-10-06T15:00:00.000Z', ticketStatus: r.ticketStatus === 'paid' ? 'paid' : 'ready_for_payment',
    lines, discountCents: discount, totals, payments: r.ticketStatus === 'paid' ? [{ method: 'cash', amountCents: totals.totalDueCents, status: 'approved' }] : [] });
}

function harness(session: DisplaySessionRow | null, opts: { ticket?: { tipCents?: number; discountCents?: number; method?: 'card' | 'cash' } } = {}) {
  let current = session;
  const ticket = { ...(opts.ticket ?? {}) };
  const writes: string[] = [];
  const closed: string[] = [];
  const emitted: { room: string; event: string; payload: any }[] = [];
  const repo: Partial<DisplayDataPort> = {
    async deviceByToken(hash: string) { return hash === createHash('sha256').update(DEVICE_TOKEN).digest('hex') ? DEVICE : null; },
    async currentSessionForDevice() { return current; },
    async closeSessionCompleted(tenantId: string, id: string) { if (!current || current.id !== id || current.tenantId !== tenantId) return false; closed.push(id); current = null; return true; },
    async resolveSettings() { return { ...DEFAULT_CHECKOUT_SETTINGS }; },
    async checkoutProjection(_t: string, _b: string | null, ticketId: string) { return current && current.ticketId === ticketId ? projectionFor(current, ticket) : null; },
    async getSession(id: string) { return current && current.id === id ? current : null; },
    async applyTip(_id: string, tipCents: number) { writes.push('session.tip=' + tipCents); if (current) current = { ...current, state: 'tip_selected', selectedTipCents: tipCents }; },
    async setTicketTipFromDisplay(_r: any, tipCents: number) { writes.push('ticket.tip=' + tipCents); ticket.tipCents = tipCents; },
    async applyMethod(_id: string, method: string) { writes.push('session.method=' + method); },
    async setTicketMethodFromDisplay(_r: any, method: 'card' | 'cash') { writes.push('ticket.method=' + method); ticket.method = method; },
    async salonName() { return 'Luxury Nails'; },
    async customerFirstName() { return 'Sophia'; },
  };
  const rt = {
    toTenant: (ctx: any, event: string, payload: any) => emitted.push({ room: `tenant:${ctx.tenantId}:branch:${ctx.branchId}`, event, payload }),
    toCustomerDisplayDevice: (id: string, event: string, payload: any) => emitted.push({ room: `customer_display:device:${id}`, event, payload }),
    toCustomerDisplay: (id: string, event: string, payload: any) => emitted.push({ room: `customer_display:${id}`, event, payload }),
    toTechnician() {}, toTicket() {}, toOwner() {}, toPlatform() {},
  };
  const svc = new CustomerDisplayService(repo as DisplayDataPort, rt as any);
  return { svc, closed, emitted, writes, ticket, get current() { return current; } };
}

describe('device channel (§100)', () => {
  it('an IDLE display still subscribes to its own channel — before this it subscribed to nothing and never heard a checkout start', async () => {
    const h = harness(null);
    expect(await h.svc.deviceRooms(DEVICE_TOKEN)).toEqual(['customer_display:device:dev-1']);
  });
  it('with a checkout attached: the device channel, the session room and the ticket room (every POS change to the ticket)', async () => {
    const h = harness(row());
    expect(await h.svc.deviceRooms(DEVICE_TOKEN)).toEqual(['customer_display:device:dev-1', 'customer_display:sess-1', 'ticket:tk-1']);
  });
  it('an unknown device token subscribes to nothing', async () => {
    const h = harness(row());
    expect(await h.svc.deviceRooms('forged')).toEqual([]);
  });
});

describe('state carries its session and version (§101)', () => {
  it('the checkout state names its session and version; the idle state names neither', async () => {
    const busy = await harness(row({ changedAtMs: 42_000 })).svc.getDeviceState(DEVICE_TOKEN);
    expect(busy.sessionId).toBe('sess-1');
    expect(busy.version).toBe(42_000);
    const idle = await harness(null).svc.getDeviceState(DEVICE_TOKEN);
    expect(idle.state).toBe('idle');
    expect(idle.sessionId).toBeUndefined();
    expect(idle.customer).toBeUndefined();
    expect(idle.ticket).toBeUndefined();
  });
});

describe('payment in flight (§40–§41)', () => {
  it('a card charge that started moments ago shows Processing', async () => {
    const s = await harness(row({ lastPaymentStatus: 'processing', lastPaymentAt: new Date().toISOString() })).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('payment_processing');
  });
  it('a charge whose answer never came back shows Verifying (never an invitation to pay again)', async () => {
    const at = new Date(Date.now() - PAYMENT_VERIFY_AFTER_MS - 1_000).toISOString();
    const s = await harness(row({ lastPaymentStatus: 'processing', lastPaymentAt: at })).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('payment_verifying');
  });
  it('a verifying charge outranks an expired session clock — money in flight is never shown as "expired"', async () => {
    const at = new Date(Date.now() - PAYMENT_VERIFY_AFTER_MS - 1_000).toISOString();
    const s = await harness(row({ lastPaymentStatus: 'processing', lastPaymentAt: at, expiresAt: new Date(Date.now() - 1_000).toISOString() })).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('payment_verifying');
  });
  it('only a paid ticket is payment_success', async () => {
    expect((await harness(row({ lastPaymentStatus: 'approved' })).svc.getDeviceState(DEVICE_TOKEN)).state).not.toBe('payment_success');
    expect((await harness(row({ ticketStatus: 'paid', ticketPaidAt: new Date().toISOString() })).svc.getDeviceState(DEVICE_TOKEN)).state).toBe('payment_success');
  });
});

describe('release after the 3-second completed screen (§43–§46, §96)', () => {
  const paid = () => row({ ticketStatus: 'paid', ticketPaidAt: new Date().toISOString(), lastPaymentStatus: 'approved' });

  it('a completed checkout is released: the session ends, the device and the POS hear it, the display gets the idle state', async () => {
    const h = harness(paid());
    const s = await h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1');
    expect(h.closed).toEqual(['sess-1']);
    expect(s.state).toBe('idle');
    expect(s.customer).toBeUndefined();
    expect(s.ticket).toBeUndefined();
    expect(s.sessionId).toBeUndefined();
    expect(s.totals.totalDueCents).toBe(0);
    expect(h.emitted.map((e) => `${e.room}|${e.event}`)).toEqual([
      'customer_display:device:dev-1|customer_display_completed',
      'tenant:t1:branch:b1|customer_display_completed',
    ]);
    // after the release, the device state is idle — the customer cannot come back
    expect((await h.svc.getDeviceState(DEVICE_TOKEN)).state).toBe('idle');
  });

  it('a checkout that is NOT complete cannot be released (processing, verifying, unpaid)', async () => {
    for (const r of [row(), row({ lastPaymentStatus: 'processing', lastPaymentAt: new Date().toISOString() }),
      row({ lastPaymentStatus: 'processing', lastPaymentAt: new Date(Date.now() - PAYMENT_VERIFY_AFTER_MS - 1).toISOString() })]) {
      const h = harness(r);
      await expect(h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1')).rejects.toBeInstanceOf(DisplayError);
      expect(h.closed).toEqual([]);
    }
  });

  it('a paid card checkout is released without waiting for any signature (Kevin, Oct 6 2026: the Clover terminal takes it)', async () => {
    const h = harness(paid());
    expect((await h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1')).state).toBe('idle');
    expect(h.closed).toEqual(['sess-1']);
  });

  it('a STALE release (the POS already attached the next customer) changes nothing and returns the new checkout', async () => {
    const h = harness(row({ id: 'sess-2', ticketId: 'tk-2' }));
    const s = await h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1');
    expect(h.closed).toEqual([]);
    expect(s.sessionId).toBe('sess-2');
    expect(h.emitted).toEqual([]);
  });

  it('releasing twice is harmless (idempotent)', async () => {
    const h = harness(paid());
    await h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1');
    const again = await h.svc.releaseForDevice(DEVICE_TOKEN, 'sess-1');
    expect(again.state).toBe('idle');
    expect(h.closed).toEqual(['sess-1']);
  });

  it('refuses a forged device token and a missing session id', async () => {
    const h = harness(paid());
    await expect(h.svc.releaseForDevice('forged', 'sess-1')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.releaseForDevice(DEVICE_TOKEN, undefined)).rejects.toMatchObject({ code: 'invalid' });
    expect(h.closed).toEqual([]);
  });
});

describe('restart long after a checkout finished (§103, §107)', () => {
  it('a completed checkout older than the stale window is closed on read and never re-shown', async () => {
    const h = harness(row({ ticketStatus: 'paid', ticketPaidAt: new Date(Date.now() - STALE_COMPLETED_MS - 1_000).toISOString() }));
    const s = await h.svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('idle');
    expect(s.customer).toBeUndefined();
    expect(h.closed).toEqual(['sess-1']);
    expect(h.emitted.some((e) => e.event === 'customer_display_completed' && e.payload.reason === 'stale')).toBe(true);
  });
  it('a checkout restored DURING checkout (unpaid, or just paid) is shown as it is', async () => {
    expect((await harness(row()).svc.getDeviceState(DEVICE_TOKEN)).sessionId).toBe('sess-1');
    const justPaid = await harness(row({ ticketStatus: 'paid', ticketPaidAt: new Date().toISOString() })).svc.getDeviceState(DEVICE_TOKEN);
    expect(justPaid.state).toBe('payment_success');
    expect(justPaid.customer?.firstName).toBe('Sophia');
  });
});

describe('§2/§5 check-in stays on the left while the checkout takes the right panel', () => {
  const withKiosk = (session: DisplaySessionRow | null, slug: string | null = 'lux-b1') => {
    const h = harness(session);
    const asked: string[] = [];
    const svc = new CustomerDisplayService((h.svc as any).repo, (h.svc as any).rt, undefined, { slugForBranch: async (t: string, b: string | null) => { asked.push(`${t}/${b}`); return slug; } });
    return { ...h, svc, asked };
  };
  it('a device\'s checkout state carries its branch\'s Go Check-In slug (it used to come with the idle state only)', async () => {
    const h = withKiosk(row());
    const s = await h.svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('ticket_review');
    expect(s.goCheckInSlug).toBe('lux-b1');
    expect(h.asked).toEqual(['t1/b1']);                                      // the DEVICE's tenant and branch
  });
  it('…and so does every state a device action returns (tip, method)', async () => {
    const h = withKiosk(row());
    expect((await h.svc.submitTipForDevice(DEVICE_TOKEN, { tipType: 'percent', percent: 20 })).goCheckInSlug).toBe('lux-b1');
    expect((await h.svc.submitMethodForDevice(DEVICE_TOKEN, 'cash')).goCheckInSlug).toBe('lux-b1');
  });
  it('a branch without a kiosk: no slug, the checkout is unaffected', async () => {
    const h = withKiosk(row(), null);
    const s = await h.svc.getDeviceState(DEVICE_TOKEN);
    expect(s.state).toBe('ticket_review');
    expect(s.goCheckInSlug).toBeUndefined();
  });
  it('a one-off checkout link (no device) never carries a check-in', async () => {
    const h = withKiosk(row({ publicTokenHash: createHash('sha256').update('link-token').digest('hex') }));
    const s = await h.svc.getState('sess-1', 'link-token');
    expect(s.state).toBe('ticket_review');
    expect(s.goCheckInSlug).toBeUndefined();
    expect(h.asked).toEqual([]);
  });
});

describe('every number on the display comes from the ticket (§35, §38)', () => {
  it('the state carries the full customer-safe checkout and its totals are the projection\'s', async () => {
    const s = await harness(row(), { ticket: { tipCents: 1000 } }).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.checkout?.lines.map((l) => `${l.name}/${l.technicianName}`)).toEqual(['Gel Manicure/Olivia', 'Spa Pedicure/Lisa']);
    expect(s.totals.totalDueCents).toBe(s.checkout!.totalCents);
    expect(s.totals.tipCents).toBe(1000);
    expect(s.ticket?.services.map((x) => x.serviceName)).toEqual(['Gel Manicure', 'Spa Pedicure']);
  });
  it('THE UNIT-1 GAP, closed: a tip set at the POS (on the ticket) shows on the display — the session copy is ignored', async () => {
    const s = await harness(row({ selectedTipCents: 0 }), { ticket: { tipCents: 2060 } }).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.selectedTipCents).toBe(2060);
    expect(s.totals.tipCents).toBe(2060);
    expect(s.tipOptions.find((o) => o.selected)?.amountCents ?? s.selectedTipCents).toBe(2060);
  });
  it('a tip percent is of the EFFECTIVE subtotal (after discounts) — the POS\'s own rule — and it lands on the ticket', async () => {
    const h = harness(row(), { ticket: { discountCents: 1000 } });
    const s = await h.svc.submitTipForDevice(DEVICE_TOKEN, { tipType: 'percent', percent: 20 });
    expect(h.writes).toEqual(['session.tip=800', 'ticket.tip=800']);   // 20 % of $40.00, not of $50.00
    expect(s.selectedTipCents).toBe(800);
    expect(s.state).toBe('tip_selected');
  });
  // Fiserv master build §9 (Nov 4 2026): no local card fee exists before the card is read (funding unknown; an enrolled
  // merchant's surcharge is provider-assessed), so card and cash show the same total until a provider fee is recorded.
  it('the customer\'s card/cash choice becomes the ticket\'s method; no local card fee — the totals match', async () => {
    const h = harness(row());
    const before = await h.svc.getDeviceState(DEVICE_TOKEN);
    const after = await h.svc.submitMethodForDevice(DEVICE_TOKEN, 'cash');
    expect(h.writes).toEqual(['session.method=cash', 'ticket.method=cash']);
    expect(before.checkout!.customerFeeCents).toBe(0);
    expect(after.checkout!.customerFeeCents).toBe(0);
    expect(after.totals.totalDueCents).toBe(before.totals.totalDueCents);
  });
  it('the idle state carries no checkout at all', async () => {
    const s = await harness(null).svc.getDeviceState(DEVICE_TOKEN);
    expect(s.checkout).toBeUndefined();
    expect(s.ticket).toBeUndefined();
  });
});

// Dual-Screen mandate §104: the display API's refusals carry the STANDARD codes (the display and the POS react to them).
describe('§104 standard codes on the display API', () => {
  it('an unknown session is DISPLAY_SESSION_NOT_FOUND; no checkout attached is DISPLAY_SESSION_NOT_FOUND too', async () => {
    const h = harness(null);
    await expect(h.svc.getState('nope', 'tok')).rejects.toMatchObject({ code: 'not_found', standard: 'DISPLAY_SESSION_NOT_FOUND' });
    await expect(h.svc.submitTipForDevice(DEVICE_TOKEN, { tipType: 'none' })).rejects.toMatchObject({ standard: 'DISPLAY_SESSION_NOT_FOUND' });
  });
  it('a checkout whose ticket is gone is DISPLAY_SESSION_EXPIRED', async () => {
    const h = harness(row({ ticketId: null as any }));
    await expect(h.svc.submitTipForDevice(DEVICE_TOKEN, { tipType: 'none' })).rejects.toMatchObject({ standard: 'DISPLAY_SESSION_EXPIRED' });
  });
  it('the controller answers with the code in the body and the registry status', async () => {
    const { displayHttpError } = await import('./customer-display.controller');
    const e = displayHttpError(new DisplayError('not_found', 'Display session not found.', 'DISPLAY_SESSION_NOT_FOUND'));
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toMatchObject({ code: 'DISPLAY_SESSION_NOT_FOUND', message: 'Display session not found.' });
    const x = displayHttpError(new DisplayError('invalid', 'This checkout is no longer available.', 'DISPLAY_SESSION_EXPIRED'));
    expect(x.getStatus()).toBe(410);
    expect(displayHttpError(new DisplayError('invalid', 'Rating must be between 1 and 5.')).getStatus()).toBe(400);
  });
});
