// state-machines.pgtest — BUILD_PLAN Phase 12 / Constitution 5 §74–§78 (API_DEFINITION_OF_DONE #27): explicit state transitions.
//
//   1. the gate (check:state-transitions) — its vocabulary file equals the MIGRATED schema, every adopted machine's states
//      are in its column's CHECK, ONE machine per lifecycle, and it catches what it claims (planted unguarded write, a value
//      outside the CHECK, a second machine);
//   2. each adopted machine reproduces the transition table its domain already declared (allowed / refused), with the
//      dangerous moves the old writers allowed now refused;
//   3. on the real schema, the writers move rows only along the machine — a stale read or a concurrent move is refused
//      (409 INVALID_STATE_TRANSITION), never written over. The two-connection race lives in
//      state-transitions.postgres-race.vitest.spec.ts.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { transitionStatus, canMoveToSql, InvalidStateTransitionError, type StateMachine } from '@aipowersalon/database';
import { InventoryService, PURCHASE_ORDER, INVENTORY_COUNT } from '@aipowersalon/inventory';
import { PayrollService, KyselyPayrollRepository, PAYROLL_PERIOD, TECH_CASH_HANDOFF } from '@aipowersalon/workforce';
import { PAYMENT_ATTEMPT, LOYALTY_REDEMPTION, CASH_DRAWER_SESSION, KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { BOOKING_HOLD, BOOKING_VERIFICATION_SESSION } from '@aipowersalon/booking';
import { CUSTOMER_MEMBERSHIP, KyselyMembershipBillingRepository } from '@aipowersalon/memberships';
import { USER_INVITATION } from '@aipowersalon/super-admin';
import { DEAL_REDEMPTION_HOLD, DEAL_REDEMPTION } from '@aipowersalon/deals';
const { inventory, check, liveVocab, machinesIn, writesIn, literalValuesIn }: any = await import('../../scripts/audit-state-transitions.mjs');

const API = join(__dirname, '..', '..');
const ALL: StateMachine[] = [PAYROLL_PERIOD, PURCHASE_ORDER, INVENTORY_COUNT, PAYMENT_ATTEMPT, LOYALTY_REDEMPTION, CASH_DRAWER_SESSION, TECH_CASH_HANDOFF,
  BOOKING_HOLD, BOOKING_VERIFICATION_SESSION, CUSTOMER_MEMBERSHIP, USER_INVITATION, DEAL_REDEMPTION_HOLD, DEAL_REDEMPTION];
const moves = (m: StateMachine) => m.states.flatMap((f) => m.states.filter((t) => m.can(f, t)).map((t) => `${f}>${t}`)).sort();

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });

describe('check:state-transitions — the gate', () => {
  it('the committed vocabulary file IS the migrated schema (regenerate with --write-vocab)', async () => {
    const committed = JSON.parse(readFileSync(join(API, 'db/state-vocabularies.generated.json'), 'utf8')).vocabularies;
    expect(committed).toEqual(await liveVocab());
  }, 120_000);
  it('every adopted machine: its table.column has a CHECK and every state is in it; the static scan sees all of them', () => {
    const vocab = JSON.parse(readFileSync(join(API, 'db/state-vocabularies.generated.json'), 'utf8')).vocabularies;
    for (const m of ALL) {
      const v = vocab[`${m.table}.${m.column}`];
      expect(v, `${m.name}: ${m.table}.${m.column} has no vocabulary CHECK`).toBeTruthy();
      for (const s of m.states) expect(v, `${m.name} state '${s}'`).toContain(s);
    }
    const scanned = new Set(inventory().machines.map((x: any) => x.name));
    for (const m of ALL) expect(scanned.has(m.name), `${m.name} not found by the static scan`).toBe(true);
  });
  it('the committed tree passes (no unguarded write beyond the baseline, no value outside a CHECK, one machine per lifecycle)', () => {
    const r = spawnSync('node', ['scripts/audit-state-transitions.mjs'], { cwd: API, encoding: 'utf8' });
    expect(r.status, r.stdout.split('\n').slice(-8).join('\n')).toBe(0);
  });
  it('planted: an unguarded status UPDATE, a value outside the CHECK and a second machine are findings', () => {
    const inv = inventory();
    const src = "export const DUP = defineStateMachine({ name: 'dup', table: 'purchase_orders', column: 'status', states: ['draft'], transitions: {} });\n"
      + "await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ${id}`.execute(db);\n"
      + "await db.updateTable('inventory_counts').set({ status: 'finished' }).where('id', '=', id).execute();\n";
    const cols = new Map<string, string[]>([['purchase_orders', ['status']], ['inventory_counts', ['status']]]);
    inv.machines.push(...machinesIn(src, 'modules/x/rogue.ts'));
    inv.byKey.set('purchase_orders.status', [...(inv.byKey.get('purchase_orders.status') ?? []), ...machinesIn(src, 'modules/x/rogue.ts')]);
    for (const w of writesIn(src, cols)) inv.writes.push({ file: 'modules/x/rogue.ts', ...w, guarded: false });
    for (const v of literalValuesIn(src, cols)) if (!(inv.vocab[`${v.table}.${v.column}`] ?? []).includes(v.value)) inv.badValues.push({ file: 'modules/x/rogue.ts', ...v });
    const f = check(inv).findings.join('\n');
    expect(f).toMatch(/W1 {2}modules\/x\/rogue\.ts:2 {2}1 status write\(s\) to purchase_orders\.status outside its machine 'purchase_order'/);
    expect(f).toMatch(/V1 {2}modules\/x\/rogue\.ts:3 {2}writes 'finished' to inventory_counts\.status/);
    expect(f).toMatch(/M2 {2}purchase_orders\.status has 2 machines/);
  });
});

