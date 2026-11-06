// backup-reports.ts — Constitution 11 §114–117: backup, PITR and restore-drill visibility.
//
// WHAT THIS IS NOT. The API cannot see the database provider's backup console. Building a screen that pretended to
// would be fake green. Instead the provider's backup job (or a small script after it) POSTs a report here, and the
// platform does the one thing it is placed to do: notice when the reports STOP. §115: do not wait until disaster.
//
// TRUST. POST /internal/backups/report is service-to-service (check:public: `internal/` is network-restricted), and
// on top of that it requires a shared secret in `x-backup-report-token` matching BACKUP_REPORT_TOKEN. With no token
// configured it REFUSES every report (503) rather than accepting unauthenticated ones — a forged "backup succeeded"
// is exactly the fake green §332 forbids. Comparison is constant-time.
//
// HEALTH (backups component, IMPORTANT): the latest backup report is a failure → OUTAGE; the last success is older
// than BACKUP_MAX_AGE_HOURS (default 26: a daily backup plus margin) → DEGRADED with reason `stale`; a restore drill
// older than 90 days, or whose integrity/smoke test failed, → DEGRADED; never reported → UNKNOWN with reason
// `never_reported`, shown on the page as such. It does not alert (an unconfigured job is not an outage) — but it is
// listed under Remaining Risks in the final report until the job exists.
import { requireServiceCaller, ServiceAuthError } from '@aipowersalon/auth';
import { BadRequestException, Body, Controller, HttpCode, Inject, Injectable, Optional, Post, ServiceUnavailableException, UnauthorizedException, Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import type { Evaluation } from './health-core';
import type { DesiredAlert } from './alert-rules';
import { BACKUP_REPORT_BODY } from './request-schemas';
import { missedMidnightCheckpoint } from '../backup-center/backup-center-core';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

export const BACKUP_MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 26);
export const DRILL_MAX_AGE_DAYS = 90;

export interface BackupReportInput { kind: 'backup' | 'restore_drill'; status: 'success' | 'failure'; startedAt?: string; completedAt: string; sizeBytes?: number; pitrEnabled?: boolean; integrityOk?: boolean; smokeTestOk?: boolean; detail?: string }

export function validateReport(b: any): { ok: true; report: BackupReportInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['body required'] };
  if (!['backup', 'restore_drill'].includes(b.kind)) errors.push('kind must be backup or restore_drill');
  if (!['success', 'failure'].includes(b.status)) errors.push('status must be success or failure');
  const completed = Date.parse(String(b.completedAt ?? ''));
  if (!Number.isFinite(completed)) errors.push('completedAt must be an ISO timestamp');
  if (b.sizeBytes !== undefined && !(Number.isFinite(b.sizeBytes) && b.sizeBytes >= 0)) errors.push('sizeBytes must be a non-negative number');
  if (errors.length) return { ok: false, errors };
  return { ok: true, report: { kind: b.kind, status: b.status, startedAt: b.startedAt, completedAt: new Date(completed).toISOString(), sizeBytes: b.sizeBytes,
    pitrEnabled: typeof b.pitrEnabled === 'boolean' ? b.pitrEnabled : undefined, integrityOk: typeof b.integrityOk === 'boolean' ? b.integrityOk : undefined,
    smokeTestOk: typeof b.smokeTestOk === 'boolean' ? b.smokeTestOk : undefined, detail: typeof b.detail === 'string' ? b.detail.slice(0, 1000) : undefined } };
}

