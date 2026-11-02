// skip-line-recovery.pgtest.vitest.spec.ts — Remaining-work mandate P1-2 / B-80 and P1-3 / B-81 (Oct 23 2026) on the real
// schema. A Skip-the-Line app charge whose processor answer was lost stayed 'processing' with nobody to settle it; and a
// second card could be run on the same bill. Now:
//   • ONE charger per intent (charge_started_at): a second confirm of the same intent never reaches the processor;
//   • the processor gets orderId = intent id and the key 'slc-<intent>' — a NEW intent after a decline gets a new key;
//   • staff Verify / customer "Check status" / the stranded sweep settle it from the processor's record — approved →
//     ONE approved payment and the ticket paid; declined → failed; no record (old) → released; never a second charge;
//   • a declined row under the same key no longer makes a later approval "already recorded" (the dedup bug);
//   • the unsettled-tender guard sees a POS card row, a split reservation, a Tap to Pay attempt and a charged app intent.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SkipLineCheckoutRepository } from './skip-line-checkout.repository';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { unsettledTendersForTicket } from '../checkout/unsettled-tenders';

const T = 'c6800000-0000-4000-8000-000000000001', B = 'c6800000-0000-4000-8000-000000000002', U = 'c6800000-0000-4000-8000-000000000003';
const C = 'c6800000-0000-4000-8000-000000000004', CAT = 'c6800000-0000-4000-8000-000000000005', SVC = 'c6800000-0000-4000-8000-000000000006';
let pg: any; let db: any; let repo: SkipLineCheckoutRepository;
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'CUSTOMER', permissions: [] };
const staff: any = { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['checkout.process_payment', 'pos.checkout.take_payment', 'pos.checkout.view'] };
let n = 0;

