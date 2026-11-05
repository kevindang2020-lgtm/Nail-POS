// ai-marketing-results.vitest.spec.ts — per-campaign results composition + service reuse of detail().
import { describe, it, expect, vi } from 'vitest';
import { buildResults, RESULTS_DISCLAIMER } from './ai-marketing-results';
import { AiMarketingCampaignService, type CampaignOrchestrationPort } from './ai-marketing-campaign.service';
import { InMemoryCampaignConversions } from './ai-marketing-conversions';
import type { AiMarketingContext } from './ai-marketing.dto';

function campaignRow(over: Record<string, unknown> = {}): any {
  return {
    id: 'camp1', tenantId: 'tenantA', branchId: null, name: 'Gel rebooking', offer: null, channel: 'sms',
    audienceLabel: 'Rebooking due', audienceSize: 800, status: 'completed', scheduledAt: null,
    sentCount: 780, openCount: 0, clickCount: 96, replyCount: 0, bookingCount: 41,
    revenueCents: 348000, costCents: 3900, createdAt: 'x', updatedAt: 'y', ...over,
  };
}

describe('buildResults', () => {
  it('computes funnel, rates, and cost/revenue with associated-revenue labeling', () => {
    const r = buildResults(campaignRow(), null, '2026-07-07T00:00:00Z');
    expect(r.funnel.sent).toBe(780);
    expect(r.funnel.booked).toBe(41);
    expect(r.rates.clickRate).toBeCloseTo(96 / 780, 4);
    expect(r.rates.bookingRate).toBeCloseTo(41 / 780, 4);
    expect(r.associatedRevenueCents).toBe(348000);
    expect(r.costPerBookingCents).toBe(Math.round(3900 / 41));
    expect(r.disclaimer).toBe(RESULTS_DISCLAIMER);
  });

  it('returns null rates and null cost/booking when denominators are zero (no fabricated ratios)', () => {
    const r = buildResults(campaignRow({ sentCount: 0, clickCount: 0, bookingCount: 0 }), null, 'now');
    expect(r.rates.clickRate).toBeNull();
    expect(r.rates.bookingRate).toBeNull();
    expect(r.costPerBookingCents).toBeNull();
    expect(r.revenuePerSentCents).toBeNull();
  });

  it('never labels revenue as causal', () => {
    const r = buildResults(campaignRow(), null, 'now');
    expect(r.disclaimer.toLowerCase()).toContain('correlation');
    expect(r.disclaimer.toLowerCase()).not.toContain('caused');
  });

  it('uses attributed booked count over the (never-incremented) campaign counter when provided', () => {
    // campaign row counter says 0 booked; real attribution says 12.
    const r = buildResults(campaignRow({ bookingCount: 0, sentCount: 300, costCents: 6000 }), null, 'now', 12);
    expect(r.funnel.booked).toBe(12);
    expect(r.rates.bookingRate).toBeCloseTo(12 / 300, 4);
    expect(r.costPerBookingCents).toBe(Math.round(6000 / 12));
  });
});

describe('AiMarketingCampaignService.getResults', () => {
  function port(detailRow: any): CampaignOrchestrationPort {
    return {
      create: vi.fn(), update: vi.fn(), transition: vi.fn(),
      detail: vi.fn(async (_c, id) => ({ ...detailRow, id })),
    } as any;
  }
  const ctx = (): AiMarketingContext => ({ tenantId: 'tenantA', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['marketing.view'] });

  it('reuses detail() and composes results', async () => {
    const svc = new AiMarketingCampaignService(port(campaignRow()));
    const res = await svc.getResults(ctx(), 'camp1');
    expect(res.campaignId).toBe('camp1');
    expect(res.funnel.booked).toBe(41);
    expect(res.associatedRevenueCents).toBe(348000);
  });

  it('applies real conversion attribution to booked when a conversions source is wired', async () => {
    const conv = new InMemoryCampaignConversions();
    conv.seed('tenantA', 'camp1', 9);
    const svc = new AiMarketingCampaignService(port(campaignRow({ bookingCount: 0, sentCount: 200 })), undefined, conv);
    const res = await svc.getResults(ctx(), 'camp1');
    expect(res.funnel.booked).toBe(9); // from conversion events, not the zero counter
  });
});
