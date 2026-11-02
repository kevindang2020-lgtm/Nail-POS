// tech-cash-handoff.pgtest — End-of-Day Cash mandate (Oct 29 2026): the hand-off WRITER against the REAL schema (migration 715):
//   two partial hand-offs ($200 + $100) reconcile a $300 unit exactly once, as two events; the same submission twice is one
//   event; a counter holding an old version is refused (409) and the first count stands; a transfer into the drawer is ONE
//   cash_drawer_movements 'in' row linked to the unit (no payment row, no sale); a recount keeps the earlier count as history;
//   resolving a shortage keeps expected / counted / variance and records the reason; another salon's unit is untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechCashHandoffRepository } from './tech-cash-handoff.repository';
import { TechCashHandoffVersionConflict } from './tech-cash-handoff.dto';

const P = 'e1f2a3b4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1'), ANNA = id('f1'), BAO = id('f2'), ZED = id('f9');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: [] };
const other = { ...ctx, tenantId: T2, branchId: B2 };
const DAY = '2026-10-29';
let pg: any; let r: TechCashHandoffRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const unit = async (tech: string, tenant = T) => { const u = (await q(`select counted_cents, variance_cents, status, version, drawer_transfer_cents, resolution_reason from tech_cash_handoffs where tenant_id = $1 and technician_id = $2 and business_date = $3`, [tenant, tech, DAY])).rows[0];
  return u && { ...u, counted_cents: u.counted_cents == null ? null : Number(u.counted_cents), variance_cents: u.variance_cents == null ? null : Number(u.variance_cents), version: Number(u.version), drawer_transfer_cents: Number(u.drawer_transfer_cents) }; };
const events = async (tech: string) => (await q(`select event_type, amount_cents, counted_total_cents, variance_cents, drawer_movement_id from tech_cash_handoff_events where tenant_id = $1 and technician_id = $2 order by created_at, id`, [T, tech])).rows;

beforeAll(async () => {
  pg = await migratedPglite();
  r = new TechCashHandoffRepository(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tch-pilot','TCH001','active'), ($2,'Other LLC','Other','tch-other','TCH002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  for (const [tid, tn, br, f] of [[ANNA, T, B, 'Anna'], [BAO, T, B, 'Bao'], [ZED, T2, B2, 'Zed']]) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,$4,'X',$4,'active',true)`, [tid, tn, br, f]);
  // another salon's balanced unit for the same day — must never change
  await q(`insert into tech_cash_handoffs (tenant_id, branch_id, technician_id, business_date, expected_cents, counted_cents, variance_cents, payment_count, status) values ($1,$2,$3,$4,9900,9900,0,1,'reconciled')`, [T2, B2, ZED, DAY]);
});

describe('hand-off writer — partial hand-offs, idempotency, concurrency, drawer transfer', () => {
  it('$200 then $100 against $300 expected: two partial events, one balanced unit', async () => {
    const exp = { expectedCents: 30000, paymentCount: 2 };
    const a = await r.reconcile(ctx, ANNA, DAY, exp, 20000, 'first half', { mode: 'add', idempotencyKey: 'k-a1' });
    expect(a).toMatchObject({ status: 'discrepancy', varianceCents: -10000, countedCents: 20000, version: 1, replayed: false });
    const b = await r.reconcile(ctx, ANNA, DAY, exp, 10000, null, { mode: 'add', idempotencyKey: 'k-a2', expectedVersion: 1 });
    expect(b).toMatchObject({ status: 'reconciled', varianceCents: 0, countedCents: 30000, version: 2 });
    expect(await unit(ANNA)).toMatchObject({ counted_cents: 30000, variance_cents: 0, status: 'reconciled', version: 2 });
    expect((await events(ANNA)).map((e: any) => [e.event_type, Number(e.amount_cents), Number(e.counted_total_cents)])).toEqual([['partial', 20000, 20000], ['partial', 10000, 30000]]);
  });
  it('the same submission twice (double tap / retry) is one event and the same answer', async () => {
    const again = await r.reconcile(ctx, ANNA, DAY, { expectedCents: 30000, paymentCount: 2 }, 10000, null, { mode: 'add', idempotencyKey: 'k-a2' });
    expect(again).toMatchObject({ replayed: true, countedCents: 30000, varianceCents: 0 });
    expect((await events(ANNA)).length).toBe(2); expect(Number((await unit(ANNA)).counted_cents)).toBe(30000);
  });
  it('a counter holding an old version is refused; the verified count stands', async () => {
    await expect(r.reconcile(ctx, ANNA, DAY, { expectedCents: 30000, paymentCount: 2 }, 25000, 'stale screen', { expectedVersion: 1 })).rejects.toBeInstanceOf(TechCashHandoffVersionConflict);
    expect(Number((await unit(ANNA)).counted_cents)).toBe(30000);
  });
  it('a recount keeps the first count in the history; a transfer into the drawer is one linked movement, never a sale', async () => {
    const exp = { expectedCents: 25000, paymentCount: 1 };
    await r.reconcile(ctx, BAO, DAY, exp, 24500, 'counted twice', {});
    const paymentsBefore = Number((await q(`select count(*) n from payments where tenant_id = $1`, [T])).rows[0].n);
    const x = await r.reconcile(ctx, BAO, DAY, exp, 24000, 'third count', { expectedVersion: 1, transferToDrawer: true, denominations: [{ denominationCents: 2000, quantity: 12 }] });
    expect(x).toMatchObject({ status: 'discrepancy', varianceCents: -1000, version: 2 }); expect(x.drawerMovementId).toBeTruthy();
    const mv = (await q(`select direction, amount_cents, source_type, register_id from cash_drawer_movements where tenant_id = $1`, [T])).rows;
    expect(mv.map((m: any) => ({ ...m, amount_cents: Number(m.amount_cents) }))).toEqual([{ direction: 'in', amount_cents: 24000, source_type: 'tech_cash_handoff', register_id: 'main' }]);
    expect(Number((await q(`select count(*) n from payments where tenant_id = $1`, [T])).rows[0].n)).toBe(paymentsBefore);
    expect((await events(BAO)).map((e: any) => e.event_type)).toEqual(['counted', 'recount', 'drawer_transfer']);
    expect(Number((await unit(BAO)).drawer_transfer_cents)).toBe(24000);
  });
  it('resolving the shortage keeps the figures and records the reason; a balanced unit cannot be resolved', async () => {
    const res = await r.resolve(ctx, BAO, DAY, 'Recounted with Bao — $10 paid out for supplies', 2);
    expect(res).toEqual({ version: 3, varianceCents: -1000 });
    expect(await unit(BAO)).toMatchObject({ status: 'reconciled', counted_cents: 24000, variance_cents: -1000, resolution_reason: 'Recounted with Bao — $10 paid out for supplies' });
    await expect(r.resolve(ctx, ANNA, DAY, 'nothing to resolve', null)).rejects.toMatchObject({ code: 'not_under_review' });
    await expect(r.resolve(ctx, BAO, DAY, 'stale', 2)).rejects.toBeInstanceOf(TechCashHandoffVersionConflict);
  });
  it('another salon is untouched and cannot reach this salon\'s unit', async () => {
    expect(await unit(ZED, T2)).toMatchObject({ counted_cents: 9900, status: 'reconciled', version: 1 });
    await expect(r.resolve(other, BAO, DAY, 'x', null)).rejects.toMatchObject({ code: 'not_found' });
    expect((await unit(BAO)).status).toBe('reconciled');
  });
});
