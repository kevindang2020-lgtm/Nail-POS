// backup-reports.pgtest — Constitution 11 §114–117: reported backups, and silence detection.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { BackupReportsService, BackupReportsController, evaluateBackups, validateReport, tokenMatches, BACKUP_MAX_AGE_HOURS } from './backup-reports';
import { desiredAlerts } from './alert-rules';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any; let svc: BackupReportsService;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); svc = new BackupReportsService(db); });
beforeEach(async () => { await pg.exec(`DELETE FROM backup_reports`); });
const NOW = Date.parse('2026-09-21T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('the report route fails CLOSED', () => {
  const orig = process.env.BACKUP_REPORT_TOKEN;
  afterEach(() => { if (orig === undefined) delete process.env.BACKUP_REPORT_TOKEN; else process.env.BACKUP_REPORT_TOKEN = orig; });
  const good = { kind: 'backup', status: 'success', completedAt: hoursAgo(1) };
  it('with NO token configured, every report is refused — never accepted unauthenticated', async () => {
    delete process.env.BACKUP_REPORT_TOKEN;
    await expect(new BackupReportsController(svc).report({ headers: { 'x-backup-report-token': 'anything' } }, good)).rejects.toThrow(/not configured/);
    expect((await pg.query(`SELECT count(*)::int c FROM backup_reports`)).rows[0].c).toBe(0);
  });
  it('a wrong token is refused; the right one records', async () => {
    process.env.BACKUP_REPORT_TOKEN = 's3cret';
    await expect(new BackupReportsController(svc).report({ headers: { 'x-backup-report-token': 'wrong' } }, good)).rejects.toThrow(/Invalid/);
    await new BackupReportsController(svc).report({ headers: { 'x-backup-report-token': 's3cret' } }, good);
    expect((await pg.query(`SELECT count(*)::int c FROM backup_reports`)).rows[0].c).toBe(1);
  });
  it('a malformed report is refused with the reason', async () => {
    process.env.BACKUP_REPORT_TOKEN = 's3cret';
    await expect(new BackupReportsController(svc).report({ headers: { 'x-backup-report-token': 's3cret' } }, { kind: 'snapshot', status: 'ok' })).rejects.toThrow(/kind must be|status must be/);
  });
  it('token comparison rejects prefixes and empties', () => {
    expect(tokenMatches('s3c', 's3cret')).toBe(false); expect(tokenMatches('', 's3cret')).toBe(false); expect(tokenMatches(undefined, undefined)).toBe(false);
    expect(tokenMatches('s3cret', 's3cret')).toBe(true);
  });
  it('validation caps detail and ignores non-boolean flags', () => {
    const v = validateReport({ kind: 'restore_drill', status: 'success', completedAt: hoursAgo(1), detail: 'x'.repeat(5000), integrityOk: 'yes' });
    expect(v.ok && v.report.detail!.length).toBe(1000);
    expect(v.ok && v.report.integrityOk).toBeUndefined();
  });
});

describe('§114–116 health from the reports', () => {
  it('never reported → UNKNOWN never_reported, and no alert (an unconfigured job is not an outage)', async () => {
    const e = evaluateBackups(await svc.summary(NOW), NOW);
    expect(e).toMatchObject({ status: 'UNKNOWN', reason: 'never_reported' });
    expect(desiredAlerts([{ key: 'backups', name: 'B', status: e.status, reason: e.reason, criticality: 'IMPORTANT', owner: 'o', runbook: 'r' }])).toEqual([]);
  });
  it('a fresh successful backup and a recent good drill → HEALTHY', async () => {
    await svc.record({ kind: 'backup', status: 'success', completedAt: hoursAgo(2), pitrEnabled: true });
    await svc.record({ kind: 'restore_drill', status: 'success', completedAt: hoursAgo(24 * 10), integrityOk: true, smokeTestOk: true });
    const s = (await svc.summary(NOW))!;
    expect(s.backupAgeHours).toBeCloseTo(2, 1); expect(s.pitrEnabled).toBe(true);
    expect(evaluateBackups(s, NOW).status).toBe('HEALTHY');
  });
  it('§115 the latest backup FAILED → OUTAGE (HIGH alert for an important component), even if an older one succeeded', async () => {
    await svc.record({ kind: 'backup', status: 'success', completedAt: hoursAgo(30) });
    await svc.record({ kind: 'backup', status: 'failure', completedAt: hoursAgo(6), detail: 'snapshot timed out' });
    const e = evaluateBackups(await svc.summary(NOW), NOW);
    expect(e).toMatchObject({ status: 'OUTAGE', reason: 'backup_failed' });
    expect(desiredAlerts([{ key: 'backups', name: 'Backups', status: 'OUTAGE', reason: e.reason, criticality: 'IMPORTANT', owner: 'o', runbook: 'r' }])[0].severity).toBe('high');
  });
  it(`silence: the last success older than ${BACKUP_MAX_AGE_HOURS} h → DEGRADED stale — reports stopping is itself the signal`, async () => {
    await svc.record({ kind: 'backup', status: 'success', completedAt: hoursAgo(BACKUP_MAX_AGE_HOURS + 1) });
    expect(evaluateBackups(await svc.summary(NOW), NOW)).toMatchObject({ status: 'DEGRADED', reason: 'stale' });
  });
  it('§116 a restore drill whose integrity check failed → DEGRADED restore_drill_failed', async () => {
    await svc.record({ kind: 'backup', status: 'success', completedAt: hoursAgo(1) });
    await svc.record({ kind: 'restore_drill', status: 'success', completedAt: hoursAgo(48), integrityOk: false, smokeTestOk: true });
    expect(evaluateBackups(await svc.summary(NOW), NOW)).toMatchObject({ status: 'DEGRADED', reason: 'restore_drill_failed' });
  });
  it('§116 no restore drill in 90 days → DEGRADED restore_drill_overdue — a backup nobody has restored is a hope', async () => {
    await svc.record({ kind: 'backup', status: 'success', completedAt: hoursAgo(1) });
    await svc.record({ kind: 'restore_drill', status: 'success', completedAt: hoursAgo(24 * 91), integrityOk: true, smokeTestOk: true });
    expect(evaluateBackups(await svc.summary(NOW), NOW).reason).toBe('restore_drill_overdue');
  });
});
