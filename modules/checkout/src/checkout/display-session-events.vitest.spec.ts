// display-session-events.vitest.spec.ts — 23-inch dual-screen spec §29, §36, §82, §100. When the POS attaches a
// checkout to a customer display, changes the session, or cancels it, the DISPLAY hears it on its own device channel
// (an idle display listens there and nowhere else) and the POS checkout screen hears it on the tenant room. Ids only.
import { describe, it, expect } from 'vitest';
import { CheckoutService } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';

const PERMS = ['pos.checkout.view', 'pos.customer_display.operate'];
const REGISTER_3 = { stationId: 'Station 3' };   // this POS's register — its dedicated display is disp_st3
const owner: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS } as CheckoutContext;

function harness() {
  const out: { room: string; event: string; payload: any }[] = [];
  const rt: any = {
    toTenant: (c: any, event: string, payload: any) => out.push({ room: `tenant:${c.tenantId}:branch:${c.branchId}`, event, payload }),
    toCustomerDisplayDevice: (id: string, event: string, payload: any) => out.push({ room: `customer_display:device:${id}`, event, payload }),
    toCustomerDisplay: (id: string, event: string, payload: any) => out.push({ room: `customer_display:${id}`, event, payload }),
    toTechnician() {}, toTicket() {}, toOwner() {}, toPlatform() {},
  };
  const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, rt);
  return { svc, out };
}

describe('the POS tells the display about its checkout', () => {
  it('Send to Display → session_started on the display\'s own channel AND the POS room, ids only', async () => {
    const { svc, out } = harness();
    const s = await svc.sendToCustomerDisplay(owner, 'tk_2041', REGISTER_3);
    const started = out.filter((e) => e.event === 'customer_display_session_started');
    expect(started.map((e) => e.room)).toEqual([`customer_display:device:${s.deviceId}`, 'tenant:luxe001:branch:br_cherryhill']);
    expect(started[0].payload).toEqual({ sessionId: s.sessionId, ticketId: 'tk_2041', deviceId: s.deviceId });
  });

  it('a direct session create announces itself the same way', async () => {
    const { svc, out } = harness();
    const dev = (await svc.devices(owner))[0];
    const s = await svc.createSession(owner, 'tk_2041', dev.deviceId);
    expect(out.some((e) => e.room === `customer_display:device:${dev.deviceId}` && e.event === 'customer_display_session_started' && e.payload.sessionId === s.sessionId)).toBe(true);
  });

  it('a POS change to the session reaches the display showing it', async () => {
    const { svc, out } = harness();
    const s = await svc.sendToCustomerDisplay(owner, 'tk_2041', REGISTER_3);
    out.length = 0;
    await svc.updateSession(owner, s.sessionId, { selectedTipCents: 900 });
    expect(out).toEqual([{ room: `customer_display:${s.sessionId}`, event: 'customer_display_checkout_updated', payload: { sessionId: s.sessionId, ticketId: 'tk_2041' } }]);
  });

  it('Cancel Display Session → the display drops it at once (canceled on its own channel) and the POS hears it', async () => {
    const { svc, out } = harness();
    const s = await svc.sendToCustomerDisplay(owner, 'tk_2041', REGISTER_3);
    out.length = 0;
    await svc.closeSession(owner, s.sessionId);
    expect(out.map((e) => `${e.room}|${e.event}`)).toEqual([
      `customer_display:device:${s.deviceId}|customer_display_canceled`,
      'tenant:luxe001:branch:br_cherryhill|customer_display_canceled',
    ]);
  });

  it('a refused send (no display for this register, none shared) announces nothing', async () => {
    const { svc, out } = harness();
    await expect(svc.sendToCustomerDisplay(owner, 'tk_2043', { stationId: 'Station 2' })).rejects.toThrow();
    expect(out.filter((e) => e.event.startsWith('customer_display_'))).toEqual([]);
  });

  it('a POS tip or discount signals the total changed (the display hears it through the ticket-room mirror)', async () => {
    const { svc, out } = harness();
    const ctx = { ...owner, permissions: [...PERMS, 'pos.checkout.add_tip', 'pos.checkout.apply_discount'] } as CheckoutContext;
    await svc.applyTip(ctx, 'tk_2041', { tipType: 'percent', tipPercent: 20, source: 'front_desk' } as any);
    await svc.applyDiscount(ctx, 'tk_2041', { discountCents: 500 } as any);
    const signals = out.filter((e) => e.event === 'checkout_total_recalculated');
    expect(signals.map((e) => e.payload)).toEqual([{ ticketId: 'tk_2041' }, { ticketId: 'tk_2041' }]);
    expect(signals.every((e) => e.room === 'tenant:luxe001:branch:br_cherryhill')).toBe(true);
  });

  it('a membership benefit synced onto the bill (even by the POS just opening the ticket) signals the change once — not on every read', async () => {
    const { svc, out } = harness();
    const repo: any = (svc as any).repo;
    const t: any = await repo.ticket(owner, 'tk_2042');
    repo.membershipRedemptions.push({ ticketId: 'tk_2042', redemptionId: 'r1', serviceLineId: t.lines[0].serviceLineId, standardValueCents: t.lines[0].priceCents, upgradeChargeCents: 0 });
    await svc.detail(owner, 'tk_2042');
    expect(out.filter((e) => e.event === 'checkout_total_recalculated').map((e) => e.payload)).toEqual([{ ticketId: 'tk_2042' }]);
    await svc.detail(owner, 'tk_2042');   // nothing changed this time
    expect(out.filter((e) => e.event === 'checkout_total_recalculated').length).toBe(1);
  });
});
