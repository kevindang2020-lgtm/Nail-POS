// technician-tips.pgtest — Split Tips guide (Nov 5 2026, G4, migration 817): the customer display's per-technician tips
// through the REAL CustomerDisplayService and the REAL store on the migrated schema. The session / projection port is a
// stand-in (its query-builder reads are covered elsewhere); every tip write is real SQL.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DEFAULT_CHECKOUT_SETTINGS, supersedeCustomerTipsIfChanged, assertCustomerTipsConfirmed, TechTipsGuardError } from '@aipowersalon/checkout';
import { CustomerDisplayService } from './customer-display.service';
import { TechnicianTipStore } from './technician-tips.store';

const P = 'fa817000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), TK = id('c1'), CUST = id('c9'), SES = id('d1'), ANNA = id('e1'), BEN = id('e2'), CARA = id('e3'), OTHER = id('e9');
const TOKEN = 'display-token-g4';
let db: any; let svc: CustomerDisplayService; let perTech = true; let session: any;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const fakeRepo: any = {
  getSession: async () => ({ ...session }),
  checkoutProjection: async () => {
    const t = (await q(sql`select tip_cents from tickets where id = ${TK}`))[0];
    return { ticketNumber: '12', date: new Date().toISOString(), lines: [], adjustments: [], itemsSubtotalCents: 10000, discountCents: 0, taxCents: 0, customerFeeCents: 0, tipCents: Number(t.tip_cents),
      totalCents: 10000 + Number(t.tip_cents), balanceDueCents: 10000 + Number(t.tip_cents), paymentMethod: 'card', giftCardSaleCents: 0 };
  },
  salonName: async () => 'Salon', brandingSource: async () => { throw new Error('none'); }, customerFirstName: async () => undefined,
  applyTip: async () => undefined, setTicketTipFromDisplay: async () => undefined, markPaymentRequested: async () => { session.state = 'payment_processing'; },
  resolveSettings: async () => ({ ...DEFAULT_CHECKOUT_SETTINGS, perTechnicianTips: perTech, customerDisplayPayButtonEnabled: true }),
};
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return (e as Error).message; } }
const allocations = async () => (await q(sql`select technician_id, tip_cents, source from ticket_tip_allocations where ticket_id = ${TK} order by tip_cents`)).map((r) => `${r.technician_id === ANNA ? 'anna' : r.technician_id === BEN ? 'ben' : 'cara'}:${r.tip_cents}:${r.source}`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Salon', 'g4-a', 'G4A001', 'active'), (${T2}, 'O', 'Other', 'g4-b', 'G4B001', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T2}, 'Other', 'America/New_York')`);
  for (const [tid, nm, ten] of [[ANNA, 'Anna', T], [BEN, 'Ben', T], [CARA, 'Cara', T], [OTHER, 'Olga', T2]] as const)
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${tid}, ${ten}, ${ten === T ? B : B2}, ${nm}, 'x', ${nm}, 'active', true)`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${CUST}, ${T}, ${B}, 'Guest', 'x', 'Guest', 'active')`);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values (${TK}, ${T}, ${B}, ${CUST}, 'open', 10000, 0, 0, 10000, 0)`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name, sort_order, status) values (${id('90')}, ${T}, ${B}, 'Nails', 1, 'active')`);
  for (const sid of [id('91'), id('92')]) await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order)
    values (${sid}, ${T}, ${B}, ${id('90')}, 'Svc', 30, 4000, 'percent', 40, true, true, true, 'active', 1)`);
  // Anna did a $40 manicure, Ben a $60 pedicure; Cara was booked but performed nothing (no line)
  for (const [lid, tech, name, cents, sid] of [[id('f1'), ANNA, 'Gel Manicure', 4000, id('91')], [id('f2'), BEN, 'Spa Pedicure', 6000, id('92')]] as const)
    await q(sql`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent)
      values (${lid}, ${T}, ${B}, ${TK}, ${sid}, ${tech}, ${name}, ${cents}, 30, 'percent', 40, ${cents}, 'completed', 100)`);
  session = { id: SES, tenantId: T, branchId: B, state: 'ticket_review', ticketId: TK, ticketNumber: '#12', customerId: null, publicTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
    selectedTipCents: 0, subtotalCents: 10000, paymentMethod: 'card', expiresAt: new Date(Date.now() + 3600_000).toISOString(), closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
  svc = new CustomerDisplayService(fakeRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new TechnicianTipStore(db));
}, 180_000);

describe('per-technician tips on the customer display', () => {
  it('shows one card per technician who PERFORMED a service, with the basis a percent applies to (booked-only Cara absent)', async () => {
    const s = await svc.getState(SES, TOKEN);
    expect(s.technicianTips!.recipients.map((r) => `${r.name}:${r.basisCents}:${r.choice}`)).toEqual(['Anna:4000:null', 'Ben:6000:null']);
    expect(s.technicianTips).toMatchObject({ state: 'NEW', version: 0, stale: false, presetCents: [300, 500, 1000] });
  });
  it('a single undirected ticket tip is refused while per-technician tips are on; Pay needs confirmed tips', async () => {
    expect(await code(svc.submitTip(SES, TOKEN, { tipType: 'percent', percent: 20 }))).toMatch(/each technician/);
    expect(await code(svc.requestPayment(SES, TOKEN))).toMatch(/confirm the tips/);
  });
  it('02/05: A=$5 then edited to $8, B=$10 — drafts are versioned; a stale screen is refused; the ticket tip is the sum', async () => {
    let s = await svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'custom', amountCents: 500 }], expectedVersion: 0 });
    expect(s.technicianTips).toMatchObject({ version: 1, state: 'DRAFT' });
    s = await svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'custom', amountCents: 800 }, { technicianId: BEN, tipType: 'custom', amountCents: 1000 }], expectedVersion: 1 });
    expect(await code(svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'none' }], expectedVersion: 1 }))).toMatch(/another screen/);   // 18
    expect(await allocations()).toEqual(['anna:800:customer_display', 'ben:1000:customer_display']);
    expect((await q(sql`select tip_cents from tickets where id = ${TK}`))[0].tip_cents).toBe(1800);
  });
  it('24: a technician from another salon or one who did not perform is refused; confirming needs every technician chosen', async () => {
    expect(await code(svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: OTHER, tipType: 'custom', amountCents: 500 }], expectedVersion: 2 }))).toMatch(/did not perform/);
    expect(await code(svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: CARA, tipType: 'custom', amountCents: 500 }], expectedVersion: 2 }))).toMatch(/did not perform/);
    expect(await code(svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'custom', amountCents: 500 }], expectedVersion: 2, confirm: true }))).toMatch(/each technician before confirming/);
  });
  it('06 + confirm: 20% each is $8 + $12 (per technician basis), confirmed, then Pay freezes it (LOCKED) and edits are refused', async () => {
    const s = await svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'percent', percent: 20 }, { technicianId: BEN, tipType: 'percent', percent: 20 }], expectedVersion: 2, confirm: true });
    expect(s.technicianTips).toMatchObject({ state: 'CONFIRMED', totalTipCents: 2000 });
    expect(s.technicianTips!.recipients.map((r) => r.choice!.tipCents)).toEqual([800, 1200]);
    expect((await q(sql`select tip_type, tip_percent, tip_cents from tickets where id = ${TK}`))[0]).toEqual({ tip_type: 'percent', tip_percent: 20, tip_cents: 2000 });
    await svc.requestPayment(SES, TOKEN);
    expect((await q(sql`select state from checkout_tip_selections where ticket_id = ${TK}`))[0].state).toBe('LOCKED');
    expect(await code(new TechnicianTipStore(db).save({ tenantId: T, branchId: B, ticketId: TK, sessionId: SES, expectedVersion: 3, recipientsKey: 'x', items: [], totalCents: 0, confirm: false, tipMeta: { tipType: 'none', tipPercent: null } }))).toMatch(/Payment has started/);
    expect((await q(sql`select action from checkout_tip_selection_events where ticket_id = ${TK} order by created_at, id`)).map((r) => r.action)).toEqual(['DRAFT_SAVED', 'DRAFT_SAVED', 'CONFIRMED', 'LOCKED']);
  });
  it('15: a declined card releases the lock so the customer may change the tips and try again (same version line)', async () => {
    session.state = 'tip_selected'; session.lastPaymentStatus = 'declined';
    const s = await svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'custom', amountCents: 500 }, { technicianId: BEN, tipType: 'none' }], expectedVersion: 3, confirm: true });
    expect(s.technicianTips).toMatchObject({ state: 'CONFIRMED', totalTipCents: 500 });
    expect(await allocations()).toEqual(['ben:0:customer_display', 'anna:500:customer_display']);   // 03: explicit $0 kept, not 50/50
    session.lastPaymentStatus = null;
  });
  it('12: a changed performer makes the selection stale — Pay is refused until the customer chooses again', async () => {
    await q(sql`update ticket_service_lines set technician_id = ${CARA} where id = ${id('f2')}`);
    const s = await svc.getState(SES, TOKEN);
    expect(s.technicianTips).toMatchObject({ stale: true, state: 'SUPERSEDED' });
    expect(s.technicianTips!.recipients.map((r) => r.name)).toEqual(['Anna', 'Cara']);
    expect(await code(svc.requestPayment(SES, TOKEN))).toMatch(/changed/);
    await q(sql`update ticket_service_lines set technician_id = ${BEN} where id = ${id('f2')}`);
  });
  it('the front desk changing the total tip supersedes the customer split (rows removed, history kept) — never a silent re-split', async () => {
    expect(await supersedeCustomerTipsIfChanged(db, T, TK, 500)).toBe(false);   // same total → kept
    expect(await supersedeCustomerTipsIfChanged(db, T, TK, 900)).toBe(true);
    expect(await allocations()).toEqual([]);
    expect((await q(sql`select state, superseded_reason from checkout_tip_selections where ticket_id = ${TK}`))[0]).toMatchObject({ state: 'SUPERSEDED' });
    expect(await code(q(sql`delete from checkout_tip_selection_events where ticket_id = ${TK}`))).toMatch(/append-only/);
  });
  it('turned off (the default): no technician cards — the single tip works exactly as before', async () => {
    perTech = false;
    const s = await svc.getState(SES, TOKEN);
    expect(s.technicianTips).toBeUndefined();
    perTech = true;
  });
});

describe('§34 the FRONT DESK pay paths (G4 follow-up): no fabricated customer confirmation', () => {
  const TK2 = id('c2'), CASHIER = id('e7');
  const guard = (staff?: { reason?: string } | null) => assertCustomerTipsConfirmed(db, { tenantId: T, ticketId: TK2, userId: CASHIER, staffConfirmation: staff ?? null });
  const gcode = async (p: Promise<unknown>) => { try { return await p; } catch (e) { return e instanceof TechTipsGuardError ? e.code : (e as Error).message; } };
  beforeAll(async () => {
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values (${TK2}, ${T}, ${B}, ${CUST}, 'open', 10000, 0, 0, 10000, 0)`);
    for (const [lid, tech, cents, sid] of [[id('f3'), ANNA, 4000, id('91')], [id('f4'), BEN, 6000, id('92')]] as const)
      await q(sql`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent)
        values (${lid}, ${T}, ${B}, ${TK2}, ${sid}, ${tech}, 'Svc', ${cents}, 30, 'percent', 40, ${cents}, 'completed', 100)`);
  });
  it('no customer selection → the front desk pays as before', async () => { expect(await guard()).toBe('no_selection'); });
  it('a DRAFT the customer never confirmed blocks a front-desk tender; a reason-less staff entry is refused too', async () => {
    session = { ...session, ticketId: TK2, state: 'ticket_review', lastPaymentStatus: null };
    await svc.submitTip(SES, TOKEN, { technicians: [{ technicianId: ANNA, tipType: 'custom', amountCents: 300 }, { technicianId: BEN, tipType: 'custom', amountCents: 700 }], expectedVersion: 0 });
    expect(await gcode(guard())).toBe('TECH_TIPS_NOT_CONFIRMED');
    expect(await gcode(guard({ reason: '' }))).toBe('TECH_TIPS_REQUIRED');
    expect((await q(sql`select state from checkout_tip_selections where ticket_id = ${TK2}`))[0].state).toBe('DRAFT');
  });
  it('a changed performer is STALE — even a staff entry cannot vouch for a split that no longer matches the ticket', async () => {
    await q(sql`update ticket_service_lines set technician_id = ${CARA} where id = ${id('f4')}`);
    expect(await gcode(guard({ reason: 'Customer told me verbally' }))).toBe('TECH_TIPS_STALE');
    await q(sql`update ticket_service_lines set technician_id = ${BEN} where id = ${id('f4')}`);
  });
  it('confirming ON THE CUSTOMER\'S BEHALF is explicit and attributed: CONFIRMED, source staff on the selection and its rows, a history row naming the cashier and the reason', async () => {
    expect(await guard({ reason: 'Customer confirmed out loud at the counter' })).toBe('staff_confirmed');
    expect((await q(sql`select state, source from checkout_tip_selections where ticket_id = ${TK2}`))[0]).toEqual({ state: 'CONFIRMED', source: 'staff' });
    expect((await q(sql`select technician_id, tip_cents, source from ticket_tip_allocations where ticket_id = ${TK2} order by tip_cents`)).map((r) => `${r.tip_cents}:${r.source}`)).toEqual(['300:staff', '700:staff']);
    const ev = (await q(sql`select action, actor_user_id, detail from checkout_tip_selection_events where ticket_id = ${TK2} order by created_at desc limit 1`))[0];
    expect(ev).toMatchObject({ action: 'STAFF_CONFIRMED_ON_BEHALF', actor_user_id: CASHIER, detail: { reason: 'Customer confirmed out loud at the counter' } });
    expect(await guard()).toBe('confirmed');   // now confirmed: later tenders proceed
  });
});

