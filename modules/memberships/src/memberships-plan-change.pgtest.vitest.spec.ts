// memberships-plan-change.pgtest — extras Membership Overview 13 · 10 "Smart subscription change preview" on the REAL schema:
// the preview uses the SAME normalisation as publishing (a refused change is refused here too), compares with the current
// version, says who keeps which terms (live members stay on the version they joined; only new joiners get the change),
// carries every unsent term + the benefits forward, and writes nothing. Publishing with carryForward keeps those terms.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipsRepository } from './memberships.kysely.repository';
import { MembershipsService } from './memberships.service';

const P = 'c5e84000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), PL = id('f1'), V1 = id('e1'), V2 = id('e2'), PLX = id('f9'), VX = id('e9'), PLA = id('f8'), VA = id('e8'), SVC = id('51');
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.memberships.view', 'pos.memberships.manage'] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let svc: MembershipsService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const counts = async () => (await q(`select (select count(*) from membership_plan_versions)::int as v, (select count(*) from membership_benefits)::int as b, (select count(*) from customer_memberships)::int as m, (select count(*) from membership_audit)::int as a`)).rows[0];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.message; } }

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Club LLC','Club','pc-club','PCC001','active'), ($2,'Other LLC','Other','pc-other','PCC002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('5c'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes) values ($1,$2,$3,$4,'Gel manicure',4500,45)`, [SVC, T, B, id('5c')]);
  await q(`insert into membership_plans (id, tenant_id, name, status) values ($1,$2,'VIP Club','active'), ($3,$2,'Old Club','archived'), ($4,$5,'Other Club','active')`, [PL, T, PLA, PLX, T2]);
  // VIP Club: v1 ($39, 2 members), v2 current ($49, trial 7 days, period_end, 70/30 split, 1 member + 1 cancelled)
  await q(`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, billing_interval, price_cents, trial_days, cancellation_policy, tech_split_pct, owner_split_pct, enrollment_fee_cents) values
    ($1,$2,$3,1,'month',3900,0,'period_end',60,40,0), ($4,$2,$3,2,'month',4900,7,'period_end',70,30,1000), ($5,$6,$3,1,'month',2900,0,'period_end',60,40,0), ($7,$8,$9,1,'month',1000,0,'period_end',60,40,0)`,
    [V1, PL, T, V2, VA, PLA, VX, PLX, T2]);
  await q(`update membership_plans set current_version_id = case id when $1 then $2::uuid when $3 then $4::uuid when $5 then $6::uuid end where id in ($1,$3,$5)`, [PL, V2, PLA, VA, PLX, VX]);
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, service_id, credits_per_cycle, max_per_cycle, sort_order) values ($1,$2,'service_credit','Free gel manicure',$3,1,1,0), ($1,$2,'percent_discount','Member discount',null,0,null,1)`, [V2, T, SVC]);
  await q(`update membership_benefits set percent = 15 where label = 'Member discount'`);
  for (let i = 0; i < 5; i++) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'C','${i}','C ${i}')`, [id('c0' + i), T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'X','X','X X')`, [id('c99'), T2, B2]);
  const cm = (n: number, ver: string, status: string) => q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status) values ($1,$2,$3,$4,$5,$6,$7)`, [id('d0' + n), T, B, id('c0' + n), PL, ver, status]);
  await cm(0, V1, 'active'); await cm(1, V1, 'past_due'); await cm(2, V2, 'trial'); await cm(3, V2, 'canceled');
  await q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status) values ($1,$2,$3,$4,$5,$6,'active')`, [id('d99'), T2, B2, id('c99'), PLX, VX]);
  svc = new MembershipsService(new KyselyMembershipsRepository(kyselyFor(pg) as any));
}, 240_000);

