// ai-marketing.vitest.spec.ts — unit coverage for the AI Marketing read layer. Exercises the PURE builders
// and the service against the in-memory adapter, so the logic is genuinely tested without a live DB.
import { describe, it, expect } from 'vitest';
import {
  buildSummary,
  buildRecommendations,
  MIN_ELIGIBLE_FOR_RECOMMENDATION,
  type MarketingReadModel,
  type AiMarketingContext,
} from './ai-marketing.dto';
import { InMemoryAiMarketingRepository } from './ai-marketing.repository';
import { AiMarketingService, AiMarketingForbiddenError, AiMarketingValidationError } from './ai-marketing.service';

function model(over: Partial<MarketingReadModel> = {}): MarketingReadModel {
  return {
    campaignCounts: { active: 2, scheduled: 1, draft: 3, completed: 5 },
    campaignTotals: { sent: 1000, bookings: 40, revenueCents: 480000, costCents: 8000 },
    consent: { optedInSms: 300, optedInEmail: 220, suppressed: 12 },
    audiences: {
      rebookingDue: { eligible: 60, suppressed: 8 },
      inactive90: { eligible: 45, suppressed: 5 },
      birthdayThisMonth: { eligible: 10, suppressed: 2 },
      lastMinuteInterest: { eligible: 0, suppressed: 0 },
    },
    ...over,
  };
}

function ctx(over: Partial<AiMarketingContext> = {}): AiMarketingContext {
  return { tenantId: 'tenantA', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['marketing.view'], ...over };
}

describe('buildSummary', () => {
  it('computes cost-per-booking from real totals', () => {
    const s = buildSummary(model(), '2026-07-07T00:00:00.000Z');
    expect(s.bookingsAttributed).toBe(40);
    expect(s.revenueAssociatedCents).toBe(480000);
    expect(s.costPerBookingCents).toBe(200); // 8000 / 40
  });

  it('returns null cost-per-booking when there are zero bookings (never fabricates a divide-by-zero)', () => {
    const s = buildSummary(model({ campaignTotals: { sent: 10, bookings: 0, revenueCents: 0, costCents: 500 } }), 'now');
    expect(s.costPerBookingCents).toBeNull();
  });
});

describe('buildRecommendations', () => {
  it('surfaces rebooking + inactive when above the floor, and never fabricates an offer', () => {
    const recs = buildRecommendations(model(), 'tenant');
    const types = recs.map((r) => r.type);
    expect(types).toContain('rebooking');
    expect(types).toContain('inactive_customer');
    for (const r of recs) {
      expect(r.offer).toBeNull(); // AI invents no offer/discount/price/expiration — ever
      expect(r.audienceEstimate).toBeGreaterThanOrEqual(MIN_ELIGIBLE_FOR_RECOMMENDATION);
    }
    const inactive = recs.find((r) => r.type === 'inactive_customer')!;
    expect(inactive.requiresOffer).toBe(true); // win-back needs a human-approved incentive
  });

  it('suppresses recommendations below the eligibility floor', () => {
    const recs = buildRecommendations(
      model({
        audiences: {
          rebookingDue: { eligible: 1, suppressed: 0 },
          inactive90: { eligible: 0, suppressed: 0 },
          birthdayThisMonth: { eligible: 2, suppressed: 0 },
          lastMinuteInterest: { eligible: 0, suppressed: 0 },
        },
      }),
      'tenant',
    );
    expect(recs).toHaveLength(0);
  });

  it('evidence text references only real counts', () => {
    const recs = buildRecommendations(model(), 'branch');
    const rebook = recs.find((r) => r.type === 'rebooking')!;
    expect(rebook.evidence).toContain('60');
    expect(rebook.branchScope).toBe('branch');
  });
});

describe('AiMarketingService', () => {
  it('returns composed state for an authorized caller', async () => {
    const repo = new InMemoryAiMarketingRepository({ tenantA: model() });
    const svc = new AiMarketingService(repo);
    const state = await svc.getState(ctx());
    expect(state.summary.activeCampaigns).toBe(2);
    expect(state.recommendations.length).toBeGreaterThan(0);
    expect(state.freshness.source).toBe('live_read_model');
  });

  it('is tenant-isolated: tenant B never sees tenant A data', async () => {
    const repo = new InMemoryAiMarketingRepository({ tenantA: model() });
    const svc = new AiMarketingService(repo);
    const stateB = await svc.getState(ctx({ tenantId: 'tenantB' }));
    // tenant B has no seed → honest empty model, zero recommendations, zero campaigns.
    expect(stateB.summary.activeCampaigns).toBe(0);
    expect(stateB.summary.messagesSent).toBe(0);
    expect(stateB.recommendations).toHaveLength(0);
  });

  it('fails closed without permission', async () => {
    const repo = new InMemoryAiMarketingRepository({ tenantA: model() });
    const svc = new AiMarketingService(repo);
    await expect(svc.getState(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiMarketingForbiddenError);
  });

  it('fails closed with no tenant context', async () => {
    const repo = new InMemoryAiMarketingRepository({});
    const svc = new AiMarketingService(repo);
    await expect(svc.getState(ctx({ tenantId: '' }))).rejects.toBeInstanceOf(AiMarketingValidationError);
  });
});
