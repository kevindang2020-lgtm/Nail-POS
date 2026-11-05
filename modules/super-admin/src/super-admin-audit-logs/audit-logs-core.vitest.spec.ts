import { describe, it, expect } from 'vitest';
import { resultBucket, isCritical, categoryLabel, riskLevel, pct, distribution, trendDelta, kpiTrendSemantic, beforeAfter, holdCovers, isEventHeld, isSensitiveKey, redactText, buildManifest, evaluateExportRisk, median, retentionTotalDays, retentionCutoff, isPurgeEligible } from './audit-logs-core';

describe('audit-logs core', () => {
  it('buckets result status', () => {
    expect(resultBucket('ok')).toMatchObject({ key: 'success', semantic: 'good' });
    expect(resultBucket('warning')).toMatchObject({ key: 'warning', semantic: 'warn' });
    expect(resultBucket('failed')).toMatchObject({ key: 'failed', semantic: 'bad' });
    expect(resultBucket('under_review')).toMatchObject({ key: 'under_review', semantic: 'neutral' });
  });

  it('flags critical severity', () => {
    expect(isCritical('critical')).toBe(true);
    expect(isCritical('high')).toBe(true);
    expect(isCritical('info')).toBe(false);
  });

  it('labels categories from module', () => {
    expect(categoryLabel('payments')).toBe('Payments');
    expect(categoryLabel('smart-reminders')).toBe('Smart Reminders');
    expect(categoryLabel('custom_module')).toBe('Custom Module');
  });

  it('classifies risk for the suspicious queue', () => {
    expect(riskLevel('login', 'failed', 'info').key).toBe('high');
    expect(riskLevel('data_export', 'ok', 'info').key).toBe('medium');
    expect(riskLevel('profile_view', 'ok', 'info').key).toBe('low');
    expect(riskLevel('x', 'ok', 'critical').key).toBe('high');
  });

  it('computes rates, distribution, trend semantics', () => {
    expect(pct(312, 48726)).toBe(0.6);
    expect(distribution([{ key: 'a', label: 'A', count: 25 }], 100)[0].pct).toBe(25);
    expect(trendDelta(120, 100)).toMatchObject({ deltaPct: 20, direction: 'up' });
    expect(kpiTrendSemantic('failed_logins', 'up')).toBe('bad');
    expect(kpiTrendSemantic('total', 'up')).toBe('neutral');
  });

  it('derives before/after from metadata', () => {
    expect(beforeAfter({ before: 'Basic', after: 'Premium' })).toEqual({ previous: 'Basic', next: 'Premium' });
    expect(beforeAfter({ after: { status: 'active' } })).toMatchObject({ previous: null });
    expect(beforeAfter(null)).toEqual({ previous: null, next: null });
  });

  it('evaluates legal-hold coverage without touching log rows', () => {
    const ev = { tenantId: 't1', actorUserId: 'u1', action: 'data_export', occurredAt: '2026-05-05T12:00:00Z' };
    expect(holdCovers({ status: 'active', scopeType: 'global', scopeValue: null }, ev)).toBe(true);
    expect(holdCovers({ status: 'released', scopeType: 'global', scopeValue: null }, ev)).toBe(false); // released holds don't protect
    expect(holdCovers({ status: 'active', scopeType: 'tenant', scopeValue: 't1' }, ev)).toBe(true);
    expect(holdCovers({ status: 'active', scopeType: 'tenant', scopeValue: 't2' }, ev)).toBe(false);
    expect(holdCovers({ status: 'active', scopeType: 'action', scopeValue: 'export' }, ev)).toBe(true);
    expect(holdCovers({ status: 'active', scopeType: 'date_range', scopeValue: '2026-05-01|2026-05-10' }, ev)).toBe(true);
    expect(holdCovers({ status: 'active', scopeType: 'date_range', scopeValue: '2026-06-01|2026-06-10' }, ev)).toBe(false);
    expect(isEventHeld([{ status: 'active', scopeType: 'tenant', scopeValue: 't2' }, { status: 'active', scopeType: 'user', scopeValue: 'u1' }], ev)).toBe(true);
  });

  it('redacts secrets and builds an evidence manifest', () => {
    expect(isSensitiveKey('passwordHash')).toBe(true);
    expect(isSensitiveKey('api_key')).toBe(true);
    expect(isSensitiveKey('tenant_name')).toBe(false);
    expect(redactText('card 4111111111111111 used')).toContain('****REDACTED****');
    expect(redactText('token=abcdefghijklmnopqrstuvwxyz012345')).toContain('****REDACTED****');
    expect(redactText('Basic → Premium')).toBe('Basic → Premium');
    const m = buildManifest({ packRef: 'EP-1', format: 'csv', eventCount: 12, checksum: 'abc', generatedAt: '2026-05-06T00:00:00Z', redactionApplied: true });
    expect(m).toMatchObject({ packRef: 'EP-1', checksumAlgorithm: 'sha256', eventCount: 12, redactionApplied: true });
  });

  it('flags export risk with documented rules', () => {
    expect(evaluateExportRisk({ action: 'login', status: 'ok', summary: '', metadata: {}, occurredAt: '2026-05-06T12:00:00Z' })).toEqual([]); // non-export ignored
    const big = evaluateExportRisk({ action: 'data_export', status: 'ok', summary: 'customer report', metadata: { recordCount: 5000 }, occurredAt: '2026-05-06T12:00:00Z' });
    expect(big.map((f) => f.ruleKey).sort()).toEqual(['large_export', 'sensitive_scope']);
    expect(big.find((f) => f.ruleKey === 'large_export')!.risk).toBe('high');
    const failed = evaluateExportRisk({ action: 'export_generated', status: 'failed', summary: 'sales', metadata: {}, occurredAt: '2026-05-06T03:00:00Z' });
    expect(failed.map((f) => f.ruleKey).sort()).toEqual(['export_failed', 'off_hours']);
  });

  it('adds context-aware velocity + volume-spike rules only when context is supplied', () => {
    const ev = { action: 'data_export', status: 'ok', summary: 'report', metadata: { recordCount: 40 }, occurredAt: '2026-05-06T12:00:00Z' };
    expect(evaluateExportRisk(ev).map((f) => f.ruleKey)).toEqual([]);                                     // no context → no context rules
    expect(evaluateExportRisk(ev, { actorExportsLastHour: 6 }).map((f) => f.ruleKey)).toEqual(['velocity']);
    expect(evaluateExportRisk(ev, { actorMedianRecordCount: 5 }).map((f) => f.ruleKey)).toEqual(['volume_spike']); // 40 >= 5*4
    expect(evaluateExportRisk(ev, { actorMedianRecordCount: 20 }).map((f) => f.ruleKey)).toEqual([]);      // 40 < 20*4
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('computes retention eligibility without deleting anything, honoring holds', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const p = { hotDays: 30, archiveDays: 60 }; // 90 total
    expect(retentionTotalDays(p)).toBe(90);
    expect(retentionCutoff(p, now)).toBe('2026-03-03T00:00:00.000Z');
    expect(isPurgeEligible('2026-01-01T00:00:00Z', p, false, now)).toBe(true);   // older than 90d
    expect(isPurgeEligible('2026-05-01T00:00:00Z', p, false, now)).toBe(false);  // within retention
    expect(isPurgeEligible('2026-01-01T00:00:00Z', p, true, now)).toBe(false);   // legal hold overrides
    expect(isPurgeEligible('2026-01-01T00:00:00Z', { hotDays: 0, archiveDays: 0 }, false, now)).toBe(false); // keep-forever
  });
});
