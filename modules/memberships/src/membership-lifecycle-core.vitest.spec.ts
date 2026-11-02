import { describe, it, expect } from 'vitest';
import { resolveCancel, resolvePause, resolveResume } from './membership-lifecycle-core';

const NOW = '2026-06-27T12:00:00.000Z';
const PERIOD_END = '2026-07-27T00:00:00.000Z';

describe('resolveCancel', () => {
  it('at period end: canceling, auto_renew off, term_end_at = period end', () => {
    const r = resolveCancel('active', { atPeriodEnd: true, currentPeriodEnd: PERIOD_END, reason: 'too pricey', nowIso: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targetStatus).toBe('canceling');
    expect(r.patch.autoRenew).toBe(false);
    expect(r.patch.cancelAtPeriodEnd).toBe(true);
    expect(r.patch.termEndAt).toBe(PERIOD_END);
  });

  it('immediate: canceled with canceled_at stamped', () => {
    const r = resolveCancel('past_due', { atPeriodEnd: false, currentPeriodEnd: PERIOD_END, reason: null, nowIso: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targetStatus).toBe('canceled');
    expect(r.patch.canceledAt).toBe(NOW);
    expect(r.patch.autoRenew).toBe(false);
  });

  it('rejects immediate cancel from active but suggests scheduling', () => {
    const r = resolveCancel('active', { atPeriodEnd: false, currentPeriodEnd: PERIOD_END, reason: null, nowIso: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/cancel at period end/i);
  });

  it('rejects cancel from a terminal status', () => {
    expect(resolveCancel('canceled', { atPeriodEnd: true, currentPeriodEnd: null, reason: null, nowIso: NOW }).ok).toBe(false);
  });
});

describe('resolvePause / resolveResume', () => {
  it('pauses an active membership and bumps pauses_used', () => {
    const r = resolvePause('active', { resumesAt: null, nowIso: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targetStatus).toBe('paused');
    expect(r.patch.pausedAt).toBe(NOW);
    expect(r.patch.bumpPausesUsed).toBe(true);
  });

  it('resumes a paused membership to active, clearing pause stamps', () => {
    const r = resolveResume('paused');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targetStatus).toBe('active');
    expect(r.patch.pausedAt).toBeNull();
  });

  it('resumes a canceling membership (reactivation before period end)', () => {
    expect(resolveResume('canceling').ok).toBe(true);
  });

  it('rejects resume of an already-active membership and pause of a terminal one', () => {
    expect(resolveResume('active').ok).toBe(false);
    expect(resolvePause('canceled', { resumesAt: null, nowIso: NOW }).ok).toBe(false);
  });
});