async function ticket(): Promise<string> {
  n++;
  const id = `c6800000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  await pg.query(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, tax_cents, discount_cents) VALUES ($1,$2,$3,$4,'ready_checkout',0,0,0)`, [id, T, B, C]);
  await pg.query(`INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) VALUES ($1,$2,$3,$4,'Gel Manicure',4500,45,4500)`, [T, B, id, SVC]);
  return id;
}
function proc(answer: 'approve' | 'decline' | 'throw', record: 'approved' | 'declined' | 'none' = 'none') {
  const charges: any[] = []; const inquiries: string[] = [];
  return { charges, inquiries, p: {
    name: 'cardpointe',
    async authorizeAndCapture(i: any) { charges.push(i); if (answer === 'throw') throw new Error('socket hang up'); return answer === 'approve' ? { approved: true, declined: false, retref: 'RT-' + charges.length, respstat: 'A' } : { approved: false, declined: true, retref: 'RD-' + charges.length, respstat: 'C', respText: 'Insufficient funds' }; },
    async inquireByOrderId(orderId: string) { inquiries.push(orderId); return { transactions: record === 'approved' ? [{ retref: 'RT-INQ', approved: true, declined: false, amountCents: 4500 }] : record === 'declined' ? [{ retref: 'RD-INQ', approved: false, declined: true, amountCents: 4500 }] : [] }; },
  } };
}
const svcWith = (p: any) => new SkipLineCheckoutService(repo, undefined, { resolve: async () => ({ processor: p }) });
const payments = async (tk: string) => (await pg.query(`SELECT status, processor_transaction_id, idempotency_key, amount_cents FROM payments WHERE tenant_id=$1 AND ticket_id=$2 ORDER BY created_at`, [T, tk])).rows;
const intentRow = async (id: string) => (await pg.query(`SELECT status, charge_started_at, processor_ref, settled_by, failure_reason FROM payment_intents WHERE id=$1`, [id])).rows[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); repo = new SkipLineCheckoutRepository(db);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'Rec Salon','Rec Salon','rec-salon-680','REC680','active')`, [T]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,'Main')`, [B, T]);
  await pg.query(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) VALUES ($1,$2,$3,'Kim','Le','Kim Le','kim@rec.test','x','active','CUSTOMER')`, [U, T, B]);
  await pg.query(`INSERT INTO customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) VALUES ($1,$2,$3,$4,'Kim','Le','Kim Le')`, [C, T, B, U]);
  await pg.query(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ($1,$2,$3,'Manicure')`, [CAT, T, B]);
  await pg.query(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) VALUES ($1,$2,$3,$4,'Gel Manicure',45,4500,'active','percent',50)`, [SVC, T, B, CAT]);
});
beforeEach(() => { delete process.env.PAYMENTS_SANDBOX; });

describe('Skip-the-Line app charge recovery (B-80)', () => {
  it('a lost answer: the intent is charged-processing; a second confirm of it never reaches the processor; Verify finds the approval → ONE approved payment, ticket paid', async () => {
    const tk = await ticket(); const live = proc('throw');
    const st = await svcWith(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' })).rejects.toMatchObject({ code: 'payment_status_unknown', httpStatus: 409 });
    expect(live.charges).toHaveLength(1);
    expect(live.charges[0]).toMatchObject({ orderId: st.intentId, idempotencyKey: `slc-${st.intentId}`, amountCents: 4500 });
    expect((await intentRow(st.intentId)).status).toBe('processing');
    expect((await intentRow(st.intentId)).charge_started_at).not.toBeNull();
    // the guest taps Pay again on the same intent → refused, the card is not run again
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' })).rejects.toMatchObject({ code: 'payment_status_unknown' });
    expect(live.charges).toHaveLength(1);
    // … and a NEW intent on the same bill is refused too while the first is mid-air (B-81)
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, { method: 'card', token: '9418594164541111', expiry: '1230' })).rejects.toMatchObject({ code: 'payment_status_unknown' });
    expect(live.charges).toHaveLength(1);
    // the front desk Verifies: the processor's record says approved
    const rec = proc('approve', 'approved');
    const v = await svcWith(rec.p).posVerifyAppPayment(staff, tk);
    expect(v.results).toHaveLength(1);
    expect(v.results[0]).toMatchObject({ intentId: st.intentId, outcome: 'approved', status: 'succeeded' });
    expect(rec.inquiries).toEqual([st.intentId]); expect(rec.charges).toHaveLength(0);
    expect((await payments(tk)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
    expect((await pg.query(`SELECT status, paid_at FROM tickets WHERE id=$1`, [tk])).rows[0].status).toBe('paid');
    expect(await intentRow(st.intentId)).toMatchObject({ status: 'succeeded', processor_ref: 'RT-INQ', settled_by: 'verify' });
    // a second Verify finds nothing open and records nothing more
    expect((await svcWith(rec.p).posVerifyAppPayment(staff, tk)).results).toHaveLength(0);
    expect((await payments(tk)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
  });

  it('Verify: the record says declined → intent failed + one declined row; the guest may then pay with a NEW intent and a NEW key (the old decline never replays, the approval is recorded)', async () => {
    const tk = await ticket(); const live = proc('throw');
    const st = await svcWith(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await svcWith(live.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' }).catch(() => undefined);
    const out = await svcWith(proc('approve', 'declined').p).customerVerifyPayment(ctx, st.intentId);
    expect(out).toMatchObject({ outcome: 'declined', status: 'failed' });
    expect((await payments(tk)).map((p: any) => p.status)).toEqual(['declined']);
    const pay = proc('approve');
    const r = await svcWith(pay.p).confirmAppPayment(ctx, tk, { intentId: st.intentId, method: 'card', token: '9418594164541111', expiry: '1230' });
    expect(r).toMatchObject({ paid: true, status: 'succeeded' });
    expect(r.intentId).not.toBe(st.intentId);
    expect(pay.charges[0].idempotencyKey).toBe(`slc-${r.intentId}`);
    const rows = await payments(tk);
    expect(rows.map((p: any) => p.status).sort()).toEqual(['approved', 'declined']);
  });

  it('the dedup bug: a declined row under a key no longer makes a later approval with that key "already recorded"', async () => {
    const tk = await ticket();
    await repo.recordDeclinedPayment(ctx, tk, 'card', 4500, 0, 'RD-X', 'slc-legacy-key', 'Declined', C);
    const r = await repo.recordPaymentAndCloseTicket(ctx, tk, 'card', 4500, 0, { processorTxnId: 'RT-X', idempotencyKey: 'slc-legacy-key-2' });
    expect(r.paymentId).toBeTruthy();
    const rows = await payments(tk);
    expect(rows.find((p: any) => p.status === 'approved')).toMatchObject({ processor_transaction_id: 'RT-X' });
    // and the true replay (an APPROVED row with the key) still dedupes
    const again = await repo.recordPaymentAndCloseTicket(ctx, tk, 'card', 4500, 0, { processorTxnId: 'RT-X', idempotencyKey: 'slc-legacy-key-2' });
    expect(again.paymentId).toBe(r.paymentId);
    expect((await payments(tk)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
  });

  it('the stranded sweep: a young charged intent waits; an old one with no processor record is released (failed, nothing charged); with an approval it is recorded once', async () => {
    const tkA = await ticket(), tkB = await ticket();
    const live = proc('throw');
    const a = await svcWith(live.p).startAppPayment(ctx, tkA, { method: 'card' });
    await svcWith(live.p).confirmAppPayment(ctx, tkA, { intentId: a.intentId, method: 'card', token: '9418594164541111', expiry: '1230' }).catch(() => undefined);
    const b = await svcWith(live.p).startAppPayment(ctx, tkB, { method: 'card' });
    await svcWith(live.p).confirmAppPayment(ctx, tkB, { intentId: b.intentId, method: 'card', token: '9418594164541111', expiry: '1230' }).catch(() => undefined);
    expect((await svcWith(proc('approve', 'none').p).sweepStranded()).checked).toBe(0);     // nothing past the window yet
    await pg.query(`UPDATE payment_intents SET charge_started_at = now() - interval '30 minutes' WHERE id = ANY($1::uuid[])`, [[a.intentId, b.intentId]]);
    // A: the processor has no record → released;   B: … approved (one service instance per answer)
    const none = proc('approve', 'none');
    const swA = await new SkipLineCheckoutService(repo, undefined, { resolve: async () => ({ processor: none.p }) }).sweepStranded(new Date(), 1);
    expect(swA).toMatchObject({ checked: 1, released: 1 });
    expect(await intentRow(a.intentId)).toMatchObject({ status: 'failed', settled_by: 'sweep' });
    const ok = proc('approve', 'approved');
    const swB = await svcWith(ok.p).sweepStranded();
    expect(swB).toMatchObject({ checked: 1, approved: 1 });
    expect((await payments(tkB)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
    expect(none.charges.length + ok.charges.length).toBe(0);
    // the POS list shows a charged-processing intent as unsettled (Verify), and nothing once settled
    const state = await repo.skipLineState(staff);
    expect(state.items.find((i: any) => i.intentId === b.intentId)).toBeUndefined();
  });
});

describe('unsettled-tender guard reads every place a card charge can be mid-air (B-81)', () => {
  it('POS card row · split reservation · Tap to Pay attempt · charged app intent; settled / declined / not-yet-charged ones do not count', async () => {
    const tk = await ticket();
    expect(await unsettledTendersForTicket(db, T, tk)).toEqual([]);
    await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1,$2,$3,3000,'card','processing','split-k1')`, [T, B, tk]);
    await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1,$2,$3,1500,'tap_to_pay','authorization_pending','ttp-k1')`, [T, B, tk]);
    await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1,$2,$3,1500,'tap_to_pay','declined','ttp-k2')`, [T, B, tk]);
    await pg.query(`INSERT INTO payment_intents (tenant_id, branch_id, ticket_id, customer_id, amount_cents, method, status) VALUES ($1,$2,$3,$4,4500,'card','processing')`, [T, B, tk, C]);   // looking at the bill, card not sent
    const u1 = await unsettledTendersForTicket(db, T, tk);
    expect(u1.map((u) => `${u.kind}:${u.status}`).sort()).toEqual(['attempt:authorization_pending', 'attempt:processing']);
    await pg.query(`UPDATE payment_intents SET charge_started_at = now() WHERE tenant_id=$1 AND ticket_id=$2`, [T, tk]);
    await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, idempotency_key) VALUES ($1,$2,$3,'card',4500,0,0,0,'processing','pos-k1')`, [T, B, tk]);
    const u2 = await unsettledTendersForTicket(db, T, tk);
    expect(u2.map((u) => u.kind).sort()).toEqual(['app_intent', 'attempt', 'attempt', 'payment']);
    // another salon's rows never count (tenant-scoped)
    expect(await unsettledTendersForTicket(db, 'c6800000-0000-4000-8000-0000000000ff', tk)).toEqual([]);
  });
  it('M6-6 §33: a Tap to Pay attempt that TIMED OUT (it may have been authorized) is unsettled until resolved', async () => {
    const tk = await ticket();
    await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1,$2,$3,1500,'tap_to_pay','timed_out','ttp-timeout-1')`, [T, B, tk]);
    expect((await unsettledTendersForTicket(db, T, tk)).map((u) => `${u.kind}:${u.status}`)).toEqual(['attempt:timed_out']);
    await pg.query(`UPDATE payment_attempts SET status = 'canceled' WHERE idempotency_key = 'ttp-timeout-1'`);
    expect(await unsettledTendersForTicket(db, T, tk)).toEqual([]);
  });
});

