import { describe, it, expect } from 'vitest';
import { loyaltySummary, serviceProgress, buildCustomerHome } from './customer-core';
import type { LoyaltyTierConfig } from './customer.dto';

const tiers: LoyaltyTierConfig[] = [
  { tier: 'Regular', threshold: 0 }, { tier: 'Silver', threshold: 100 }, { tier: 'Gold', threshold: 300 }, { tier: 'VIP', threshold: 600 },
];

describe('loyaltySummary', () => {
  it('mid-tier: Silver with progress toward Gold', () => {
    expect(loyaltySummary(150, tiers)).toEqual({ points: 150, tier: 'Silver', nextTier: 'Gold', pointsToNextTier: 150, progressPercent: 25 });
  });
  it('base tier: Regular toward Silver', () => {
    expect(loyaltySummary(50, tiers)).toEqual({ points: 50, tier: 'Regular', nextTier: 'Silver', pointsToNextTier: 50, progressPercent: 50 });
  });
  it('top tier: VIP, no next, 100%', () => {
    expect(loyaltySummary(700, tiers)).toEqual({ points: 700, tier: 'VIP', nextTier: null, pointsToNextTier: 0, progressPercent: 100 });
  });
  it('empty config → Regular 100%', () => {
    expect(loyaltySummary(10, []).tier).toBe('Regular');
  });
});

describe('serviceProgress', () => {
  const t = '2026-06-07T05:00:00.000Z';
  it('half-way through a 60-min service', () => {
    const p = serviceProgress(t, 60, Date.parse(t) + 30 * 60 * 1000);
    expect(p.elapsedSeconds).toBe(1800);
    expect(p.progressPercent).toBe(50);
    expect(p.estimatedFinishTime).toBe(new Date(Date.parse(t) + 3600 * 1000).toISOString());
  });
  it('caps progress at 100 when over duration', () => {
    expect(serviceProgress(t, 10, Date.parse(t) + 60 * 60 * 1000).progressPercent).toBe(100);
  });
  it('invalid start → zeros/null', () => {
    expect(serviceProgress('nope', 60)).toEqual({ elapsedSeconds: 0, progressPercent: 0, estimatedFinishTime: null });
  });
});

describe('buildCustomerHome', () => {
  const t = '2026-06-07T05:00:00.000Z';
  it('composes loyalty + active-service progress + passthroughs', () => {
    const home = buildCustomerHome({
      customerName: 'Jamie R', points: 320, tiers, recentVisitsCount: 7,
      activeService: { ticketId: 'k1', serviceName: 'Gel Mani', status: 'serving', startedAt: t, durationMinutes: 40 },
      nextAppointment: { appointmentId: 'a1', serviceName: 'Pedi', startTime: '2026-06-08T15:00:00.000Z', status: 'confirmed' },
      nowMs: Date.parse(t) + 20 * 60 * 1000,
    });
    expect(home.loyalty.tier).toBe('Gold');
    expect(home.activeService?.progressPercent).toBe(50);
    expect(home.activeService?.elapsedSeconds).toBe(1200);
    expect(home.nextAppointment?.serviceName).toBe('Pedi');
    expect(home.recentVisitsCount).toBe(7);
  });
  it('no active service → omitted', () => {
    const home = buildCustomerHome({ customerName: 'A', points: 0, tiers, recentVisitsCount: 0 });
    expect(home.activeService).toBeUndefined();
    expect(home.loyalty.tier).toBe('Regular');
  });
});
