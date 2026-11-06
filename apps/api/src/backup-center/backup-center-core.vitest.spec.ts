// backup-center-core — G9 Backup & DR pure rules: manifest safety (§32), the DST-safe midnight checkpoint (§04, §48),
// retention by the point's own timestamp (§30), plan blockers/warnings (§11–13, §25–27) and the approval rules (§35).
import { describe, it, expect } from 'vitest';
import {
  validateManifest, zonedMidnightUtc, midnightSchedule, missedMidnightCheckpoint, retentionFor, evaluatePlan, checkApproval, planChecksum,
  canonicalJson, modeIssues, BACKUP_RESTORE_PLAN, type PointView, type PostPointActivity,
} from './backup-center-core';

const SHA = 'a'.repeat(64);
const good = (over: Record<string, unknown> = {}) => ({
  backupRef: 'railway-2026-11-05', environment: 'production', scope: 'platform', source: 'provider_snapshot',
  recoveryTimestamp: '2026-11-05T05:00:00.000Z', schemaVersion: '819_backup_recovery_catalog.sql', appRelease: 'abc1234',
  artifacts: [{ kind: 'database', location: 's3://aps-backups/2026-11-05.dump', sha256: SHA, sizeBytes: 1024, keyRef: 'kms:alias/aps-backup', immutable: true }],
  ...over,
});
const errs = (m: unknown) => { const v = validateManifest(m); return v.ok ? [] : v.errors; };

describe('manifest validation (§31–32): no point without verifiable artifacts, never a secret', () => {
  it('accepts a complete manifest', () => { expect(validateManifest(good()).ok).toBe(true); });
  it('refuses a manifest with no artifacts / no database artifact / a bad checksum / no key reference', () => {
    expect(errs(good({ artifacts: [] })).join()).toMatch(/at least one stored artifact/);
    expect(errs(good({ artifacts: [{ kind: 'objects', location: 's3://x', sha256: SHA, sizeBytes: 1, keyRef: 'k' }] })).join()).toMatch(/database artifact is required/);
    expect(errs(good({ artifacts: [{ kind: 'database', location: 's3://x', sha256: 'XYZ', sizeBytes: 1, keyRef: 'k' }] })).join()).toMatch(/sha256/);
    expect(errs(good({ artifacts: [{ kind: 'database', location: 's3://x', sha256: SHA, sizeBytes: 1 }] })).join()).toMatch(/unencrypted artifacts are refused/);
  });
  it('refuses credential-looking fields anywhere and URLs that embed a password', () => {
    expect(errs(good({ awsSecretAccessKey: 'x' })).join()).toMatch(/looks like a credential/);
    expect(errs(good({ artifacts: [{ kind: 'database', location: 's3://x', sha256: SHA, sizeBytes: 1, keyRef: 'k', meta: { password: 'p' } }] })).join()).toMatch(/artifacts\.0\.meta\.password|looks like a credential/);
    expect(errs(good({ artifacts: [{ kind: 'database', location: 'postgres://u:pw@host/db', sha256: SHA, sizeBytes: 1, keyRef: 'k' }] })).join()).toMatch(/embeds a credential/);
  });
  it('scope rules: a platform point names no tenant; a branch point needs both ids; PITR needs a window that holds the timestamp', () => {
    expect(errs(good({ tenantId: 'db000000-0000-4000-8000-000000000001' })).join()).toMatch(/platform point names no tenant/);
    expect(errs(good({ scope: 'branch', tenantId: 'db000000-0000-4000-8000-000000000001' })).join()).toMatch(/branchId/);
    expect(errs(good({ source: 'pitr_window' })).join()).toMatch(/needs pitrWindowStart/);
    expect(errs(good({ source: 'pitr_window', pitrWindowStart: '2026-11-05T06:00:00Z', pitrWindowEnd: '2026-11-05T07:00:00Z' })).join()).toMatch(/inside the PITR window/);
  });
});

