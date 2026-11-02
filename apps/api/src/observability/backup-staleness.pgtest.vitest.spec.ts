// backup-staleness.pgtest — BUILD_PLAN Phase 14 C (Constitution 11 §114–117): no successful backup within 26 h → a P2
// alert that pages (and walks the on-call chain), superseding the `backups` component's P3. Fixed clock.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BackupReportsService, backupStalenessAlert, BACKUP_MAX_AGE_HOURS, BACKUP_STALENESS_KEY, type BackupSummary } from './backup-reports';
import { HealthAggregator } from './health-aggregator';
import { alertOwner } from './alert-escalation';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM backup_reports; DELETE FROM alerts WHERE tenant_id IS NULL; DELETE FROM status_components; DELETE FROM system_health_snapshots;`); });
const NOW = Date.parse('2026-06-10T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const summary = (okH: number | null, lastStatus: 'success' | 'failure' | null = okH === null ? null : 'success'): BackupSummary => ({
  lastSuccessfulBackupAt: okH === null ? null : hoursAgo(okH), lastBackupStatus: lastStatus, lastBackupAt: lastStatus ? hoursAgo(okH ?? 1) : null,
  backupAgeHours: okH, pitrEnabled: null, lastDrillAt: null, lastDrillOk: null, lastDrillDetail: null,
});

describe('the rule (pure)', () => {
  it('never reported and not required → no alert (not configured is not an outage)', () => {
    expect(backupStalenessAlert(null, NOW, {})).toBeNull();
    expect(backupStalenessAlert(summary(null), NOW, {})).toBeNull();
  });
  it('never reported but BACKUP_REPORTS_REQUIRED=1 → alert', () => {
    expect(backupStalenessAlert(null, NOW, { BACKUP_REPORTS_REQUIRED: '1' })).toMatchObject({ component: BACKUP_STALENESS_KEY, severity: 'high' });
  });
  it(`a success within ${BACKUP_MAX_AGE_HOURS} h → no alert; older → P2 naming the age`, () => {
    expect(backupStalenessAlert(summary(BACKUP_MAX_AGE_HOURS), NOW, {})).toBeNull();
    const a = backupStalenessAlert(summary(BACKUP_MAX_AGE_HOURS + 1), NOW, {})!;
    expect(a).toMatchObject({ severity: 'high', owner: 'platform', runbook: 'RUNBOOKS.md#backup-failure' });
    expect(a.message).toContain(`${BACKUP_MAX_AGE_HOURS + 1} h ago`);
  });
  it('reports that only ever failed → alert saying so', () => {
    const s = { ...summary(null), lastBackupStatus: 'failure' as const, lastBackupAt: hoursAgo(2) };
    expect(backupStalenessAlert(s, NOW, {})!.message).toMatch(/no backup has ever been reported as successful.*FAILURE/);
  });
  it('routes to the platform owner on the on-call chain', () => {
    expect(alertOwner('system_health', BACKUP_STALENESS_KEY)).toBe('platform');
  });
});

describe('the aggregator raises it, pages-eligible, and resolves it', () => {
  const report = (h: number, status = 'success') => pg.query(`INSERT INTO backup_reports (kind, status, completed_at) VALUES ('backup', $1, $2)`, [status, hoursAgo(h)]);
  const open = async () => (await pg.query(`SELECT related_record_id, severity FROM alerts WHERE tenant_id IS NULL AND related_module = 'system_health' AND status IN ('unread','read') AND related_record_id IN ('backups', '${BACKUP_STALENESS_KEY}') ORDER BY 1`)).rows;
  it('a stale backup → ONE high alert (backup:staleness) — the component\'s own P3 is superseded, not added', async () => {
    await report(40);
    const agg = new HealthAggregator(db, undefined, undefined, new BackupReportsService(db));
    await agg.tick(NOW); await agg.tick(NOW + 30_000);
    expect(await open()).toEqual([{ related_record_id: BACKUP_STALENESS_KEY, severity: 'high' }]);
  });
  it('a fresh success resolves it', async () => {
    await report(40);
    const agg = new HealthAggregator(db, undefined, undefined, new BackupReportsService(db));
    await agg.tick(NOW);
    await report(1);
    await agg.tick(NOW + 30_000);
    expect((await open()).filter((a: any) => a.related_record_id === BACKUP_STALENESS_KEY)).toEqual([]);
  });
  it('no backup job ever reported → no backup alert at all', async () => {
    const agg = new HealthAggregator(db, undefined, undefined, new BackupReportsService(db));
    await agg.tick(NOW);
    expect(await open()).toEqual([]);
  });
});
