// loyalty-bonus.pgtest — Customer Profile & Global Loyalty Protection guide (Nov 4 2026) on the real schema.
//   §01 no manual point reduction · §04 manager asks, owner approves · §05 token debit + global credit exactly once ·
//   §06 every tenant edit path refuses · §11 the read-only health check.
// The approvals engine is replaced by a recording port (the engine's own decide / expiry / separation-of-duties rules are
// covered in modules/workforce approvals.pgtest); here the executor this module registers is driven directly.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { GlobalRewardsRepository, GR_FLAGS } from '@aipowersalon/loyalty';
import { LoyaltyBonusService, LoyaltyBonusError, type BonusActor, type LoyaltyBonusApprovalsPort } from './loyalty-bonus';
import { LoyaltyProgramRepository, LoyaltyProgramError } from './loyalty-program.repository';
import { applyLoyaltyEntry } from './loyalty-ledger.service';

const P = 'b0b00000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
const MGR = id('e1'), OWN = id('e2');
const CG = id('c1');   // in the global network (verified, opted in)
const CS = id('c2');   // salon points only
const IDV = id('f1');
const mgr: BonusActor = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['pos.customers.view', 'pos.customers.loyalty.edit'] };
const own: BonusActor = { tenantId: T, branchId: B, userId: OWN, role: 'OWNER', permissions: ['loyalty.bonus.approve'] };
let pg: any; let db: any; let svc: LoyaltyBonusService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
type Exec = Parameters<LoyaltyBonusApprovalsPort['registerExecutor']>[1];
let executor: Exec; const requests: { id: string; subjectId: string | null; payload: Record<string, unknown>; reason: string; branchId: string | null; title: string; amountCents: number }[] = [];
const port: LoyaltyBonusApprovalsPort = {
  registerExecutor: (_k, ex) => { executor = ex; },
  request: async (actor, body: any) => {
    const live = requests.find((r) => r.subjectId === body.subjectId && !(r as any).done);
    if (live) return { request: live, created: false };
    const prep: any = await executor.prepare!(actor, { subjectType: body.subjectType, subjectId: body.subjectId, reason: body.reason, payload: body.payload, branchId: actor.branchId });
    const r = { id: crypto.randomUUID(), subjectId: prep.subjectId, payload: prep.payload, reason: body.reason, branchId: prep.branchId, title: prep.title, amountCents: prep.amountCents };
    requests.push(r); return { request: r, created: true };
  },
};
const approve = async (r: (typeof requests)[number]) => { const out = await executor.execute(own, r); (r as any).done = true; return out; };
const wallet = async () => Number((await q(`select available_cents from tenant_token_wallets where tenant_id = $1`, [T]))[0]?.available_cents ?? 0);
const globalPts = async () => Number((await q(`select available_tenths from global_rewards_accounts where identity_id = $1`, [IDV]))[0]?.available_tenths ?? 0) / 10;
const salonPts = async (c: string) => Number((await q(`select points_balance from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [T, c]))[0]?.points_balance ?? 0);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.name; } }

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Bonus LLC','Bonus','lb-a','LBA001','active'), ($2,'Other LLC','Other','lb-b','LBB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Other','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+16095550142','active'), ($4,$2,$3,'Bo','Lee','Bo Lee','+16095550199','active')`, [CG, T, B, CS]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ava Kim','ava@lb.test','active','CUSTOMER')`, [id('71'), T]);
  await q(`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values ($1,'+16095550142','Ava Kim','active',now())`, [IDV]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDV, T, id('71'), CG]);
  await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) values ($1,'2026-10-30','customer_app',now(),'customer_app')`, [IDV]);
  for (const k of [GR_FLAGS.engine, GR_FLAGS.earn, GR_FLAGS.purchases]) await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ($1,'loyalty','true'::jsonb,'boolean') on conflict (setting_key) do update set value = excluded.value`, [k]);
  const repo = new GlobalRewardsRepository(db);
  await repo.setEnrollment(T, 'enrolled', { reason: 'pilot salon for bonus tests', actorUserId: OWN });
  const r = await repo.createPurchase({ tenantId: T, branchId: B, userId: OWN, role: 'OWNER', permissions: ['pos.settings.edit', 'pos.customers.view'] } as any, { tokens: 3, idempotencyKey: 'lb-fund-1', provider: 'sandbox' });
  await repo.movePurchase(r.intentId, 'PAYMENT_CONFIRMED', { tenantId: T, source: 'test', providerRef: 'sbx_' + r.intentId });
  await repo.movePurchase(r.intentId, 'FUNDS_VERIFIED', { tenantId: T, source: 'test' });
  svc = new LoyaltyBonusService(db).useApprovals(port);
  // the salon-only customer starts with 7 points earned the normal way
  await db.transaction().execute((trx: any) => applyLoyaltyEntry(trx, { tenantId: T, branchId: B, customerId: CS, entryType: 'earn', delta: 7, sourceTable: 'tickets', sourceId: id('99'), legacyType: 'earn_purchase' }));
}, 240_000);

