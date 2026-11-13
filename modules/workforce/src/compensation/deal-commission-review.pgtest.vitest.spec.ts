// deal-commission-review.pgtest — Extras · Deals & Offers 12 "Commission Impact Review: flag deals where commission basis
// or funding allocation is not approved before production", on the REAL migrated schema (migration 881):
// every unfinished deal is listed with the funding allocation checkout applies today, a worked sample by THE engine with
// each technician's money-path rate and THE deals pricing rule, and a flag until an owner approves the deal's CURRENT
// version; editing the deal's terms flags it again; approvals are append-only and audited; other salons never appear.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DealCommissionReviewService, DealCommissionReviewError, dealReviewFlag } from './deal-commission-review';
import { CHECKOUT_DISCOUNT_FUNDING, resolveFromRules } from './compensation-rule-loader';

const id = (n: number) => `88100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), X = id(2), B = id(3), BX = id(4), CAT = id(5), CATX = id(6), OWNER = id(7);
const GEL = id(11), GELX = id(12);
const ANN = id(21), BEA = id(22), XO = id(23);
const D_SALON = id(31), D_TECH = id(32), D_NOSVC = id(33), D_DONE = id(34), D_X = id(35);
let pg: any; let db: any; let svc: DealCommissionReviewService;
const audits: { action: string; resourceId?: string; metadata?: Record<string, unknown> }[] = [];
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER' };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof DealCommissionReviewError ? `${e.status}:${e.code}` : String(e?.message); } }

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  svc = new DealCommissionReviewService(db, { record: (_w, ev) => { audits.push(ev); } });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'S','Pilot','dc-881','DC881','active',50), ($2,'X','Other','dc-881x','DC881X','active',50)`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$4,'Other','active','UTC')`, [B, T, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@dc.test','active','OWNER')`, [OWNER, T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$2,$3,'Nails','active'), ($4,$5,$6,'Nails','active')`, [CAT, T, B, CATX, X, BX]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) values
    ($1,$2,$3,$4,'Gel manicure',45,5000,'percent',40), ($5,$6,$7,$8,'Gel X',45,5000,'percent',40)`, [GEL, T, B, CAT, GELX, X, BX, CATX]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values
    ($1,$2,$3,'Ann','A','Ann A',true), ($4,$2,$3,'Bea','B','Bea B',true), ($5,$6,$7,'Xo','X','Xo X',true)`, [ANN, T, B, BEA, XO, X, BX]);
  // Ann has an authored Technician + Service rule at 60 %; Bea takes the service's own 40 %
  const [pol] = await q(`insert into compensation_policies (tenant_id, technician_id, service_id) values ($1,$2,$3) returning id`, [T, ANN, GEL]);
  await q(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, supply_method, supply_value, status, effective_start, approved)
    values ($1,$2,1,'percent',60,'none',0,'active', now() - interval '10 days', true)`, [pol.id, T]);
  const deal = (i: string, tenant: string, title: string, o: { owner?: string; tech?: string | null; type?: string; pct?: number | null; cents?: number | null; max?: number | null; status?: string }) =>
    q(`insert into deals (id, tenant_id, owner_type, technician_id, kind, title, discount_type, discount_percent, discount_cents, max_discount_cents, status)
      values ($1,$2,$3,$4,'deal',$5,$6,$7,$8,$9,$10)`, [i, tenant, o.owner ?? 'salon', o.tech ?? null, title, o.type ?? 'percent', o.pct ?? null, o.cents ?? null, o.max ?? null, o.status ?? 'active']);
  await deal(D_SALON, T, 'Gel 20% off', { pct: 20 });
  await deal(D_TECH, T, 'Ann: $10 off gel', { owner: 'technician', tech: ANN, type: 'fixed', cents: 1000, status: 'pending_approval' });
  await deal(D_NOSVC, T, 'Anything 10%', { pct: 10, status: 'draft' });
  await deal(D_DONE, T, 'Old summer deal', { pct: 30, status: 'expired' });
  await deal(D_X, X, 'Other salon deal', { pct: 50 });
  await q(`insert into deal_services (deal_id, service_id, tenant_id) values ($1,$3,$4), ($2,$3,$4), ($5,$6,$7)`, [D_SALON, D_TECH, GEL, T, D_X, GELX, X]);
}, 180_000);