export function tokenMatches(presented: string | undefined, configured: string | undefined): boolean {
  if (!configured || !presented) return false;
  const a = Buffer.from(presented), b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface BackupSummary {
  /** G9 §34: the 12:00 AM America/New_York platform checkpoint — null until the recovery catalog has ever been fed. */
  midnightCheckpoint?: { missed: boolean; scheduledAt: string } | null;
  lastSuccessfulBackupAt: string | null; lastBackupStatus: 'success' | 'failure' | null; lastBackupAt: string | null; backupAgeHours: number | null;
  pitrEnabled: boolean | null; lastDrillAt: string | null; lastDrillOk: boolean | null; lastDrillDetail: string | null;
}

/** §114–116 the component from the two latest reports. Pure. */
export function evaluateBackups(s: BackupSummary | null, now: number): Evaluation {
  if (!s || (s.lastBackupAt === null && s.lastDrillAt === null)) return { status: 'UNKNOWN', reason: 'never_reported', summary: {} };
  const summary = { backupAgeHours: s.backupAgeHours, lastBackupStatus: s.lastBackupStatus, pitrEnabled: s.pitrEnabled === null ? null : s.pitrEnabled ? 1 : 0, lastDrillOk: s.lastDrillOk === null ? null : s.lastDrillOk ? 1 : 0 };
  if (s.lastBackupStatus === 'failure') return { status: 'OUTAGE', reason: 'backup_failed', summary };
  if (s.lastSuccessfulBackupAt === null) return { status: 'OUTAGE', reason: 'no_successful_backup', summary };
  if ((s.backupAgeHours ?? Infinity) > BACKUP_MAX_AGE_HOURS) return { status: 'DEGRADED', reason: 'stale', summary };
  if (s.lastDrillOk === false) return { status: 'DEGRADED', reason: 'restore_drill_failed', summary };
  if (s.lastDrillAt === null || now - Date.parse(s.lastDrillAt) > DRILL_MAX_AGE_DAYS * 86_400_000) return { status: 'DEGRADED', reason: 'restore_drill_overdue', summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/**
 * BUILD_PLAN Phase 14 C — the staleness RULE (§115: do not wait until disaster). No successful backup reported within
 * BACKUP_MAX_AGE_HOURS (26 h: a daily backup plus margin) → a P2 (high) platform alert, which emails and walks the on-call
 * chain. The `backups` component alone was DEGRADED → a P3 that only the screen shows.
 * It applies once the backup job has reported at least once — a job that was never set up is "not configured", not an
 * outage — unless BACKUP_REPORTS_REQUIRED=1 says reports are expected (then silence from day one alerts). Pure.
 */
export const BACKUP_STALENESS_KEY = 'backup:staleness';
export function backupStalenessAlert(s: BackupSummary | null, now: number, env: Record<string, string | undefined> = process.env): DesiredAlert | null {
  const required = env.BACKUP_REPORTS_REQUIRED === '1' || env.BACKUP_REPORTS_REQUIRED === 'true';
  const everReported = !!s && s.lastBackupAt !== null;
  if (!everReported && !required) return null;
  const okAt = s?.lastSuccessfulBackupAt ? Date.parse(s.lastSuccessfulBackupAt) : null;
  const ageH = okAt === null ? null : (now - okAt) / 3_600_000;
  if (ageH !== null && ageH <= BACKUP_MAX_AGE_HOURS) return null;
  const why = okAt === null ? (everReported ? 'no backup has ever been reported as successful' : 'no backup report has ever been received')
    : `the last successful backup was ${Math.floor(ageH!)} h ago`;
  return {
    component: BACKUP_STALENESS_KEY, severity: 'high', owner: 'platform', runbook: 'RUNBOOKS.md#backup-failure', causes: [],
    title: `No successful backup in the last ${BACKUP_MAX_AGE_HOURS} hours`,
    message: `No successful backup in the last ${BACKUP_MAX_AGE_HOURS} hours: ${why}` + (s?.lastBackupStatus === 'failure' ? ' (the latest report was a FAILURE)' : '') +
      '. Check the backup job (the backup-report workflow / Railway cron) and Railway → Postgres → Backups. Owner: platform. Runbook: RUNBOOKS.md#backup-failure',
  };
}

/**
 * G9 Backup & DR §34 (Nov 5 2026): the midnight checkpoint rule. Once the recovery catalog has received a platform point,
 * a scheduled 12:00 AM America/New_York checkpoint with no platform point within ±2 h, still missing 2 h after midnight,
 * is a P2 page — independent of the 26-hour staleness rule (a job that ran at 3 PM is not the midnight checkpoint). Pure.
 */
export const MIDNIGHT_CHECKPOINT_KEY = 'backup:midnight_checkpoint';
export function midnightCheckpointAlert(s: BackupSummary | null): DesiredAlert | null {
  const m = s?.midnightCheckpoint;
  if (!m || !m.missed) return null;
  return {
    component: MIDNIGHT_CHECKPOINT_KEY, severity: 'high', owner: 'platform', runbook: 'RUNBOOKS.md#backup-failure', causes: [],
    title: 'Midnight backup checkpoint missed',
    message: `No platform recovery point was reported for the ${m.scheduledAt} (12:00 AM America/New_York) checkpoint. Check the provider backup job and its manifest report (docs/backup/BACKUP_AND_DR.md §2). Owner: platform. Runbook: RUNBOOKS.md#backup-failure`,
  };
}

@Injectable()
export class BackupReportsService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  async record(r: BackupReportInput): Promise<void> {
    await sql`insert into backup_reports (kind, status, started_at, completed_at, size_bytes, pitr_enabled, integrity_ok, smoke_test_ok, detail)
              values (${r.kind}, ${r.status}, ${r.startedAt ? new Date(r.startedAt) : null}, ${new Date(r.completedAt)}, ${r.sizeBytes ?? null}, ${r.pitrEnabled ?? null}, ${r.integrityOk ?? null}, ${r.smokeTestOk ?? null}, ${r.detail ?? null})`.execute(this.db);
  }
  /** G9: the missed-midnight check over the recovery catalog (null until a platform point was ever reported). */
  async midnightCheckpoint(now: number): Promise<{ missed: boolean; scheduledAt: string } | null> {
    try {
      const ever = (await sql<any>`select 1 from backup_recovery_points where scope = 'platform' limit 1`.execute(this.db)).rows.length > 0;
      if (!ever) return null;
      const rows = (await sql<any>`select recovery_timestamp from backup_recovery_points where scope = 'platform' and verification_status <> 'FAILED'
        and recovery_timestamp > ${new Date(now - 3 * 86_400_000).toISOString()} order by recovery_timestamp desc limit 20`.execute(this.db)).rows;
      const m = missedMidnightCheckpoint(now, rows.map((x: any) => new Date(x.recovery_timestamp).getTime()));
      return { missed: m.missed, scheduledAt: new Date(m.scheduledAt).toISOString() };
    } catch (e) { void e; return null; }   // catalog table absent on an old database: the rule does not apply (not an alert about alerts)
  }
  async summary(now = Date.now()): Promise<BackupSummary | null> {
    if (!this.db) return null;
    const last = (await sql<any>`select status, completed_at, pitr_enabled from backup_reports where kind = 'backup' order by completed_at desc limit 1`.execute(this.db)).rows[0];
    const lastOk = (await sql<any>`select completed_at from backup_reports where kind = 'backup' and status = 'success' order by completed_at desc limit 1`.execute(this.db)).rows[0];
    const drill = (await sql<any>`select completed_at, status, integrity_ok, smoke_test_ok, detail from backup_reports where kind = 'restore_drill' order by completed_at desc limit 1`.execute(this.db)).rows[0];
    const okAt = lastOk ? new Date(lastOk.completed_at) : null;
    return {
      lastSuccessfulBackupAt: okAt?.toISOString() ?? null, lastBackupStatus: last?.status ?? null, lastBackupAt: last ? new Date(last.completed_at).toISOString() : null,
      backupAgeHours: okAt ? (now - okAt.getTime()) / 3_600_000 : null, pitrEnabled: last?.pitr_enabled ?? null,
      lastDrillAt: drill ? new Date(drill.completed_at).toISOString() : null,
      lastDrillOk: drill ? drill.status === 'success' && drill.integrity_ok !== false && drill.smoke_test_ok !== false : null,
      lastDrillDetail: drill?.detail ?? null,
      midnightCheckpoint: await this.midnightCheckpoint(now),
    };
  }
}

@Controller('internal/backups')
export class BackupReportsController {
  constructor(private readonly svc: BackupReportsService) {}
  @Post('report') @HttpCode(204)
  async report(@Req() r: any, @Body(ValidatedBody(BACKUP_REPORT_BODY, { strict: true })) body: unknown): Promise<void> {
    // Constitution 3 Step 6: a svc.backups token, or the legacy x-backup-report-token while BACKUP_REPORT_TOKEN is set
    try { requireServiceCaller(r, 'backups.report', { name: 'BACKUP_REPORT_TOKEN', secret: process.env.BACKUP_REPORT_TOKEN, header: 'x-backup-report-token' }); }
    catch (e) { if (e instanceof ServiceAuthError) { if (e.status === 503) throw new ServiceUnavailableException('Backup reporting is not configured (SERVICE_TOKEN_SECRET or BACKUP_REPORT_TOKEN).'); throw new UnauthorizedException('Invalid backup report credentials.'); } throw e; }
    const v = validateReport(body);
    if (!v.ok) throw new BadRequestException(v.errors.join('; '));
    await this.svc.record(v.report);
  }
}