describe('the midnight checkpoint, America/New_York, DST-safe (§04, §48)', () => {
  it('midnight is 04:00Z in summer (EDT) and 05:00Z in winter (EST), including both DST change days', () => {
    expect(new Date(zonedMidnightUtc(2026, 7, 1)).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(new Date(zonedMidnightUtc(2026, 1, 15)).toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(new Date(zonedMidnightUtc(2026, 3, 8)).toISOString()).toBe('2026-03-08T05:00:00.000Z');    // spring forward at 2 AM that day
    expect(new Date(zonedMidnightUtc(2026, 3, 9)).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(new Date(zonedMidnightUtc(2026, 11, 1)).toISOString()).toBe('2026-11-01T04:00:00.000Z');   // fall back at 2 AM that day
    expect(new Date(zonedMidnightUtc(2026, 11, 2)).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
  it('last/next schedule across the fall-back day (a 25-hour local day)', () => {
    const s = midnightSchedule(Date.parse('2026-11-01T20:00:00Z'));
    expect(new Date(s.last).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(new Date(s.next).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
  it('missed: past the 2-hour grace with no platform point near midnight; inside the grace the PREVIOUS midnight is judged', () => {
    const mid = Date.parse('2026-11-05T05:00:00Z');
    expect(missedMidnightCheckpoint(mid + 3 * 3_600_000, []).missed).toBe(true);
    expect(missedMidnightCheckpoint(mid + 3 * 3_600_000, [mid + 20 * 60_000]).missed).toBe(false);
    expect(missedMidnightCheckpoint(mid + 3 * 3_600_000, [mid - 10 * 3_600_000]).missed).toBe(true);   // a 3 PM backup is not the midnight checkpoint
    const inGrace = missedMidnightCheckpoint(mid + 30 * 60_000, [Date.parse('2026-11-04T05:10:00Z')]);
    expect(new Date(inGrace.scheduledAt).toISOString()).toBe('2026-11-04T05:00:00.000Z');
    expect(inGrace.missed).toBe(false);
  });
});

describe('retention by the point\'s own local date (§30)', () => {
  it('daily / weekly (Sunday) / monthly (1st) / annual (Jan 1) / PITR / pre-restore safety', () => {
    expect(retentionFor('provider_snapshot', Date.parse('2026-11-05T05:00:00Z')).cls).toBe('daily');
    expect(retentionFor('provider_snapshot', Date.parse('2026-11-08T05:00:00Z')).cls).toBe('weekly');
    expect(retentionFor('provider_snapshot', Date.parse('2026-12-01T05:00:00Z')).cls).toBe('monthly');
    const annual = retentionFor('provider_snapshot', Date.parse('2027-01-01T05:00:00Z'));
    expect(annual).toEqual({ cls: 'annual', expiresAt: null });
    expect(retentionFor('pitr_window', 0).cls).toBe('pitr');
    expect(retentionFor('pre_restore_safety', 0)).toEqual({ cls: 'pre_restore_safety', expiresAt: 30 * 86_400_000 });
    // 04:30Z on Nov 1 is still Oct 31 in New York — the LOCAL date decides, not the UTC one
    expect(retentionFor('provider_snapshot', Date.parse('2026-11-01T03:30:00Z')).cls).toBe('daily');
  });
});

const T = 'db000000-0000-4000-8000-0000000000a1';
const point = (over: Partial<PointView> = {}): PointView => ({ id: 'p1', scope: 'platform', tenantId: null, branchId: null, source: 'provider_snapshot', recoveryTimestamp: '2026-11-05T05:00:00.000Z',
  pitrWindowStart: null, pitrWindowEnd: null, schemaVersion: '819_x.sql', appRelease: null, verificationStatus: 'VERIFIED', expiresAt: null, manifestSha256: SHA, ...over });
const quiet: PostPointActivity = { payments: { count: 0, amountCents: 0 }, unresolvedPaymentAttempts: 0, payrollPayouts: { count: 0, amountCents: 0, checksIssued: 0 }, giftCardTransactions: 0,
  loyaltyEntries: 0, smsSent: 0, outboxEvents: 0, ticketsChanged: 0, appointmentsChanged: 0, customersChanged: 0, sharedCustomersAcrossBranches: null, centralIdentityLinks: 0 };
const NOW = Date.parse('2026-11-05T12:00:00Z');
const plan = (o: Partial<Parameters<typeof evaluatePlan>[0]> = {}) => evaluatePlan({ mode: 'FULL_TENANT', tenantId: T, branchId: null, point: point(), targetMs: Date.parse('2026-11-05T05:00:00Z'), now: NOW, currentSchemaVersion: '819_x.sql', activity: quiet, ...o });
const codes = (p: ReturnType<typeof plan>) => p.blockers.map((b) => b.code);

describe('the planner (§11–13, §17, §25–27, §40)', () => {
  it('a verified, in-scope, quiet plan has no blockers and is preview-only (destructive apply is gated later)', () => {
    const p = plan(); expect(p.blockers).toEqual([]); expect(p.executable).toBe('preview_only'); expect(p.financialEventsAfterTarget).toBe(0);
  });
  it('blocks: unverified / expired / another tenant\'s point / outside coverage / future / newer schema', () => {
    expect(codes(plan({ point: point({ verificationStatus: 'UNVERIFIED' }) }))).toContain('POINT_NOT_VERIFIED');
    expect(codes(plan({ point: point({ expiresAt: '2026-11-01T00:00:00Z' }) }))).toContain('POINT_EXPIRED');
    expect(codes(plan({ point: point({ scope: 'tenant', tenantId: 'db000000-0000-4000-8000-0000000000a2' }) }))).toContain('POINT_SCOPE_MISMATCH');
    expect(codes(plan({ targetMs: Date.parse('2026-11-05T06:00:00Z') }))).toContain('TARGET_OUTSIDE_COVERAGE');
    expect(codes(plan({ point: point({ source: 'pitr_window', pitrWindowStart: '2026-11-05T00:00:00Z', pitrWindowEnd: '2026-11-05T11:00:00Z' }), targetMs: Date.parse('2026-11-05T06:00:00Z') }))).toEqual([]);
    expect(codes(plan({ point: point({ source: 'pitr_window', pitrWindowStart: '2026-11-05T00:00:00Z', pitrWindowEnd: '2026-11-06T00:00:00Z' }), targetMs: NOW + 1000 }))).toContain('TARGET_IN_FUTURE');
    expect(codes(plan({ point: point({ schemaVersion: '900_future.sql' }) }))).toContain('SCHEMA_NEWER_THAN_CURRENT');
    expect(plan({ point: point({ schemaVersion: '700_old.sql' }) }).warnings.map((w) => w.code)).toContain('FORWARD_MIGRATION_REQUIRED');
  });
  it('§13: selected-domain is not advertised as ready; full platform is a runbook, not a button', () => {
    expect(modeIssues('SELECTED_DOMAIN')[0].code).toBe('MODE_NOT_SUPPORTED');
    expect(codes(plan({ mode: 'FULL_PLATFORM', tenantId: null }))).toContain('MODE_REQUIRES_RUNBOOK');
    expect(modeIssues('FULL_TENANT')).toEqual([]); expect(modeIssues('NON_DESTRUCTIVE_PREVIEW')).toEqual([]);
  });
  it('§25 P0: an unresolved card attempt blocks; payments/payouts/gift/loyalty after the target are warned and counted', () => {
    expect(codes(plan({ activity: { ...quiet, unresolvedPaymentAttempts: 1 } }))).toContain('UNRESOLVED_PAYMENT_ATTEMPTS');
    const p = plan({ activity: { ...quiet, payments: { count: 2, amountCents: 5000 }, payrollPayouts: { count: 1, amountCents: 100, checksIssued: 1 }, giftCardTransactions: 3, loyaltyEntries: 4, smsSent: 2 } });
    expect(p.financialEventsAfterTarget).toBe(10);
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['PAYMENTS_AFTER_TARGET', 'PAYOUTS_AFTER_TARGET', 'GIFT_CARD_ACTIVITY_AFTER_TARGET', 'LOYALTY_ACTIVITY_AFTER_TARGET', 'SIDE_EFFECTS_AFTER_TARGET']));
    expect(p.warnings.find((w) => w.code === 'PAYMENTS_AFTER_TARGET')!.message).toMatch(/never charged again/);
  });
  it('the checksum is canonical (key order does not matter) and changes with the plan', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(planChecksum(plan())).toBe(planChecksum(plan()));
    expect(planChecksum(plan())).not.toBe(planChecksum(plan({ activity: { ...quiet, payments: { count: 1, amountCents: 1 } } })));
  });
});

describe('approval rules (§35)', () => {
  const base = { mode: 'FULL_TENANT' as const, requestedBy: 'u1', planSha256: SHA, financialEvents: 0 };
  it('a different person, the exact plan, finance acknowledged when money moved', () => {
    expect(checkApproval(base, 'u1', SHA, false)?.code).toBe('RESTORE_SECOND_PERSON_REQUIRED');
    expect(checkApproval(base, 'u2', 'b'.repeat(64), false)?.code).toBe('RESTORE_PLAN_CHANGED');
    expect(checkApproval({ ...base, financialEvents: 3 }, 'u2', SHA, false)?.code).toBe('RESTORE_FINANCE_ACK_REQUIRED');
    expect(checkApproval({ ...base, financialEvents: 3 }, 'u2', SHA, true)).toBeNull();
    expect(checkApproval(base, null, SHA, false)?.code).toBe('RESTORE_APPROVER_REQUIRED');
  });
  it('a non-destructive preview may be approved by its requester (it never writes)', () => {
    expect(checkApproval({ ...base, mode: 'NON_DESTRUCTIVE_PREVIEW' }, 'u1', SHA, false)).toBeNull();
  });
  it('the restore state machine: COMPLETED only from VERIFYING; nothing leaves a terminal state', () => {
    expect(BACKUP_RESTORE_PLAN.sourcesOf('COMPLETED')).toEqual(['VERIFYING']);
    expect(BACKUP_RESTORE_PLAN.can('RESTORING', 'COMPLETED')).toBe(false);
    for (const t of ['COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED']) expect(BACKUP_RESTORE_PLAN.can(t, 'PREPARING')).toBe(false);
  });
});
