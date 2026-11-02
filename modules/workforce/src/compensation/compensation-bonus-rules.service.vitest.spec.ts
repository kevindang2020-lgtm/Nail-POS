import { describe, it, expect } from 'vitest';
import { InMemoryBonusRulesRepo } from './compensation-bonus-rules.repository';
import { BonusRulesService, type BonusFactsLoader } from './compensation-bonus-rules.service';

const ctx = { tenantId: 't1', userId: 'u1' };
const svc = (loader?: BonusFactsLoader) => new BonusRulesService(new InMemoryBonusRulesRepo(), loader);
const prodFacts: BonusFactsLoader = async () => ({ serviceProductionCents: 520000 });

describe('BonusRulesService', () => {
  it('creates and lists rules', async () => {
    const s = svc();
    await s.create(ctx, { metric: 'service_production', target: 500000, amountCents: 20000, label: 'Prod' });
    expect(await s.list(ctx)).toHaveLength(1);
  });

  it('validates the rule', async () => {
    const s = svc();
    await expect(s.create(ctx, { metric: 'bogus', target: 1, amountCents: 1 })).rejects.toThrow(/metric/);
    await expect(s.create(ctx, { metric: 'retail_sales', target: -1, amountCents: 1 })).rejects.toThrow(/target/);
    await expect(s.create(ctx, { metric: 'retail_sales', target: 1, amountCents: -1 })).rejects.toThrow(/amount/);
  });

  it('archives (removed from active) and 404s on unknown', async () => {
    const s = svc();
    const r = await s.create(ctx, { metric: 'service_production', target: 1, amountCents: 1 });
    await s.archive(ctx, r.id);
    expect(await s.list(ctx)).toHaveLength(0);
    await expect(s.archive(ctx, 'x')).rejects.toThrow(/not found/i);
  });

  it('previews for a technician: production qualifies from real facts; only applicable rules; un-wired metric reads 0', async () => {
    const s = svc(prodFacts);
    await s.create(ctx, { metric: 'service_production', target: 500000, amountCents: 20000, label: 'Prod' }); // salon-wide
    await s.create(ctx, { metric: 'retail_sales', target: 100000, amountCents: 5000, label: 'Retail' });      // fact not wired → 0
    await s.create(ctx, { technicianId: 'other', metric: 'service_production', target: 1, amountCents: 999, label: 'OtherTech' }); // filtered out
    const p = await s.previewForTechnician(ctx, { technicianId: 'tech1', fromIso: 'a', toIso: 'b' });
    expect(p.bonuses).toHaveLength(2); // the two applicable (salon-wide) rules, not the other-tech rule
    expect(p.bonuses.find((b) => b.label === 'Prod')).toMatchObject({ qualified: true, earnedCents: 20000 });
    expect(p.bonuses.find((b) => b.label === 'Retail')).toMatchObject({ qualified: false, earnedCents: 0 });
    expect(p.totalEarnedCents).toBe(20000);
    expect(p.facts.serviceProductionCents).toBe(520000);
  });

  it('preview requires a technicianId', async () => {
    await expect(svc().previewForTechnician(ctx, { technicianId: '', fromIso: 'a', toIso: 'b' })).rejects.toThrow(/technicianId/);
  });

  it('approves a bonus as an approved "bonus" adjustment (the only path to payable)', async () => {
    const appended: any[] = [];
    const s = new BonusRulesService(new InMemoryBonusRulesRepo(), undefined, async (_c, entry) => { appended.push(entry); return true; });
    const res = await s.approveBonus(ctx, { technicianId: 'tech1', periodId: 'p1', amountCents: 20000, label: 'Prod bonus' });
    expect(res).toMatchObject({ ok: true, status: 'approved', amountCents: 20000 });
    expect(appended[0]).toMatchObject({ technicianId: 'tech1', periodId: 'p1', category: 'bonus', amountCents: 20000, status: 'approved' });
  });

  it('rejects a non-positive bonus and a missing period', async () => {
    const s = new BonusRulesService(new InMemoryBonusRulesRepo(), undefined, async () => true);
    await expect(s.approveBonus(ctx, { technicianId: 'tech1', periodId: 'p1', amountCents: 0 })).rejects.toThrow(/positive/);
    await expect(s.approveBonus(ctx, { technicianId: 'tech1', amountCents: 20000 })).rejects.toThrow(/pay period/i);
  });

  it('reports 503 when approval is not wired', async () => {
    await expect(svc().approveBonus(ctx, { technicianId: 'tech1', periodId: 'p1', amountCents: 20000 })).rejects.toThrow(/unavailable/);
  });

  it('reviewPeriod aggregates qualified bonuses across the period\'s technicians', async () => {
    const perTechFacts: BonusFactsLoader = async (_c, techId) => ({ serviceProductionCents: techId === 'tech1' ? 20000 : 5000 });
    const resolver = async () => ({ fromIso: '2026-01-01T00:00:00.000Z', toIso: '2026-01-31T23:59:59.999Z', technicianIds: ['tech1', 'tech2'] });
    const s = new BonusRulesService(new InMemoryBonusRulesRepo(), perTechFacts, undefined, resolver);
    await s.create(ctx, { metric: 'service_production', target: 10000, amountCents: 5000, label: 'Prod' }); // null tech = all
    const review = await s.reviewPeriod(ctx, 'p1');
    expect(review.technicians).toHaveLength(1); // only tech1 (20000 >= 10000) qualifies; tech2 (5000) doesn't
    expect(review.technicians[0]).toMatchObject({ technicianId: 'tech1', totalEarnedCents: 5000 });
    expect(review.grandTotalCents).toBe(5000);
  });

  it('reviewPeriod 503s without a resolver, 404s an unknown period, requires periodId', async () => {
    await expect(svc(prodFacts).reviewPeriod(ctx, 'p1')).rejects.toThrow(/unavailable/i);
    const s = new BonusRulesService(new InMemoryBonusRulesRepo(), prodFacts, undefined, async () => null);
    await expect(s.reviewPeriod(ctx, 'p1')).rejects.toThrow(/not found/i);
    await expect(s.reviewPeriod(ctx, '')).rejects.toThrow(/periodId/);
  });
});