describe('Deals & Offers 12 — commission impact review', () => {
  it('lists unfinished deals only, each flagged until approved, with the funding checkout applies today', async () => {
    const r = await svc.list(ctx, { page: 1, pageSize: 10 });
    expect(r.fundingNow).toBe(CHECKOUT_DISCOUNT_FUNDING);
    expect(r.items.map((x) => x.title).sort()).toEqual(['Ann: $10 off gel', 'Anything 10%', 'Gel 20% off']);   // not expired, not another salon's
    expect(r.items.every((x) => x.flag === 'not_reviewed' && x.review === null)).toBe(true);
    expect(r.flaggedTotal).toBe(3);
    // the funding the review states is the one the money path stamps on a line
    const won = resolveFromRules([{ id: 'v', tenantId: T, policyId: 'p', version: 1, branchId: null, technicianId: null, serviceId: null, serviceCategory: null, ticketId: null,
      commission: { type: 'percent', value: 50 }, supply: { method: 'none', value: 0 }, effectiveStart: '2020-01-01T00:00:00Z', effectiveEnd: null, approved: true }], { tenantId: T, branchId: null, technicianId: null, serviceId: null, serviceCategory: null, ticketId: null });
    expect(won?.discountFunding).toBe(r.fundingNow);
  });

  it('the sample is THE engine with each technician\'s money-path rate and THE deals pricing rule; no service named → no sample', async () => {
    const r = await svc.list(ctx, { page: 1, pageSize: 10 });
    const by = Object.fromEntries(r.items.map((x) => [x.title, x]));
    // salon deal, 20 % of $50 = $10 off, both technicians: Ann 60 % (3000 → 2400), Bea 40 % (2000 → 1600)
    expect(by['Gel 20% off'].sample).toEqual({ serviceId: GEL, serviceName: 'Gel manicure', priceCents: 5000, discountCents: 1000, technicians: 2,
      earningsFullMinCents: 2000, earningsFullMaxCents: 3000, earningsDiscountedMinCents: 1600, earningsDiscountedMaxCents: 2400, changeMinCents: -600, changeMaxCents: -400 });
    // technician deal: only Ann — $10 off under proportional funding: 3000 → 2400
    expect(by['Ann: $10 off gel'].sample).toMatchObject({ technicians: 1, discountCents: 1000, earningsFullMinCents: 3000, earningsDiscountedMinCents: 2400, changeMinCents: -600 });
    expect(by['Ann: $10 off gel'].technicianName).toBe('Ann A');
    expect(by['Anything 10%'].sample).toBeNull();
  });

  it('approving records the current version (append-only, audited); a later edit of the terms flags the deal again', async () => {
    const row = await svc.approve(ctx, D_SALON, { note: 'Salon and tech share it, as agreed' });
    expect(row.flag).toBeNull();
    expect(row.review).toMatchObject({ version: 1, funding: CHECKOUT_DISCOUNT_FUNDING, reviewedBy: 'Owner Kim', note: 'Salon and tech share it, as agreed' });
    expect(audits.at(-1)).toMatchObject({ action: 'deal_commission_impact_approved', resourceId: D_SALON });
    expect((await svc.list(ctx, { flagged: 'true' })).items.map((x) => x.dealId)).not.toContain(D_SALON);
    await q(`update deals set version = 2, discount_percent = 25 where id = $1`, [D_SALON]);
    const after = (await svc.list(ctx, { flagged: 'true' })).items.find((x) => x.dealId === D_SALON)!;
    expect(after.flag).toBe('terms_changed');
    expect(after.sample!.discountCents).toBe(1250);
    // history is kept: updating or deleting a review is refused by the database
    await expect(q(`update deal_commission_reviews set note = 'x' where deal_id = $1`, [D_SALON])).rejects.toThrow(/append-only/);
    await expect(q(`delete from deal_commission_reviews where deal_id = $1`, [D_SALON])).rejects.toThrow(/append-only/);
    // the deal itself was never touched by the review
    expect((await q(`select status, discount_percent from deals where id = $1`, [D_SALON]))[0]).toEqual({ status: 'active', discount_percent: 25 });
  });

  it('refuses another salon\'s deal, a finished deal and a bad id; the database refuses a review crossing salons', async () => {
    expect(await code(svc.approve(ctx, D_X, {}))).toBe('404:DEAL_NOT_FOUND');
    expect(await code(svc.approve(ctx, D_DONE, {}))).toBe('404:DEAL_NOT_FOUND');
    expect(await code(svc.approve(ctx, 'nope', {}))).toBe('404:DEAL_NOT_FOUND');
    expect(await code(svc.approve(ctx, D_TECH, { note: 'x'.repeat(501) }))).toBe('400:VALIDATION_FAILED');
    await expect(q(`insert into deal_commission_reviews (tenant_id, deal_id, deal_version, discount_funding) values ($1,$2,1,'proportional')`, [T, D_X])).rejects.toThrow();
    expect((await svc.list({ tenantId: X, branchId: BX, userId: null, role: 'OWNER' }, {})).items.map((x) => x.dealId)).toEqual([D_X]);
  });

  it('pure flag rule', () => {
    expect(dealReviewFlag(1, null, 'proportional')).toBe('not_reviewed');
    expect(dealReviewFlag(3, { version: 2, funding: 'proportional' }, 'proportional')).toBe('terms_changed');
    expect(dealReviewFlag(2, { version: 2, funding: 'salon_funded' }, 'proportional')).toBe('funding_changed');
    expect(dealReviewFlag(2, { version: 2, funding: 'proportional' }, 'proportional')).toBeNull();
  });
});
