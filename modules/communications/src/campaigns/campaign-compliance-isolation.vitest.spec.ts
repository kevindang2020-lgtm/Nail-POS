// campaign-compliance-isolation.vitest.spec.ts — 🔴 a real cross-tenant leak, now closed.
//
// ── What was wrong ──
//
// `GET /pos/campaigns/compliance/flags` and `/compliance/alerts` sit behind `TenantAuthGuard` — any salon's staff
// can call them. They reached `listFlags(...)`, whose SQL was:
//
//     SELECT * FROM campaign_compliance_flags WHERE 1=1 ${status} ORDER BY created_at DESC LIMIT 200
//
// **There was no tenant filter at all.** `campaign_compliance_flags` has a `tenant_id` column, and every salon's
// flags live in that one table. So a manager at Salon A could read **every other salon's compliance flags** —
// their campaign names, their spam complaints, their opt-out rates.
//
// And `resolveFlag` updated `WHERE id = ${id}` with no tenant check, so a manager at Salon A could **resolve
// Salon B's flag** — a cross-tenant WRITE.
//
// ── Why nothing caught it ──
//
// The tenant-isolation guard derives its table set from the generated Kysely types, and
// `campaign_compliance_flags` is one of 212 tenant-owned tables missing from them. The table was invisible, so the
// query was invisible. It only surfaced when the guard was pointed at the migrations instead.
import { describe, it, expect, beforeEach } from 'vitest';
import { CampaignComplianceService } from './campaign-compliance.service';
import { InMemoryComplianceRepo } from './campaign-compliance.repository';

const SALON_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SALON_B = 'bbbbbbbb-0000-0000-0000-000000000002';

let svc: CampaignComplianceService;
let repo: InMemoryComplianceRepo;

beforeEach(async () => {
  repo = new InMemoryComplianceRepo();
  svc = new CampaignComplianceService(repo);

  await svc.raiseFlag({ subjectType: 'tenant_campaign', subjectId: 'a-campaign', tenantId: SALON_A, flagType: 'high_opt_out' });
  await svc.raiseFlag({ subjectType: 'tenant_campaign', subjectId: 'b-campaign', tenantId: SALON_B, flagType: 'spam_complaints' });
});

describe('a salon sees ONLY its own compliance flags', () => {
  it('Salon A sees its flag and NOT Salon B\'s', async () => {
    const flags = await svc.listFlags(SALON_A);
    expect(flags.map((f) => f.subjectId)).toEqual(['a-campaign']);
    expect(flags.map((f) => f.subjectId)).not.toContain('b-campaign');
  });

  it("Salon B sees its own, and not Salon A's", async () => {
    const flags = await svc.listFlags(SALON_B);
    expect(flags.map((f) => f.subjectId)).toEqual(['b-campaign']);
  });

  it('the ALERTS summary is scoped too — it was the same unscoped read', async () => {
    const a = await svc.alertsSummary(SALON_A);
    const b = await svc.alertsSummary(SALON_B);
    // each salon sees exactly one flag: its own. Before the fix both saw two.
    expect(a.allCompliant).toBe(false);
    expect(b.allCompliant).toBe(false);
    expect(JSON.stringify(a)).not.toContain('b-campaign');
    expect(JSON.stringify(b)).not.toContain('a-campaign');
  });

  it('NO TENANT means NOTHING, not everything — a scoping bug must fail closed', async () => {
    // The dangerous failure mode is a missing tenant silently becoming "show all".
    expect(await svc.listFlags('')).toEqual([]);
    expect((await svc.alertsSummary('')).allCompliant).toBe(true);   // nothing to report, not everyone's flags
  });
});

describe('a salon cannot RESOLVE another salon\'s flag', () => {
  it("Salon A cannot resolve Salon B's flag, even knowing its id", async () => {
    const bFlags = await svc.listFlags(SALON_B);
    const bFlagId = bFlags[0].id;

    const attempt = await svc.resolveFlag(bFlagId, SALON_A, 'cleared');

    expect(attempt.ok).toBe(false);
    // …and B's flag is untouched
    const stillOpen = await svc.listFlags(SALON_B);
    expect(stillOpen[0].status).toBe('open');
  });

  it('a salon CAN resolve its own', async () => {
    const mine = await svc.listFlags(SALON_A);
    const r = await svc.resolveFlag(mine[0].id, SALON_A, 'cleared');
    expect(r.ok).toBe(true);
    expect((await svc.listFlags(SALON_A))[0].status).toBe('cleared');
  });

  it('the refusal is indistinguishable from "no such flag" — no probing for other salons\' ids', async () => {
    const bFlagId = (await svc.listFlags(SALON_B))[0].id;
    const crossTenant = await svc.resolveFlag(bFlagId, SALON_A, 'cleared');
    const madeUp = await svc.resolveFlag('does-not-exist', SALON_A, 'cleared');
    expect(crossTenant.errors).toEqual(madeUp.errors);
  });
});

// ── The same leak, in campaign DELIVERY ──
//
// `GET /pos/campaigns/delivery-failures` and `/delivery-summary` (TenantAuthGuard) reached queries with **no
// tenant filter at all** — one of them had no WHERE clause whatsoever:
//
//     SELECT sum(attempted), sum(delivered), sum(opted_out) FROM campaign_delivery_rollups
//
// So every salon's delivery totals were summed together and shown to whichever salon asked.
describe('campaign delivery is tenant-scoped too', () => {
  it('a salon sees only ITS delivery failures', async () => {
    const { CampaignDeliveryService } = await import('./campaign-delivery.service');
    const { InMemoryDeliveryRepo } = await import('./campaign-delivery.repository');

    const repo = new InMemoryDeliveryRepo({ failures: [{ category: 'opted_out', count: 2 }] });
    const svc = new CampaignDeliveryService(repo);
    const T = InMemoryDeliveryRepo.SEED_TENANT;

    expect(await svc.listFailures(T, {})).toHaveLength(2);
    // another salon sees NOTHING of theirs
    expect(await svc.listFailures('some-other-salon', {})).toHaveLength(0);
  });

  it('rollup totals do not sum every salon together', async () => {
    const { CampaignDeliveryService } = await import('./campaign-delivery.service');
    const { InMemoryDeliveryRepo } = await import('./campaign-delivery.repository');

    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo({ totals: { attempted: 1000, delivered: 974, optedOut: 8 } }));
    expect(await svc.deliveryKpis(InMemoryDeliveryRepo.SEED_TENANT)).toEqual({ deliveryRate: 97.4, optOutRate: 0.8 });
    // a different salon gets its own (empty) numbers, not everyone's
    expect(await svc.deliveryKpis('some-other-salon')).toEqual({ deliveryRate: null, optOutRate: null });
  });

  it('NO TENANT means NOTHING, not everything', async () => {
    const { CampaignDeliveryService } = await import('./campaign-delivery.service');
    const { InMemoryDeliveryRepo } = await import('./campaign-delivery.repository');
    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo({ failures: [{ category: 'opted_out', count: 2 }] }));
    expect(await svc.listFailures('', {})).toEqual([]);
  });
});