describe('§04/§05 a manager asks; nothing moves until the owner approves', () => {
  it('a global customer: the request shows server figures (current, after, 1.00 token for 10 points) and moves nothing', async () => {
    const before = { w: await wallet(), p: await globalPts() };
    expect(before.w).toBe(300);
    const out = await svc.request(mgr, { customerId: CG, points: 10, reason: 'Service recovery' });
    expect(out.created).toBe(true);
    expect(out.request.payload).toMatchObject({ target: 'global', currentPoints: 0, points: 10, pointsAfter: 10, tokenCostCents: 100, walletAvailableCents: 300 });
    expect(out.request.amountCents).toBe(100);
    const al = await q(`select title, body from owner_alerts where tenant_id = $1 and category = 'loyalty'`, [T]);
    expect(al).toEqual([{ title: 'Bonus points waiting for your approval', body: expect.stringContaining('10 bonus points') }]);
    expect(al[0].body).not.toMatch(/Ava|Service recovery/);
    expect(await wallet()).toBe(before.w); expect(await globalPts()).toBe(before.p);
  });
  it('a second ask for the same customer while one waits is refused (not a second request)', async () => {
    expect(await code(svc.request(mgr, { customerId: CG, points: 5, reason: 'Again' }))).toBe('LOYALTY_BONUS_ALREADY_WAITING');
  });
  it('approval: exactly one token debit (1.00) + one points credit (+10) + one balanced journal entry; a replay moves nothing', async () => {
    const r = requests[0];
    const out: any = await approve(r);
    expect(out).toMatchObject({ target: 'global', points: 10, tokenCostCents: 100, walletAfterCents: 200, pointsAfter: 10, replay: false });
    expect(await wallet()).toBe(200); expect(await globalPts()).toBe(10);
    const again: any = await executor.execute(own, r);
    expect(again.replay).toBe(true);
    expect(await wallet()).toBe(200); expect(await globalPts()).toBe(10);
    const j = await q(`select e.entry_type, sum(l.debit_cents)::int d, sum(l.credit_cents)::int c from rewards_journal_entries e join rewards_journal_lines l on l.entry_id = e.id where e.source_id = $1 group by e.entry_type`, [r.id]);
    expect(j).toEqual([{ entry_type: 'bonus_award', d: 100, c: 100 }]);
  });
  it('not enough tokens at approval: nothing moves, the request fails with LOYALTY_BONUS_NEEDS_FUNDING', async () => {
    const out = await svc.request(mgr, { customerId: CG, points: 30, reason: 'Big apology' });   // needs 3.00, wallet has 2.00
    expect(await code(approve(out.request as any))).toBe('LOYALTY_BONUS_NEEDS_FUNDING');
    expect(await wallet()).toBe(200); expect(await globalPts()).toBe(10);
  });
  it('a salon-only customer: the bonus goes to the salon\'s own points (no tokens), once', async () => {
    const out = await svc.request(mgr, { customerId: CS, points: 5, reason: 'Birthday' });
    expect(out.request.payload).toMatchObject({ target: 'salon', currentPoints: 7, pointsAfter: 12, tokenCostCents: null });
    const res: any = await approve(out.request as any);
    expect(res).toMatchObject({ target: 'salon', pointsAfter: 12 });
    expect(await salonPts(CS)).toBe(12);
    expect((await executor.execute(own, out.request as any) as any).replay).toBe(true);
    expect(await salonPts(CS)).toBe(12);
    expect(await wallet()).toBe(200);
  });
});

