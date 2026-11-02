import { describe, it, expect } from 'vitest';
import {
  computeFinalPriceCents, savingsCents, nextStatus, isBookable, initialStatus, validateTechDealAgainstSettings,
  type DealSettings, type DealStatus, type DealAction,
} from './deals.core';

describe('computeFinalPriceCents — integer cents, never negative', () => {
  it('percent discount rounds to whole cents', () => {
    expect(computeFinalPriceCents(4900, 'percent', 20)).toBe(3920);
    expect(computeFinalPriceCents(4995, 'percent', 33)).toBe(Math.round(4995 * 0.67)); // 3347
  });
  it('fixed discount subtracts cents', () => {
    expect(computeFinalPriceCents(4900, 'fixed', null, 1000)).toBe(3900);
  });
  it('never goes negative — fixed discount larger than price clamps to 0', () => {
    expect(computeFinalPriceCents(3000, 'fixed', null, 5000)).toBe(0);
  });
  it('100% percent → 0; 0% → unchanged; out-of-range percent is clamped', () => {
    expect(computeFinalPriceCents(4900, 'percent', 100)).toBe(0);
    expect(computeFinalPriceCents(4900, 'percent', 0)).toBe(4900);
    expect(computeFinalPriceCents(4900, 'percent', 150)).toBe(0);   // clamped to 100
    expect(computeFinalPriceCents(4900, 'percent', -10)).toBe(4900); // clamped to 0
  });
  it('savings are original minus final, never negative', () => {
    expect(savingsCents(4900, 'percent', 20)).toBe(980);
    expect(savingsCents(3000, 'fixed', null, 5000)).toBe(3000);
  });
});

describe('nextStatus — legal transitions only', () => {
  const legal: [DealStatus, DealAction, DealStatus][] = [
    ['draft', 'submit', 'pending_approval'],
    ['pending_approval', 'approve', 'approved'],
    ['pending_approval', 'reject', 'rejected'],
    ['pending_approval', 'request_changes', 'draft'],
    ['approved', 'publish', 'active'],
    ['paused', 'publish', 'active'],
    ['active', 'pause', 'paused'],
    ['paused', 'resume', 'active'],
    ['active', 'mark_sold_out', 'sold_out'],
    ['active', 'expire', 'expired'],
    ['active', 'cancel', 'canceled'],
    ['expired', 'archive', 'archived'],
  ];
  it.each(legal)('%s --%s--> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  const illegal: [DealStatus, DealAction][] = [
    ['draft', 'approve'],         // can't approve a draft (must be submitted first)
    ['active', 'submit'],         // can't re-submit a live deal
    ['rejected', 'publish'],      // rejected is terminal until archived
    ['archived', 'resume'],       // archived is terminal
    ['sold_out', 'publish'],      // sold out can't be republished
    ['draft', 'pause'],           // nothing to pause
  ];
  it.each(illegal)('%s --%s--> ILLEGAL (null)', (from, action) => {
    expect(nextStatus(from, action)).toBeNull();
  });
});

describe('isBookable / initialStatus', () => {
  it('only active deals are bookable', () => {
    expect(isBookable('active')).toBe(true);
    for (const s of ['draft', 'pending_approval', 'approved', 'paused', 'sold_out', 'expired', 'rejected', 'canceled', 'archived'] as DealStatus[]) {
      expect(isBookable(s)).toBe(false);
    }
  });
  it('salon deals start as draft; tech deals route by policy', () => {
    expect(initialStatus('salon', 'on_auto')).toBe('draft');
    expect(initialStatus('technician', 'on_with_approval')).toBe('pending_approval');
    expect(initialStatus('technician', 'on_auto')).toBe('active');   // Phase 5, bug 18: auto means live (was parked at 'approved')
    expect(initialStatus('technician', 'off')).toBe('pending_approval'); // policy gate happens in validation, not here
  });
});

describe('validateTechDealAgainstSettings — backend enforcement of salon limits', () => {
  const base: DealSettings = {
    allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30, maxFixedDiscountCents: 2000,
    minServicePriceCents: 2000, maxActiveDealsPerTech: 3, maxRedemptionsCap: 100, maxCampaignDurationDays: 30,
    allowedNewCustomer: true, allowedExistingCustomer: true,
  };

  it('off policy blocks everything', () => {
    const v = validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 10 }, { ...base, allowTechnicianDeals: 'off' });
    expect(v.length).toBe(1);
    expect(v[0]).toMatch(/turned off/i);
  });
  it('within all limits → no violations', () => {
    expect(validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 20, originalPriceCents: 4900, maxRedemptions: 50, activeDealCountForTech: 1 }, base)).toEqual([]);
  });
  it('percent over cap', () => {
    expect(validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 40, originalPriceCents: 4900 }, base)).toContainEqual(expect.stringMatching(/30% cap/));
  });
  it('fixed discount over cap', () => {
    expect(validateTechDealAgainstSettings({ discountType: 'fixed', discountCents: 3000, originalPriceCents: 4900 }, base)).toContainEqual(expect.stringMatching(/fixed discount/i));
  });
  it('service price below salon minimum', () => {
    expect(validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 10, originalPriceCents: 1500 }, base)).toContainEqual(expect.stringMatching(/below the minimum/i));
  });
  it('active-deal cap reached', () => {
    expect(validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 10, originalPriceCents: 4900, activeDealCountForTech: 3 }, base)).toContainEqual(expect.stringMatching(/maximum number of active deals/i));
  });
  it('campaign longer than max duration', () => {
    const v = validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 10, originalPriceCents: 4900, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-03-01T00:00:00Z' }, base);
    expect(v).toContainEqual(expect.stringMatching(/30-day maximum/));
  });
  it('accumulates multiple violations at once', () => {
    const v = validateTechDealAgainstSettings({ discountType: 'percent', discountPercent: 90, originalPriceCents: 500, activeDealCountForTech: 5 }, base);
    expect(v.length).toBeGreaterThanOrEqual(3);
  });
});