describe('extras Membership Overview 13 · 10 — smart subscription change preview', () => {
  it('a price change: current members keep their own version terms; future members get the new price; every other term is carried forward; nothing is written', async () => {
    const before = await counts();
    const p = await svc.previewVersion(ctx, PL, { priceCents: 5900, carryForward: true });
    expect(p).toMatchObject({ planId: PL, blockers: [], currentVersionNumber: 2, nextVersionNumber: 3, readOnly: true });
    expect(p.changes).toEqual([{ field: 'priceCents', from: 4900, to: 5900 }]);                 // trial, fee, split, policy, benefits: unchanged
    expect(p.benefits).toEqual({ current: 2, proposed: 2, carriedForward: true });
    expect(p.currentSubscribers.total).toBe(3);                                                  // active + past_due on v1, trial on v2 (cancelled is not live)
    expect(p.currentSubscribers.byVersion).toEqual([
      { versionNumber: 2, priceCents: 4900, billingInterval: 'month', members: 1, current: true },
      { versionNumber: 1, priceCents: 3900, billingInterval: 'month', members: 2, current: false },
    ]);
    expect(p.currentSubscribers.keepTheirTerms).toBe(true);
    expect(p.futureSubscribers).toEqual({ priceCents: 5900, billingInterval: 'month', priceDeltaCents: 1000 });
    expect(await counts()).toEqual(before);
  });

  it('the preview refuses what publishing refuses (same validation); an unchanged proposal and an archived plan are flagged', async () => {
    expect(await code(svc.previewVersion(ctx, PL, { techSplitPct: 80, ownerSplitPct: 30, carryForward: true }))).toBe('SPLIT_MUST_TOTAL_100');
    expect(await code(svc.publishVersion(ctx, PL, { techSplitPct: 80, ownerSplitPct: 30, carryForward: true }))).toBe('SPLIT_MUST_TOTAL_100');
    expect(await code(svc.previewVersion(ctx, PL, { priceCents: -5, carryForward: true }))).toBe('PRICE_NEGATIVE');
    expect((await svc.previewVersion(ctx, PL, { carryForward: true })).blockers).toEqual(['no_change']);
    expect((await svc.previewVersion(ctx, PLA, { priceCents: 3500, carryForward: true })).blockers).toEqual(['plan_archived']);
  });

  it('without carryForward the preview shows exactly what publishing would reset (the old behaviour is unchanged and visible)', async () => {
    const p = await svc.previewVersion(ctx, PL, { priceCents: 5900 });
    const fields = p.changes.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['priceCents', 'trialDays', 'enrollmentFeeCents', 'techSplitPct', 'ownerSplitPct', 'benefits']));
    expect(p.benefits).toEqual({ current: 2, proposed: 0, carriedForward: false });
  });

  it('another salon\'s plan is not found; publishing with carryForward keeps every term and copies the benefits (service link included)', async () => {
    expect(await code(svc.previewVersion(ctx2, PL, { priceCents: 100, carryForward: true }))).toBe('PLAN_NOT_FOUND');
    const r = await svc.publishVersion(ctx, PL, { priceCents: 5900, carryForward: true });
    expect(r.versionNumber).toBe(3);
    const v = (await q(`select price_cents, trial_days, enrollment_fee_cents, tech_split_pct, owner_split_pct, cancellation_policy from membership_plan_versions where id = $1`, [r.versionId])).rows[0];
    expect(v).toMatchObject({ price_cents: 5900, trial_days: 7, enrollment_fee_cents: 1000, cancellation_policy: 'period_end' });
    expect(Number(v.tech_split_pct)).toBe(70); expect(Number(v.owner_split_pct)).toBe(30);
    const b = (await q(`select label, service_id, credits_per_cycle, max_per_cycle, percent from membership_benefits where plan_version_id = $1 order by sort_order`, [r.versionId])).rows;
    expect(b.map((x: any) => [x.label, x.service_id, Number(x.credits_per_cycle), x.max_per_cycle == null ? null : Number(x.max_per_cycle), Number(x.percent)])).toEqual([
      ['Free gel manicure', SVC, 1, 1, 0], ['Member discount', null, 0, null, 15]]);
    // existing members were not moved to the new version
    expect((await q(`select count(*)::int as n from customer_memberships where plan_version_id = $1`, [r.versionId])).rows[0].n).toBe(0);
  });
});
