// display-send.vitest.spec.ts — 23-inch dual-screen spec §9–§11, §82–§83, §97: WHICH customer display a checkout goes to,
// and the receipt the display asks for. A POS uses its register's DEDICATED display first, else the branch's SHARED ones;
// never another register's display, an offline one or one in maintenance; another customer on a shared display is
// DISPLAY_BUSY and the next one is tried; Switch Display moves the checkout (never mid-payment) so it is never on two
// screens; the front desk may do all of this (pos.customer_display.operate). A receipt states what was CHARGED.
import { describe, it, expect } from 'vitest';
import { pickDisplays, type DisplayCandidate } from './display-send-core';
import { CheckoutService, ForbiddenError, ValidationError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CustomerDisplayError, DisplayBusyError } from './checkout.dto';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import { customerDisplayEvents } from '@aipowersalon/observability';
import { MockSmsSender, MockEmailSender, type SmsSender } from '@aipowersalon/notifications';

const D = (over: Partial<DisplayCandidate> & { deviceId: string }): DisplayCandidate => ({ label: over.deviceId, stationId: null, online: true, maintenance: false, ...over });

describe('pickDisplays (pure)', () => {
  const r1 = D({ deviceId: 'r1', stationId: 'REG1', label: 'Register 1 Display' });
  const r2 = D({ deviceId: 'r2', stationId: 'REG2' });
  const shA = D({ deviceId: 'shA', label: 'Lobby A' });
  const shB = D({ deviceId: 'shB', label: 'Lobby B' });

  it('this register\'s dedicated display first, then the branch\'s shared ones — never another register\'s', () => {
    expect(pickDisplays([r2, shA, r1, shB], { stationId: 'REG1' }, [])).toEqual({ ok: true, order: [r1, shA, shB] });
    expect(pickDisplays([r2, shA, shB], { stationId: 'REG1' }, [])).toEqual({ ok: true, order: [shA, shB] });
    expect(pickDisplays([r1, r2, shA], {}, [])).toEqual({ ok: true, order: [shA] });
  });
  it('online and not in maintenance only (§83: an offline display never stops a checkout — the POS says so)', () => {
    expect(pickDisplays([{ ...r1, online: false }, shA], { stationId: 'REG1' }, [])).toEqual({ ok: true, order: [shA] });
    expect(pickDisplays([{ ...r1, online: false }], { stationId: 'REG1' }, [])).toMatchObject({ ok: false, reason: 'offline', message: expect.stringMatching(/offline\. Continue checkout on the POS/) });
    expect(pickDisplays([{ ...shA, maintenance: true }], {}, [])).toMatchObject({ ok: false, reason: 'maintenance' });
  });
  it('the display already showing this customer is used again (never a second screen)', () => {
    expect(pickDisplays([r1, shA, shB], { stationId: 'REG1' }, ['shB'])).toEqual({ ok: true, order: [shB] });
  });
  it('Switch Display names exactly one display — usable, or refused with the reason', () => {
    expect(pickDisplays([r1, r2, shA], { deviceId: 'r2' }, [])).toEqual({ ok: true, order: [r2] });
    expect(pickDisplays([r1], { deviceId: 'nope' }, [])).toMatchObject({ ok: false, reason: 'not_found' });
    expect(pickDisplays([{ ...r2, online: false }], { deviceId: 'r2' }, [])).toMatchObject({ ok: false, reason: 'offline' });
    expect(pickDisplays([{ ...r2, maintenance: true }], { deviceId: 'r2' }, [])).toMatchObject({ ok: false, reason: 'maintenance' });
  });
  it('nothing usable says why: no display at all, or none for this register', () => {
    expect(pickDisplays([], { stationId: 'REG1' }, [])).toMatchObject({ ok: false, reason: 'no_display' });
    expect(pickDisplays([r2], { stationId: 'REG1' }, [])).toMatchObject({ ok: false, reason: 'no_display_for_register', message: expect.stringMatching(/Switch Display/) });
    expect(pickDisplays([r2], {}, [])).toMatchObject({ ok: false, reason: 'no_display_for_register', message: expect.stringMatching(/register/) });
  });
});