describe('§06 the request itself only adds, and every direct edit path refuses', () => {
  it('zero, negative, fractional, over 5,000 or reasonless bonuses are refused', async () => {
    for (const b of [{ points: 0 }, { points: -5 }, { points: 2.5 }, { points: 5001 }, { points: 5, reason: ' ' }]) {
      expect(await code(svc.request(mgr, { customerId: CS, reason: 'x y z', ...b }))).toBe('LOYALTY_BONUS_INVALID');
    }
  });
  it('another salon\'s customer is not found (tenant from the session)', async () => {
    expect(await code(svc.request({ ...mgr, tenantId: T2, branchId: B2 }, { customerId: CS, points: 5, reason: 'cross salon' }))).toBe('CUSTOMER_NOT_FOUND');
  });
  it('POST /pos/loyalty/adjust refuses a deduction AND an addition (LOYALTY_DIRECT_EDIT_REFUSED); balances unchanged', async () => {
    const repo = new LoyaltyProgramRepository(db, { record: async () => undefined } as any);
    const ctx = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['pos.customers.loyalty.edit'] } as any;
    for (const delta of [-12, 50]) {
      const e = await repo.adjust(ctx, { customerId: CS, delta, reason: 'manual', idempotencyKey: crypto.randomUUID() }).catch((x) => x);
      expect(e).toBeInstanceOf(LoyaltyProgramError); expect((e as LoyaltyProgramError).code).toBe('LOYALTY_DIRECT_EDIT_REFUSED');
    }
    expect(await salonPts(CS)).toBe(12);
  });
});

describe('§11 the health check (read-only)', () => {
  it('passes on clean books, and finds a credit that has no approved request', async () => {
    // the fake port does not write tenant_approval_requests, so record the two executed requests the way the engine would
    for (const r of requests.filter((x: any) => x.done)) {
      await q(`insert into tenant_approval_requests (id, tenant_id, branch_id, kind, subject_type, subject_id, title, amount_cents, payload, reason, requested_by_user_id, required_permission, status, expires_at)
        values ($1,$2,$3,'loyalty_bonus','customer',$4,$5,$6,$7::jsonb,$8,$9,'loyalty.bonus.approve','executed', now() + interval '7 days')`, [r.id, T, B, r.subjectId, r.title, r.amountCents, JSON.stringify(r.payload), r.reason, MGR]);
    }
    const h = await svc.health(mgr);
    const by = Object.fromEntries(h.checks.map((c) => [c.key, c.result]));
    expect(by).toMatchObject({ approved_bonus_posted_once: 'passed', no_credit_without_owner_approval: 'passed', no_manual_point_reduction: 'passed' });
    await db.transaction().execute((trx: any) => applyLoyaltyEntry(trx, { tenantId: T, branchId: B, customerId: CS, entryType: 'adjust', delta: 3, reason: 'sneaky', sourceTable: 'tenant_approval_requests', sourceId: id('dead'), legacyType: 'bonus_approved' }));
    const h2 = await svc.health(mgr);
    expect(h2.checks.find((c) => c.key === 'no_credit_without_owner_approval')).toMatchObject({ result: 'failed', affected: [id('dead')] });
  });
  it('without the approvals engine the service says so (503), never silently credits', async () => {
    const lone = new LoyaltyBonusService(db);
    const e = await lone.request(mgr, { customerId: CS, points: 1, reason: 'no engine' }).catch((x) => x);
    expect(e).toBeInstanceOf(LoyaltyBonusError); expect((e as LoyaltyBonusError).status).toBe(503);
  });
});
