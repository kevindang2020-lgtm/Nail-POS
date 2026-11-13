// compensation-service-preview.pgtest — SERVICE PRICING 12, Technician Compensation Preview, on the REAL schema:
// each technician's rate is the money path's precedence (authored Technician + Service rule with a supply charge → the
// service's own rate → the salon default), earnings come from the engine at the current and a proposed price, the actual
// payouts are grouped by the source their snapshot recorded, archived technicians and other salons never appear, and
// nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ServiceCompensationPreviewService, ServicePreviewError } from './compensation-service-preview';
import { resolveLineCommissionWithDefault } from './compensation-rule-loader';

const id = (n: number) => `86200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), X = id(2), B = id(3), BX = id(4), CAT = id(5), CATX = id(6);
const SVC = id(11), SVC_NORATE = id(12), SVCX = id(13);
const ANN = id(21), BEA = id(22), CY = id(23), XO = id(24);
let pg: any; let db: any; let svc: ServiceCompensationPreviewService;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof ServicePreviewError ? `${e.status}:${e.code}` : String(e?.message); } }

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); svc = new ServiceCompensationPreviewService(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'S','Pilot','sp-862','SP862','active',50), ($2,'X','Other','sp-862x','SP862X','active',50)`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$4,'Other','active','UTC')`, [B, T, BX, X]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$2,$3,'Nails','active'), ($4,$5,$6,'Nails','active')`, [CAT, T, B, CATX, X, BX]);
  // Gel: the service's own rate is 40 %; No-rate: none (→ salon default 50 %)
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) values
    ($1,$2,$3,$4,'Gel manicure',45,5000,'percent',40), ($5,$2,$3,$4,'Polish change',15,2000,'none',0), ($6,$7,$8,$9,'Gel X',45,5000,'percent',40)`, [SVC, T, B, CAT, SVC_NORATE, SVCX, X, BX, CATX]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, archived_at) values
    ($1,$2,$3,'Ann','A','Ann A',true,null), ($4,$2,$3,'Bea','B','Bea B',true,null), ($5,$2,$3,'Cy','C','Cy C',false,now()), ($6,$7,$8,'Xo','X','Xo X',true,null)`, [ANN, T, B, BEA, CY, XO, X, BX]);
  // Ann has an authored Technician + Service rule: 70 % after a $5.00 supply charge the salon keeps
  const [pol] = await q(`insert into compensation_policies (tenant_id, technician_id, service_id) values ($1,$2,$3) returning id`, [T, ANN, SVC]);
  await q(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, supply_method, supply_value, status, effective_start, approved)
    values ($1,$2,1,'percent',70,'fixed',500,'active', now() - interval '10 days', true)`, [pol.id, T]);
  // actual payouts on paid tickets: two lines priced by Ann's rule, one by the service default, one older than 90 days,
  // one with no source recorded; the other salon's snapshot never counts
  const snap = (tenant: string, branch: string, service: string, tech: string, src: string | null, gross: number, earn: number, ago: string) => q(`insert into ticket_compensation_snapshots
    (tenant_id, branch_id, ticket_id, service_line_id, technician_id, service_id, engine_version, rule_source, gross_price_cents, tech_service_earnings_cents, snapshot_at)
    values ($1,$2,gen_random_uuid(),gen_random_uuid(),$3,$4,'v1',$5,$6,$7, now() - $8::interval)`, [tenant, branch, tech, service, src, gross, earn, ago]);
  await snap(T, B, SVC, ANN, 'Technician + Service', 5000, 3150, '2 days'); await snap(T, B, SVC, ANN, 'Technician + Service', 5000, 3150, '5 days');
  await snap(T, B, SVC, BEA, 'Service default', 4500, 1800, '3 days'); await snap(T, B, SVC, BEA, 'Service default', 4500, 1800, '120 days');
  await snap(T, B, SVC, BEA, null, 5000, 2000, '1 day');
  await snap(X, BX, SVCX, XO, 'Service default', 5000, 2000, '1 day');
}, 180_000);

describe('SERVICE PRICING 12 — Technician Compensation Preview', () => {
  it('each technician gets the money path\'s rate with its source; earnings at the current and proposed price come from the engine', async () => {
    const r = await svc.preview({ tenantId: T, branchId: B }, { serviceId: SVC, priceCents: '6000' });
    expect(r).toMatchObject({ serviceId: SVC, serviceName: 'Gel manicure', currentPriceCents: 5000, proposedPriceCents: 6000, techniciansShown: 2, techniciansTotal: 2, changesPayNow: false });
    const by = Object.fromEntries(r.technicians.map((t) => [t.name, t]));
    expect(Object.keys(by)).toEqual(['Ann A', 'Bea B']);                       // archived Cy and the other salon's Xo never
    // Ann: (5000 − 500 supply) × 70 % = 3150 → (6000 − 500) × 70 % = 3850
    expect(by['Ann A']).toMatchObject({ commissionType: 'percent', commissionValue: 70, supplyMethod: 'fixed', supplyValue: 500, source: 'Technician + Service',
      currentEarningsCents: 3150, proposedEarningsCents: 3850, changeCents: 700 });
    expect(by['Ann A'].policyId).not.toBeNull();
    // Bea: the service's own 40 % → 2000 → 2400
    expect(by['Bea B']).toMatchObject({ commissionValue: 40, source: 'Service default', policyId: null, currentEarningsCents: 2000, proposedEarningsCents: 2400, changeCents: 400 });
    // the same picked rate the money path stamps on a line (one precedence, not a second copy)
    const stamped = await resolveLineCommissionWithDefault(db, { tenantId: T, branchId: B, technicianId: BEA, serviceId: SVC, serviceCategory: 'Nails' });
    expect({ v: stamped.commissionValue, s: stamped.source }).toEqual({ v: by['Bea B'].commissionValue, s: by['Bea B'].source });
  });
  it('a service with no rate of its own falls to the salon default; no proposed price previews the current one', async () => {
    const r = await svc.preview({ tenantId: T, branchId: null }, { serviceId: SVC_NORATE });
    const bea = r.technicians.find((t) => t.technicianId === BEA)!;
    expect(bea).toMatchObject({ commissionValue: 50, source: 'Tenant default rate', currentEarningsCents: 1000, proposedEarningsCents: 1000, changeCents: 0 });
    expect(r.proposedPriceCents).toBe(2000);
  });
  it('actual payouts are grouped by the source their snapshot recorded (last 90 days, this salon only)', async () => {
    const r = await svc.preview({ tenantId: T, branchId: B }, { serviceId: SVC });
    expect(r.actual).toMatchObject({ days: 90, lines: 4, techEarningsCents: 3150 * 2 + 1800 + 2000 });
    expect(r.actual.bySource.map((s) => [s.source, s.lines, s.grossCents, s.techEarningsCents])).toEqual([
      ['Technician + Service', 2, 10000, 6300], ['Service default', 1, 4500, 1800], ['not_recorded', 1, 5000, 2000]]);
  });
  it('refuses a bad price or another salon\'s service; nothing is written', async () => {
    const before = await q(`select (select count(*) from ticket_compensation_snapshots)::int as s, (select count(*) from compensation_policy_versions)::int as v, (select price_cents from services where id = $1) as p`, [SVC]);
    expect(await code(svc.preview({ tenantId: T, branchId: B }, { serviceId: SVC, priceCents: '-5' }))).toBe('400:PRICE_INVALID');
    expect(await code(svc.preview({ tenantId: T, branchId: B }, { serviceId: SVC, priceCents: '12.5' }))).toBe('400:PRICE_INVALID');
    expect(await code(svc.preview({ tenantId: T, branchId: B }, { serviceId: SVCX }))).toBe('404:SERVICE_NOT_FOUND');
    expect(await code(svc.preview({ tenantId: T, branchId: B }, { serviceId: 'nope' }))).toBe('404:SERVICE_NOT_FOUND');
    expect(await q(`select (select count(*) from ticket_compensation_snapshots)::int as s, (select count(*) from compensation_policy_versions)::int as v, (select price_cents from services where id = $1) as p`, [SVC])).toEqual(before);
  });
});
