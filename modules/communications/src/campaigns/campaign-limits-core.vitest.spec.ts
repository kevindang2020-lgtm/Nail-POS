// campaign-limits-core.vitest.spec — the platform campaign limits, now ENFORCED. Pure rules, exact assertions.
import { describe, it, expect } from 'vitest';
import { checkCampaignLimits, inQuietHours, localHour, type CampaignLimits } from './campaign-limits-core';

const NY = 'America/New_York';
const none: CampaignLimits = { maxSendsPerDay: null, maxCampaignsPerDay: null, quietHoursStart: null, quietHoursEnd: null, minHoursBetween: null };
const facts = (over = {}) => ({ campaignsStartedToday: 0, sendsStartedToday: 0, lastStartedAt: null, audienceSize: 100, ...over });
// 2026-09-21 is EDT (UTC-4). 15:00Z = 11:00 local, 03:00Z = 23:00 local the previous day.
const at = (iso: string) => new Date(iso);

describe('quiet hours — including a window that wraps midnight', () => {
  it('a 21→8 window covers late evening', () => expect(inQuietHours(23, 21, 8)).toBe(true));
  it('…and early morning', () => expect(inQuietHours(5, 21, 8)).toBe(true));
  it('…but not midday', () => expect(inQuietHours(12, 21, 8)).toBe(false));
  it('the end hour itself is OUTSIDE the window — 8:00 may send', () => expect(inQuietHours(8, 21, 8)).toBe(false));
  it('the start hour itself is INSIDE — 21:00 may not', () => expect(inQuietHours(21, 21, 8)).toBe(true));
  it('a non-wrapping window (1→5) works too', () => { expect(inQuietHours(3, 1, 5)).toBe(true); expect(inQuietHours(6, 1, 5)).toBe(false); });
  it('start === end means NO window, not a 24-hour one', () => expect(inQuietHours(3, 9, 9)).toBe(false));
  it('unset means no window', () => expect(inQuietHours(3, null, 8)).toBe(false));
});

describe('quiet hours are judged in the SALON\'S timezone, not the server\'s', () => {
  it('03:00Z is 23:00 in New York', () => expect(localHour(at('2026-09-21T03:00:00Z'), NY)).toBe(23));
  it('the same instant is 20:00 in Los Angeles — outside a 21→8 window there', () =>
    expect(localHour(at('2026-09-21T03:00:00Z'), 'America/Los_Angeles')).toBe(20));

  it('a campaign at 11pm salon time is BLOCKED', () => {
    const v = checkCampaignLimits({ ...none, quietHoursStart: 21, quietHoursEnd: 8 }, facts(), at('2026-09-21T03:00:00Z'), NY);
    expect(v.ok).toBe(false);
    expect(v.ok || v.code).toBe('quiet_hours');
  });

  it('the SAME instant is allowed for a salon in LA, where it is only 8pm', () => {
    const v = checkCampaignLimits({ ...none, quietHoursStart: 21, quietHoursEnd: 8 }, facts(), at('2026-09-21T03:00:00Z'), 'America/Los_Angeles');
    expect(v.ok).toBe(true);
  });

  it('the refusal tells the owner when they CAN send', () => {
    const v = checkCampaignLimits({ ...none, quietHoursStart: 21, quietHoursEnd: 8 }, facts(), at('2026-09-21T03:00:00Z'), NY);
    expect(v.ok || v.message).toMatch(/after 08:00/);
  });
});

describe('daily caps', () => {
  const noon = at('2026-09-21T16:00:00Z');
  it('under the campaign cap is allowed', () =>
    expect(checkCampaignLimits({ ...none, maxCampaignsPerDay: 3 }, facts({ campaignsStartedToday: 2 }), noon, NY).ok).toBe(true));
  it('AT the campaign cap is blocked — the fourth of three', () => {
    const v = checkCampaignLimits({ ...none, maxCampaignsPerDay: 3 }, facts({ campaignsStartedToday: 3 }), noon, NY);
    expect(v.ok || v.code).toBe('max_campaigns_per_day');
  });

  it('sends are checked INCLUDING this campaign\'s audience, before any message goes out', () => {
    const v = checkCampaignLimits({ ...none, maxSendsPerDay: 5000 }, facts({ sendsStartedToday: 4950, audienceSize: 100 }), noon, NY);
    expect(v.ok || v.code).toBe('max_sends_per_day');
  });
  it('exactly reaching the send cap is allowed', () =>
    expect(checkCampaignLimits({ ...none, maxSendsPerDay: 5000 }, facts({ sendsStartedToday: 4900, audienceSize: 100 }), noon, NY).ok).toBe(true));
  it('the refusal says how many sends remain', () => {
    const v = checkCampaignLimits({ ...none, maxSendsPerDay: 5000 }, facts({ sendsStartedToday: 4950, audienceSize: 100 }), noon, NY);
    expect(v.ok || v.message).toMatch(/only 50 of today's 5000 remain/);
  });
});

describe('minimum spacing between campaigns', () => {
  const now = at('2026-09-21T16:00:00Z');
  it('too soon after the last one is blocked', () => {
    const v = checkCampaignLimits({ ...none, minHoursBetween: 4 }, facts({ lastStartedAt: at('2026-09-21T14:00:00Z') }), now, NY);
    expect(v.ok || v.code).toBe('min_hours_between');
  });
  it('long enough after is allowed', () =>
    expect(checkCampaignLimits({ ...none, minHoursBetween: 4 }, facts({ lastStartedAt: at('2026-09-21T11:00:00Z') }), now, NY).ok).toBe(true));
  it('the first campaign ever is never blocked by spacing', () =>
    expect(checkCampaignLimits({ ...none, minHoursBetween: 4 }, facts({ lastStartedAt: null }), now, NY).ok).toBe(true));
});

describe('absent limits', () => {
  it('no limits row means nothing is enforced', () => expect(checkCampaignLimits(null, facts(), new Date(), NY).ok).toBe(true));
  it('all-null fields mean nothing is enforced', () => expect(checkCampaignLimits(none, facts({ campaignsStartedToday: 999 }), new Date(), NY).ok).toBe(true));
});
