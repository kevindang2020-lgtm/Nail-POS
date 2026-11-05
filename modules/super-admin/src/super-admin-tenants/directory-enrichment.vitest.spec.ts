import { describe, it, expect } from 'vitest';
import { buildOnboardingPipeline, buildUpcomingRenewals } from './directory-enrichment';

const NOW = new Date('2026-06-29T12:00:00Z').getTime();
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('onboarding pipeline mapper (§17)', () => {
  it('is honestly unavailable when the source is null (not a fabricated funnel)', () => {
    const p = buildOnboardingPipeline(null);
    expect(p.available).toBe(false);
    expect(p.stages).toHaveLength(0);
  });

  it('builds a monotonic funnel — each later stage ≤ the previous', () => {
    const apps = [
      { status: 'new' }, { status: 'new' }, { status: 'waiting_documents' },
      { status: 'reviewing' }, { status: 'qualified' }, { status: 'approved' }, { status: 'converted' },
    ];
    const p = buildOnboardingPipeline(apps);
    expect(p.available).toBe(true);
    const counts = p.stages.map((s) => s.count);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(p.stages.find((s) => s.key === 'received')!.count).toBe(7);
    expect(p.stages.find((s) => s.key === 'setup_in_progress')!.count).toBe(1); // only the converted one
  });

  it('rejected/archived count as received but never advance the funnel', () => {
    const apps = [{ status: 'rejected' }, { status: 'archived' }, { status: 'approved' }];
    const p = buildOnboardingPipeline(apps);
    expect(p.stages.find((s) => s.key === 'received')!.count).toBe(3);
    expect(p.stages.find((s) => s.key === 'approved')!.count).toBe(1);
  });

  it('conversion rate is calculated (approved-or-beyond ÷ received), not hardcoded', () => {
    const apps = [{ status: 'new' }, { status: 'new' }, { status: 'approved' }, { status: 'converted' }];
    const p = buildOnboardingPipeline(apps);
    expect(p.conversionRatePct).toBe(50); // 2 of 4 reached approved+
  });
});

describe('upcoming renewals mapper (§21)', () => {
  it('is honestly unavailable when the source is null', () => {
    expect(buildUpcomingRenewals(null).available).toBe(false);
  });

  it('computes days-remaining, sorts ascending, and flags warnings by billing window', () => {
    const subs = [
      { tenantId: 'a', tenantName: 'A', plan: 'Pro', currentPeriodEnd: day(60) },
      { tenantId: 'b', tenantName: 'B', plan: 'Growth', currentPeriodEnd: day(5) },
      { tenantId: 'c', tenantName: 'C', plan: 'Enterprise', currentPeriodEnd: day(-3) },
    ];
    const r = buildUpcomingRenewals(subs, { now: NOW });
    expect(r.available).toBe(true);
    expect(r.rows.map((x) => x.tenantId)).toEqual(['c', 'b', 'a']); // ascending by days remaining
    expect(r.rows.find((x) => x.tenantId === 'c')!.warning).toBe('past_due');
    expect(r.rows.find((x) => x.tenantId === 'b')!.warning).toBe('renewal_approaching');
    expect(r.rows.find((x) => x.tenantId === 'a')!.warning).toBe('ok');
    expect(r.rows.find((x) => x.tenantId === 'b')!.daysRemaining).toBe(5);
  });

  it('skips rows with no period end and respects the limit', () => {
    const subs = Array.from({ length: 10 }, (_, i) => ({ tenantId: `t${i}`, tenantName: `T${i}`, plan: 'Pro', currentPeriodEnd: day(i + 1) }));
    subs.push({ tenantId: 'nil', tenantName: 'Nil', plan: 'Pro', currentPeriodEnd: null });
    const r = buildUpcomingRenewals(subs, { now: NOW, limit: 6 });
    expect(r.rows).toHaveLength(6);
    expect(r.rows.some((x) => x.tenantId === 'nil')).toBe(false);
  });
});