describe('values the gate found outside their CHECK (V1) — fixed', () => {
  it('migration 556: a technician queue ticket can end service_done / no_show (the tech app\'s "Service done" failed on it)', async () => {
    const d = (await pg.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'pos_tech_queue_tickets'::regclass and conname = 'pos_tech_queue_tickets_status_allowed'`)).rows[0].d;
    expect(d).toContain("'service_done'");
    expect(d).toContain("'no_show'");
  });
  it('the queue item writers use the queue item\'s own words — never the ticket\'s "serving"', () => {
    const vocab = JSON.parse(readFileSync(join(API, 'db/state-vocabularies.generated.json'), 'utf8')).vocabularies['pos_queue_items.status'];
    const ci = readFileSync(join(API, '../../modules/queue/src/check-in/check-in.kysely.repository.ts'), 'utf8');
    const map = /CI_TO_QUEUE_STATUS: Record<string, string> = \{[\s\S]*?\n([^\n]*)\n\s*\};/.exec(ci)![1];
    for (const v of [...map.matchAll(/:\s*'([a-z_]+)'/g)].map((x) => x[1])) expect(vocab, `CI_TO_QUEUE_STATUS → '${v}'`).toContain(v);
    for (const f of ['../../modules/booking/src/booking/booking.kysely.repository.ts', '../../modules/queue/src/service-done/service-done.kysely.repository.ts']) {
      expect(readFileSync(join(API, f), 'utf8'), f).not.toMatch(/qStatus = [^;\n]*'serving'/);
    }
  });
});

describe('each machine reproduces its domain\'s table (allowed / refused)', () => {
  it('payroll period: draft → review → finalized → paid (terminal); review → draft (send back); finalized → draft (reopen)', () => {
    expect(moves(PAYROLL_PERIOD)).toEqual(['draft>finalized', 'draft>review', 'finalized>draft', 'finalized>paid', 'review>draft', 'review>finalized']);
  });
  it('purchase order: inventory-core PO_TRANSITIONS exactly (no skipping draft → received; cancelled / closed terminal)', () => {
    expect(PURCHASE_ORDER.can('draft', 'approved') && PURCHASE_ORDER.can('partial', 'partial') && PURCHASE_ORDER.can('received', 'closed')).toBe(true);
    expect(PURCHASE_ORDER.can('draft', 'received') || PURCHASE_ORDER.can('cancelled', 'approved') || PURCHASE_ORDER.can('received', 'cancelled')).toBe(false);
  });
  it('inventory count: in_progress → submitted | reconciled | cancelled; submitted → reconciled | cancelled; reconciled terminal', () => {
    expect(moves(INVENTORY_COUNT)).toEqual(['in_progress>cancelled', 'in_progress>reconciled', 'in_progress>submitted', 'submitted>cancelled', 'submitted>reconciled']);
  });
  it('payment attempt: the mobile table + the POS reservation; a failed / refunded attempt can no longer be "settled"', () => {
    expect(PAYMENT_ATTEMPT.can('authorization_pending', 'authorized') && PAYMENT_ATTEMPT.can('created', 'ready') && PAYMENT_ATTEMPT.can('processing', 'settled') && PAYMENT_ATTEMPT.can('needs_review', 'settled')).toBe(true);
    expect(PAYMENT_ATTEMPT.can('created', 'confirmed') || PAYMENT_ATTEMPT.can('failed', 'settled') || PAYMENT_ATTEMPT.can('refunded', 'settled') || PAYMENT_ATTEMPT.can('voided', 'canceled')).toBe(false);
  });
  it('customer membership: memberships-core TRANSITIONS + the idempotent self-move; canceled / expired / completed terminal', () => {
    expect(CUSTOMER_MEMBERSHIP.can('active', 'active') && CUSTOMER_MEMBERSHIP.can('canceling', 'active') && CUSTOMER_MEMBERSHIP.can('past_due', 'suspended')).toBe(true);
    for (const t of ['active', 'pending', 'trial', 'paused']) expect(CUSTOMER_MEMBERSHIP.can('canceled', t) || CUSTOMER_MEMBERSHIP.can('expired', t), t).toBe(false);
  });
  it('loyalty code, invitation, holds, verification, deals, drawers: the moves their writers make — and no way back from an end state', () => {
    expect(moves(LOYALTY_REDEMPTION)).toEqual(['applied>applied', 'applied>issued', 'applied>used', 'issued>applied']);
    expect(moves(USER_INVITATION)).toEqual(['pending>accepted', 'pending>cancelled', 'pending>expired']);
    for (const end of ['released', 'converted', 'expired']) expect(BOOKING_HOLD.states.some((t) => BOOKING_HOLD.can(end, t)), end).toBe(false);
    expect(BOOKING_VERIFICATION_SESSION.can('locked', 'verified')).toBe(true);           // the staff override
    expect(BOOKING_VERIFICATION_SESSION.states.some((t) => BOOKING_VERIFICATION_SESSION.can('verified', t))).toBe(false);
    expect(DEAL_REDEMPTION_HOLD.can('released', 'redeemed') || DEAL_REDEMPTION_HOLD.can('expired', 'held') || DEAL_REDEMPTION.can('reversed', 'redeemed')).toBe(false);
    expect(CASH_DRAWER_SESSION.can('reconciled', 'open') || TECH_CASH_HANDOFF.can('reconciled', 'submitted')).toBe(false);   // re-opening keeps a counted result
  });
});

const T = 'd2700000-0000-4000-8000-000000000001', B = 'd2700000-0000-4000-8000-0000000000b1', U = 'd2700000-0000-4000-8000-0000000000c1';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.payroll.manage', 'inventory.manage', 'inventory.view'] } as any;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
describe('the writers on the real schema (#27)', () => {
  beforeAll(async () => {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Machine Nails LLC','Machine Nails','d27a','D27A')`, [T]);
    await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
    await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'owner@d27.test','Owner','OWNER','active') on conflict do nothing`, [U, T]).catch(() => undefined);
  });

  it('payroll: a paid period is locked (409); the repository re-checks on the locked row (a stale "reopen" cannot unlock it)', async () => {
    const repo = new KyselyPayrollRepository(db);
    const svc = new PayrollService(repo);
    const p = await svc.createPeriod(ctx, { periodStart: '2026-09-01', periodEnd: '2026-09-15' });
    await svc.finalize(ctx, p.id);
    await svc.markPaid(ctx, p.id);
    await expect(svc.reopen(ctx, p.id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'paid', to: 'draft' } });
    // the service's read was 'finalized' (stale) — the repository still refuses on the row it locks
    await expect(repo.setStatus(ctx, p.id, 'draft')).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect((await q(`select status from payroll_periods where id = $1`, [p.id]))[0].status).toBe('paid');
  });

  it('purchase order: a cancel that lost the race to a receive is refused — the received PO is not overwritten', async () => {
    const prod = (await q(`insert into inventory_products (tenant_id, name) values ($1,'Gel Base') returning id`, [T]))[0];
    const inv = new InventoryService(db);
    const po = await inv.createPurchaseOrder(ctx, { lines: [{ productId: prod.id, quantityOrdered: 2, unitCostCents: 500 }] });
    await inv.approvePurchaseOrder(ctx, po.id);
    const line = (await q(`select id from purchase_order_lines where purchase_order_id = $1`, [po.id]))[0];
    await inv.receivePurchaseOrder(ctx, po.id, { lines: [{ lineId: line.id, quantity: 2 }] });
    expect((await q(`select status from purchase_orders where id = $1`, [po.id]))[0].status).toBe('received');
    // the cancel path read 'approved' before the receive landed: through the machine it is a 409, not a silent overwrite
    await expect(transitionStatus(db, PURCHASE_ORDER, { where: { id: po.id, tenant_id: T }, from: 'approved', to: 'cancelled' })).rejects.toMatchObject({ details: { reason: 'concurrent', from: 'received' } });
    await expect(inv.cancelPurchaseOrder(ctx, po.id)).rejects.toThrow(/Cannot cancel a received/);
    expect((await q(`select status from purchase_orders where id = $1`, [po.id]))[0].status).toBe('received');
  });

  it('inventory count: reconcile is claimed first — a second reconcile is refused before it touches stock', async () => {
    const inv = new InventoryService(db);
    const c = await inv.createCount(ctx, {});
    await inv.reconcileCount(ctx, c.id);
    const units = Number((await q(`select count(*)::int n from inventory_units where tenant_id = $1`, [T]))[0].n);
    await expect(transitionStatus(db, INVENTORY_COUNT, { where: { id: c.id, tenant_id: T }, from: 'in_progress', to: 'reconciled' })).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(inv.reconcileCount(ctx, c.id)).rejects.toThrow(/Cannot reconcile a reconciled count/);
    expect(Number((await q(`select count(*)::int n from inventory_units where tenant_id = $1`, [T]))[0].n)).toBe(units);
  });

  it('writers with no prior read: a failed payment attempt is not "settled"; a canceled membership is not renewed back to active', async () => {
    await q(`SET session_replication_role = replica`);   // the ticket foreign key is not what this test is about
    await q(`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) values ($1,$2,gen_random_uuid(),2500,'card','failed','d27-pa-1'), ($1,$2,gen_random_uuid(),2500,'card','processing','d27-pa-2')`, [T, B]);
    await q(`SET session_replication_role = DEFAULT`);
    await new KyselyCheckoutRepository(db).settlePaymentAttempt(ctx, 'd27-pa-1');
    expect((await q(`select status from payment_attempts where idempotency_key = 'd27-pa-1'`))[0].status).toBe('failed');   // was: settled
    await new KyselyCheckoutRepository(db).settlePaymentAttempt(ctx, 'd27-pa-2');
    expect((await q(`select status from payment_attempts where idempotency_key = 'd27-pa-2'`))[0].status).toBe('settled');
    await q(`SET session_replication_role = replica`);   // plan / customer foreign keys are not what this test is about
    const m = (await q(`insert into customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status) values ($1,$2,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'canceled') returning id`, [T, B]))[0];
    await q(`SET session_replication_role = DEFAULT`);
    const billing = new KyselyMembershipBillingRepository(db);
    await expect(billing.advancePeriod(m.id, { status: 'active', currentPeriodStart: new Date(), currentPeriodEnd: new Date(), nextBillingAt: null, cyclesBilled: 1 } as any))
      .rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { machine: 'customer_membership', from: 'canceled', to: 'active' } });
    expect((await q(`select status, cycles_billed from customer_memberships where id = $1`, [m.id]))[0]).toMatchObject({ status: 'canceled', cycles_billed: 0 });
  });

  it('set-based writes (canMoveToSql): a used loyalty code is never released back to issued; an accepted invitation never expires', async () => {
    const cust = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'Ana','Lee','Ana Lee') returning id`, [T, B]))[0];
    const tk = (await q(`insert into tickets (tenant_id, branch_id, status) values ($1,$2,'open') returning id`, [T, B]).catch(() => [{ id: 'd2700000-0000-4000-8000-0000000000f1' }]))[0];
    const r = (await q(`insert into loyalty_redemptions (tenant_id, customer_id, reward_id, reward_title, points_spent, code, created_at, status, ticket_id)
      values ($1,$2,gen_random_uuid(),'Free polish',100,'D27CODE',now(),'used',$3) returning id`, [T, cust.id, tk.id]))[0];
    const res = await sql`update loyalty_redemptions set status = 'issued', ticket_id = null where tenant_id = ${T} and id = ${r.id} and ${canMoveToSql(LOYALTY_REDEMPTION, 'issued')}`.execute(db);
    expect(Number((res as any).numAffectedRows ?? 0)).toBe(0);
    expect((await q(`select status from loyalty_redemptions where id = $1`, [r.id]))[0].status).toBe('used');
    const inv = (await q(`insert into user_invitations (tenant_id, email, role, token_hash, token_prefix, expires_at, status) values ($1,'x@d27.test','MANAGER','h','p',now() - interval '1 day','accepted') returning id`, [T]))[0];
    await sql`update user_invitations set status='expired' where ${canMoveToSql(USER_INVITATION, 'expired')} and expires_at < now()`.execute(db);
    expect((await q(`select status from user_invitations where id = $1`, [inv.id]))[0].status).toBe('accepted');
  });
});