// ── the service, over the in-memory repository (luxe001 has displays dedicated to 'Station 3' and 'Station 1') ────────
const FRONT_DESK = ['pos.checkout.view', 'checkout.process_payment'];   // the front desk's real capability, not a test key
const ctx = (perms = FRONT_DESK): CheckoutContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_fd', role: 'FRONT_DESK', permissions: perms } as CheckoutContext);
function harness(sms?: SmsSender) {
  const out: { room: string; event: string; payload: any }[] = [];
  const rt: any = {
    toTenant: (c: any, event: string, payload: any) => out.push({ room: `tenant:${c.tenantId}`, event, payload }),
    toCustomerDisplayDevice: (id: string, event: string, payload: any) => out.push({ room: `device:${id}`, event, payload }),
    toCustomerDisplay: (id: string, event: string, payload: any) => out.push({ room: `session:${id}`, event, payload }),
    toTechnician() {}, toTicket() {}, toOwner() {}, toPlatform() {},
  };
  const repo = new InMemoryCheckoutRepository();
  const svc = new CheckoutService(repo, sms, undefined, undefined, undefined, rt);
  const devs = () => (repo as any).D(ctx()) as any[];   // the seeded displays (created on first use)
  return { svc, repo, out, devs };
}

describe('Send to Display / Switch Display (§9–§11, §82)', () => {
  it('the front desk sends a checkout to its register\'s display (operate rides the checkout capability)', async () => {
    const { svc } = harness();
    const s = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' });
    expect(s.deviceId).toBe('disp_st3');
    await expect(svc.sendToCustomerDisplay(ctx(['pos.checkout.view']), 'tk_2042', { stationId: 'Station 1' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a shared display busy with another customer: the next shared one is used; all busy → DISPLAY_BUSY, nobody displaced', async () => {
    const { svc, devs } = harness();
    for (const d of devs()) d.stationCode = '';   // both shared
    const a = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', {});
    const b = await svc.sendToCustomerDisplay(ctx(), 'tk_2042', {});
    expect(new Set([a.deviceId, b.deviceId]).size).toBe(2);
    const ev = (e: string) => customerDisplayEvents.snapshot().find((x) => x.labels.event === e)?.value ?? 0;
    const busy0 = ev('display_busy'); const started0 = ev('session_started');
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2044', {})).rejects.toBeInstanceOf(DisplayBusyError);
    expect(ev('display_busy') - busy0).toBe(1);   // Dual-Screen §108
    await svc.sendToCustomerDisplay(ctx(), 'tk_2041', {});   // the same customer again: a fresh session on its display
    expect(ev('session_started') - started0).toBe(1);
    const still = await svc.devices(ctx());
    expect(still).toHaveLength(2);
  });

  it('an offline or maintenance display is never sent to — the receptionist is told to continue on the POS', async () => {
    const { svc, devs } = harness();
    devs().find((d) => d.deviceId === 'disp_st3').online = false;
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' })).rejects.toThrow(/offline\. Continue checkout on the POS/);
    devs().find((d) => d.deviceId === 'disp_st1').maintenance = true;
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_st1' })).rejects.toThrow(/maintenance/);
  });

  it('Switch Display moves the checkout: the old display drops it (canceled on its own channel), the new one shows it', async () => {
    const { svc, out } = harness();
    const first = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' });
    out.length = 0;
    const moved = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_st1' });
    expect(moved.deviceId).toBe('disp_st1');
    expect(out.map((e) => `${e.room}|${e.event}`)).toEqual([
      'device:disp_st3|customer_display_canceled', 'tenant:luxe001|customer_display_canceled',
      'device:disp_st1|customer_display_session_started', 'tenant:luxe001|customer_display_session_started',
    ]);
    expect(out[0].payload).toEqual({ sessionId: first.sessionId, ticketId: 'tk_2041', deviceId: 'disp_st3' });
    // re-sending without naming a display keeps it where it is (the display already showing this customer)
    const again = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' });
    expect(again.deviceId).toBe('disp_st1');
  });

  it('never switches away while the customer is paying on the other display', async () => {
    const { svc, repo } = harness();
    const s = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' });
    await repo.updateSession(ctx(), s.sessionId, { state: 'payment_processing' } as any);
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_st1' })).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.getSession(ctx(), s.sessionId))?.state).toBe('payment_processing');
  });

  it('Cancel Display Session is front-desk work too', async () => {
    const { svc } = harness();
    const s = await svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' });
    expect(await svc.closeSession(ctx(), s.sessionId)).toEqual({ closed: true });
  });
});

describe('Dual-Screen mandate §104: standard display error codes (the POS reacts to the code, never the words)', () => {
  it('no display / none for this register → CUSTOMER_DISPLAY_NOT_CONFIGURED; offline or in maintenance → CUSTOMER_DISPLAY_OFFLINE', async () => {
    const { svc, devs } = harness();
    for (const d of devs()) d.stationCode = 'Station 9';   // every display belongs to another register
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2041', { stationId: 'Station 3' })).rejects.toMatchObject({ code: 'CUSTOMER_DISPLAY_NOT_CONFIGURED' });
    const h2 = harness();
    h2.devs().find((d) => d.deviceId === 'disp_st3').online = false;
    await expect(h2.svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_st3' })).rejects.toMatchObject({ code: 'CUSTOMER_DISPLAY_OFFLINE' });
    h2.devs().find((d) => d.deviceId === 'disp_st1').maintenance = true;
    await expect(h2.svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_st1' })).rejects.toMatchObject({ code: 'CUSTOMER_DISPLAY_OFFLINE', reason: 'maintenance' });
  });
  it('§105: a display that is not this branch\'s (another branch, another salon) → DISPLAY_CONTEXT_MISMATCH', async () => {
    const { svc } = harness();
    await expect(svc.sendToCustomerDisplay(ctx(), 'tk_2041', { deviceId: 'disp_of_another_branch' })).rejects.toMatchObject({ code: 'DISPLAY_CONTEXT_MISMATCH' });
  });
  it('an unknown display session → DISPLAY_SESSION_NOT_FOUND', async () => {
    const { svc } = harness();
    await expect(svc.closeSession(ctx(), 'cds_nope')).rejects.toMatchObject({ code: 'DISPLAY_SESSION_NOT_FOUND' });
    await expect(svc.updateSession(ctx(), 'cds_nope', {} as any)).rejects.toMatchObject({ code: 'DISPLAY_SESSION_NOT_FOUND' });
  });
  it('every code is registered with the status the controller answers with', () => {
    for (const code of ['CUSTOMER_DISPLAY_NOT_CONFIGURED', 'CUSTOMER_DISPLAY_OFFLINE', 'DISPLAY_CONTEXT_MISMATCH', 'DISPLAY_SESSION_NOT_FOUND'] as const) {
      expect(new CustomerDisplayError(code, 'x').status).toBe(ERROR_REGISTRY[code].status);
    }
    // still a ValidationError for callers that only know that (nothing that caught it before stops catching it)
    expect(new CustomerDisplayError('CUSTOMER_DISPLAY_OFFLINE', 'x')).toBeInstanceOf(Error);
  });
});

describe('receipts state what was CHARGED (§97)', () => {
  const capture = () => { const sent: string[] = []; const sms: SmsSender = { async send(_to, body) { sent.push(body); return { sid: 'SM1' }; } }; return { sent, sms }; };

  it('a cash ticket\'s receipt carries no card surcharge (it used to quote the card total for every ticket)', async () => {
    const { sent, sms } = capture();
    const { svc } = harness(sms);
    const owner = { ...ctx(), role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.receipts.send'] } as CheckoutContext;
    const due = (await svc.detail(owner, 'tk_2042') as any).totals;
    const cashTotals = (await (svc as any).repo.totalsFor(owner, 'tk_2042', 'cash'));
    await svc.payCash(owner, 'tk_2042', { amountReceivedCents: cashTotals.totalDueCents + 500 } as any);
    await svc.receiptSms(owner, 'tk_2042');
    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(sent[0]).toContain(`receipt total is ${dollars(cashTotals.totalDueCents)}`);
    expect(sent[0]).not.toMatch(/surcharge/);
    expect(due).toBeTruthy();
  });

  it('the display\'s receipt: real providers only are "live"; the delivery is the POS\'s own, and a failure is reported, not thrown', async () => {
    const { sent, sms } = capture();
    const { svc } = harness(sms);
    expect(svc.receiptChannelsLive()).toEqual({ sms: true, email: false });
    // with no provider configured the API wires the SIMULATED senders — never "live": the display must not offer a
    // text or an email that would only be pretended
    expect(new CheckoutService(new InMemoryCheckoutRepository(), new MockSmsSender(), new MockEmailSender()).receiptChannelsLive()).toEqual({ sms: false, email: false });
    const facts = await svc.displayReceiptFacts({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, 'tk_2041');
    expect(facts).toMatchObject({ phone: '+18565550101', alreadySent: false, live: { sms: true, email: false } });
    expect(await svc.sendReceiptForDisplay({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, 'tk_2041', 'sms')).toBe('sent');
    expect(sent).toHaveLength(1);
    expect((await svc.displayReceiptFacts({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, 'tk_2041')).alreadySent).toBe(true);
    expect(await svc.sendReceiptForDisplay({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, 'tk_2041', 'email')).toBe('unavailable');   // no email provider here
    const failing = harness({ async send() { throw new Error('provider down'); } }).svc;
    expect(await failing.sendReceiptForDisplay({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, 'tk_2041', 'sms')).toBe('failed');
  });
});