// §59 (Oct 27 2026): RECOVERY AFTER RECONNECT — the customer app loses its connection mid-payment and comes back. Whatever
// it does on reconnect (confirm the SAME intent again, ask the status, tap "Check status"), the processor is reached zero
// more times and the app is told the settled state.
describe('Skip-the-Line recovery after reconnect (§59)', () => {
  const card = (intentId: string) => ({ intentId, method: 'card', token: '9418594164541111', expiry: '1230' });
  it('the charge went through but the app never got the answer: on reconnect the same confirm is refused as already paid (no second charge), status / Check status report it settled', async () => {
    const tk = await ticket(); const live = proc('approve', 'approved');
    const st = await svcWith(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await svcWith(live.p).confirmAppPayment(ctx, tk, card(st.intentId));   // the answer the dropped connection never delivered
    expect(live.charges).toHaveLength(1);
    // …the phone reconnects and replays its last request
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, card(st.intentId))).rejects.toMatchObject({ code: 'already_paid', httpStatus: 409 });
    expect((await svcWith(live.p).paymentStatus(ctx, st.intentId)).status).toBe('succeeded');
    const check = await svcWith(live.p).customerVerifyPayment(ctx, st.intentId);
    expect(JSON.stringify(check)).toMatch(/succeeded|approved|paid/);
    expect(live.charges).toHaveLength(1);
    expect(live.inquiries).toHaveLength(0);                                  // a settled intent is not even asked about
    expect((await payments(tk)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
  });
  it('the answer was lost at the SERVER too (intent charged-processing): reconnect + confirm again → refused (payment_status_unknown), nothing sent; Check status asks the processor once and reports the settled state; a further reconnect is told already paid', async () => {
    const tk = await ticket(); const live = proc('throw', 'approved');
    const st = await svcWith(live.p).startAppPayment(ctx, tk, { method: 'card' });
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, card(st.intentId))).rejects.toMatchObject({ code: 'payment_status_unknown' });
    // reconnect: the app replays the confirm twice (a retry loop) before showing "Check status"
    for (let i = 0; i < 2; i++) await expect(svcWith(live.p).confirmAppPayment(ctx, tk, card(st.intentId))).rejects.toMatchObject({ code: 'payment_status_unknown', httpStatus: 409 });
    expect(live.charges).toHaveLength(1);
    expect((await svcWith(live.p).paymentStatus(ctx, st.intentId)).status).toBe('processing');
    await svcWith(live.p).customerVerifyPayment(ctx, st.intentId);
    expect(live.inquiries).toEqual([st.intentId]);
    expect((await svcWith(live.p).paymentStatus(ctx, st.intentId)).status).toBe('succeeded');
    await expect(svcWith(live.p).confirmAppPayment(ctx, tk, card(st.intentId))).rejects.toMatchObject({ code: 'already_paid' });
    expect(live.charges).toHaveLength(1);
    expect((await payments(tk)).filter((p: any) => p.status === 'approved')).toHaveLength(1);
  });
});
