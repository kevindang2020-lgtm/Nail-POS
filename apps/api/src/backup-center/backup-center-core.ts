// backup-center-core.ts — Enterprise Backup & Disaster Recovery guide (Nov 5 2026, G9). Pure rules, no I/O.
//
//   • manifest validation (§32): every artifact names a location, a sha256 and an encryption KEY REFERENCE; a manifest
//     carrying a credential-looking field or a URL with a password in it is refused — the catalog never holds secrets.
//   • the midnight checkpoint (§04/§48): 12:00 AM America/New_York, DST-safe, and whether the latest one was missed.
//   • retention class + expiry (§30) from the point's own timestamp (never from a guessed file name, §38).
//   • the restore plan checksum (§17/§35): an approval binds to the exact canonical plan.
//   • the planner's blockers and warnings (§11–13, §25–27): which modes are honestly executable here, and what happened
//     AFTER the requested time that a restore must never repeat (charges, payouts, gift-card spends, sends).
import { createHash } from 'node:crypto';
import { defineStateMachine } from '@aipowersalon/database';
import { BACKUP_TZ, CHECKPOINT_GRACE_MS, CHECKPOINT_WINDOW_MS, tzParts, zonedMidnightUtc, localDate, midnightSchedule, missedMidnightCheckpoint } from '../observability/backup-schedule';
export { BACKUP_TZ, CHECKPOINT_GRACE_MS, CHECKPOINT_WINDOW_MS, zonedMidnightUtc, localDate, midnightSchedule, missedMidnightCheckpoint };   // the platform schedule (observability/backup-schedule.ts)

export const RESTORE_MODES = ['FULL_TENANT', 'ONE_BRANCH', 'SELECTED_DOMAIN', 'FULL_PLATFORM', 'NON_DESTRUCTIVE_PREVIEW'] as const;
export type RestoreMode = typeof RESTORE_MODES[number];
export const APPROVAL_TTL_MS = 30 * 60_000;

export class BackupCenterError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409, readonly details?: Record<string, unknown>) { super(message); this.name = 'BackupCenterError'; }
}

// ── state machines (§33) ──────────────────────────────────────────────────────────────────────────────────────────────
export const BACKUP_RECOVERY_POINT = defineStateMachine({
  name: 'backup_recovery_point', table: 'backup_recovery_points', column: 'verification_status',
  states: ['UNVERIFIED', 'VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED'],
  // a point is re-verifiable (a later drill can prove or disprove it); EXPIRED is terminal
  transitions: { UNVERIFIED: ['VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED'], VERIFIED: ['VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED'],
    PARTIAL: ['VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED'], FAILED: ['VERIFIED', 'PARTIAL', 'FAILED', 'EXPIRED'] },
  initial: ['UNVERIFIED', 'FAILED'],
});
export const BACKUP_RESTORE_PLAN = defineStateMachine({
  name: 'backup_restore_plan', table: 'backup_restore_plans', column: 'status',
  states: ['REQUESTED', 'PLANNING', 'VALIDATING', 'AWAITING_APPROVAL', 'APPROVED', 'PREPARING', 'RESTORING', 'RECONCILING', 'VERIFYING',
    'COMPLETED', 'FAILED', 'ROLLED_BACK', 'BLOCKED', 'CANCELLED'],
  transitions: {
    REQUESTED: ['AWAITING_APPROVAL', 'BLOCKED'],
    AWAITING_APPROVAL: ['APPROVED', 'CANCELLED', 'BLOCKED'],
    APPROVED: ['PREPARING', 'CANCELLED', 'BLOCKED'],
    PREPARING: ['RESTORING', 'BLOCKED', 'FAILED'],
    RESTORING: ['RECONCILING', 'VERIFYING', 'FAILED', 'ROLLED_BACK'],
    RECONCILING: ['VERIFYING', 'FAILED', 'ROLLED_BACK'],
    VERIFYING: ['COMPLETED', 'FAILED', 'ROLLED_BACK'],
    BLOCKED: ['CANCELLED'],
  },
  initial: ['REQUESTED'],
});
export const ACTIVE_RESTORE_STATES = ['PREPARING', 'RESTORING', 'RECONCILING', 'VERIFYING'] as const;

// ── canonical JSON + checksums ────────────────────────────────────────────────────────────────────────────────────────
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

// ── manifest (§31–32) ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface ManifestArtifact { kind: 'database' | 'wal' | 'objects' | 'release'; location: string; sha256: string; sizeBytes: number; keyRef: string; immutable?: boolean }
export interface RecoveryManifest {
  backupRef: string; environment: string; scope: 'platform' | 'tenant' | 'branch'; tenantId?: string | null; branchId?: string | null;
  source: 'provider_snapshot' | 'pitr_window' | 'logical_export' | 'pre_restore_safety';
  recoveryTimestamp: string; pitrWindowStart?: string | null; pitrWindowEnd?: string | null;
  databaseCheckpoint?: string | null; walTimeline?: string | null; schemaVersion: string; appRelease?: string | null;
  artifacts: ManifestArtifact[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRETISH = /(secret|password|passwd|token|private[_-]?key|access[_-]?key|credential|api[_-]?key)/i;
const ISO = (s: unknown) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s)) && /\d{4}-\d{2}-\d{2}T/.test(s);

/** Every key anywhere in the manifest — a credential-looking name is refused wherever it hides (keyRef is a reference). */
function secretishKeys(v: unknown, path = ''): string[] {
  if (!v || typeof v !== 'object') return [];
  const out: string[] = [];
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (k !== 'keyRef' && SECRETISH.test(k)) out.push(p);
    out.push(...secretishKeys(val, p));
  }
  return out;
}

export function validateManifest(raw: unknown): { ok: true; manifest: RecoveryManifest } | { ok: false; errors: string[] } {
  const m = (raw ?? null) as Record<string, any> | null; const errors: string[] = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest must be an object'] };
  for (const p of secretishKeys(m)) errors.push(`manifest field "${p}" looks like a credential — store a key reference, never a secret`);
  if (typeof m.backupRef !== 'string' || !m.backupRef.trim() || m.backupRef.length > 200) errors.push('backupRef is required (≤ 200 characters)');
  if (typeof m.environment !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(m.environment)) errors.push('environment must be a short lower-case name');
  if (!['platform', 'tenant', 'branch'].includes(m.scope)) errors.push('scope must be platform, tenant or branch');
  if (m.scope === 'platform' && (m.tenantId || m.branchId)) errors.push('a platform point names no tenant or branch');
  if ((m.scope === 'tenant' || m.scope === 'branch') && !(typeof m.tenantId === 'string' && UUID.test(m.tenantId))) errors.push('tenantId (uuid) is required for a tenant or branch point');
  if (m.scope === 'branch' && !(typeof m.branchId === 'string' && UUID.test(m.branchId))) errors.push('branchId (uuid) is required for a branch point');
  if (m.scope === 'tenant' && m.branchId) errors.push('a tenant point names no branch');
  if (!['provider_snapshot', 'pitr_window', 'logical_export', 'pre_restore_safety'].includes(m.source)) errors.push('source must be provider_snapshot, pitr_window, logical_export or pre_restore_safety');
  if (!ISO(m.recoveryTimestamp)) errors.push('recoveryTimestamp must be an ISO date-time');
  if (m.source === 'pitr_window') {
    if (!ISO(m.pitrWindowStart) || !ISO(m.pitrWindowEnd)) errors.push('a pitr_window point needs pitrWindowStart and pitrWindowEnd');
    else if (Date.parse(m.pitrWindowStart) > Date.parse(m.pitrWindowEnd)) errors.push('pitrWindowStart must not be after pitrWindowEnd');
    else if (ISO(m.recoveryTimestamp) && (Date.parse(m.recoveryTimestamp) < Date.parse(m.pitrWindowStart) || Date.parse(m.recoveryTimestamp) > Date.parse(m.pitrWindowEnd))) errors.push('recoveryTimestamp must lie inside the PITR window');
  } else if (m.pitrWindowStart || m.pitrWindowEnd) errors.push('only a pitr_window point carries a PITR window');
  if (typeof m.schemaVersion !== 'string' || !m.schemaVersion.trim() || m.schemaVersion.length > 200) errors.push('schemaVersion (the latest applied migration) is required');
  if (m.appRelease != null && (typeof m.appRelease !== 'string' || m.appRelease.length > 200)) errors.push('appRelease must be a short string');
  for (const f of ['databaseCheckpoint', 'walTimeline'] as const) if (m[f] != null && (typeof m[f] !== 'string' || m[f].length > (f === 'walTimeline' ? 60 : 200))) errors.push(`${f} must be a short string`);
  if (!Array.isArray(m.artifacts) || m.artifacts.length === 0) errors.push('artifacts: at least one stored artifact is required — a point without artifacts is not a backup');
  else {
    if (m.artifacts.length > 200) errors.push('artifacts: at most 200');
    if (!m.artifacts.some((a: any) => a?.kind === 'database')) errors.push('artifacts: a database artifact is required');
    m.artifacts.slice(0, 200).forEach((a: any, i: number) => {
      if (!a || typeof a !== 'object') { errors.push(`artifacts[${i}] must be an object`); return; }
      if (!['database', 'wal', 'objects', 'release'].includes(a.kind)) errors.push(`artifacts[${i}].kind must be database, wal, objects or release`);
      if (typeof a.location !== 'string' || !a.location.trim() || a.location.length > 500) errors.push(`artifacts[${i}].location is required`);
      else if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/i.test(a.location)) errors.push(`artifacts[${i}].location embeds a credential`);
      if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) errors.push(`artifacts[${i}].sha256 must be 64 lower-case hex characters`);
      if (!Number.isSafeInteger(a.sizeBytes) || a.sizeBytes <= 0) errors.push(`artifacts[${i}].sizeBytes must be a positive integer`);
      if (typeof a.keyRef !== 'string' || !a.keyRef.trim() || a.keyRef.length > 200) errors.push(`artifacts[${i}].keyRef (the encryption key reference) is required — unencrypted artifacts are refused`);
      if (a.immutable !== undefined && typeof a.immutable !== 'boolean') errors.push(`artifacts[${i}].immutable must be true or false`);
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: m as RecoveryManifest };
}

// ── retention (§30) ───────────────────────────────────────────────────────────────────────────────────────────────────
export type RetentionClass = 'pitr' | 'daily' | 'weekly' | 'monthly' | 'annual' | 'pre_restore_safety';
export const RETENTION_DAYS: Readonly<Record<RetentionClass, number | null>> = { pitr: 7, daily: 35, weekly: 84, monthly: 366, annual: null, pre_restore_safety: 30 };
/** The class a point falls into by its OWN local timestamp: the longest-kept class whose calendar boundary it sits on. */
export function retentionFor(source: RecoveryManifest['source'], recoveryTs: number, tz = BACKUP_TZ): { cls: RetentionClass; expiresAt: number | null } {
  let cls: RetentionClass;
  if (source === 'pre_restore_safety') cls = 'pre_restore_safety';
  else if (source === 'pitr_window') cls = 'pitr';
  else {
    const p = tzParts(recoveryTs, tz);
    const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    cls = p.m === 1 && p.d === 1 ? 'annual' : p.d === 1 ? 'monthly' : weekday === 0 ? 'weekly' : 'daily';
  }
  const days = RETENTION_DAYS[cls];
  // annual: kept per the approved records policy — no automatic expiry, and no promise of forever either (§30)
  return { cls, expiresAt: days === null ? null : recoveryTs + days * 86_400_000 };
}

// ── planner (§11–13, §17, §25–27) ─────────────────────────────────────────────────────────────────────────────────────
export interface PointView { id: string; scope: 'platform' | 'tenant' | 'branch'; tenantId: string | null; branchId: string | null; source: string; recoveryTimestamp: string;
  pitrWindowStart: string | null; pitrWindowEnd: string | null; schemaVersion: string; appRelease: string | null; verificationStatus: string; expiresAt: string | null; manifestSha256: string }
export interface PostPointActivity {
  payments: { count: number; amountCents: number }; unresolvedPaymentAttempts: number;
  payrollPayouts: { count: number; amountCents: number; checksIssued: number };
  giftCardTransactions: number; loyaltyEntries: number; smsSent: number; outboxEvents: number;
  ticketsChanged: number; appointmentsChanged: number; customersChanged: number;
  sharedCustomersAcrossBranches: number | null; centralIdentityLinks: number;
}
export interface PlanIssue { code: string; message: string }
export interface PlanPreview {
  mode: RestoreMode; tenantId: string | null; branchId: string | null; recoveryPointId: string; targetTimestamp: string; timezone: string;
  point: { recoveryTimestamp: string; schemaVersion: string; appRelease: string | null; manifestSha256: string; verificationStatus: string };
  currentSchemaVersion: string; activity: PostPointActivity | null; blockers: PlanIssue[]; warnings: PlanIssue[];
  financialEventsAfterTarget: number; executable: 'preview_only' | 'blocked';
}

/** Can this mode run HERE, honestly? Destructive production writes are not enabled until the pilots (§47) pass. */
export function modeIssues(mode: RestoreMode): PlanIssue[] {
  if (mode === 'SELECTED_DOMAIN') return [{ code: 'MODE_NOT_SUPPORTED', message: 'Selected-domain restore is not offered: a single domain cannot yet be isolated from its financial and shared dependencies safely (§13). Use a non-destructive preview, or a documented corrective migration.' }];
  if (mode === 'FULL_PLATFORM') return [{ code: 'MODE_REQUIRES_RUNBOOK', message: 'A full-platform recovery is an infrastructure procedure on clean infrastructure (DISASTER_RECOVERY.md §3.2, docs/backup/BACKUP_AND_DR.md §5) — it is not started from this screen.' }];
  return [];
}

export function evaluatePlan(input: {
  mode: RestoreMode; tenantId: string | null; branchId: string | null; point: PointView; targetMs: number; now: number;
  currentSchemaVersion: string; activity: PostPointActivity | null;
}): PlanPreview {
  const { mode, point, targetMs, now, activity } = input;
  const blockers: PlanIssue[] = [...modeIssues(mode)];
  const warnings: PlanIssue[] = [];
  if (point.verificationStatus !== 'VERIFIED') blockers.push({ code: 'POINT_NOT_VERIFIED', message: `This recovery point is ${point.verificationStatus}: only a point a real restore test has proved can be used.` });
  if (point.expiresAt && Date.parse(point.expiresAt) <= now) blockers.push({ code: 'POINT_EXPIRED', message: 'This recovery point is past its retention.' });
  if (point.scope !== 'platform' && point.tenantId !== input.tenantId) blockers.push({ code: 'POINT_SCOPE_MISMATCH', message: 'This recovery point belongs to another tenant.' });
  if (point.scope === 'branch' && point.branchId !== input.branchId) blockers.push({ code: 'POINT_SCOPE_MISMATCH', message: 'This recovery point belongs to another branch.' });
  // the date picker is grounded in the catalog (§17, §38): a snapshot restores to its own instant, PITR only inside its window
  if (point.source === 'pitr_window') {
    if (targetMs < Date.parse(point.pitrWindowStart!) || targetMs > Date.parse(point.pitrWindowEnd!)) blockers.push({ code: 'TARGET_OUTSIDE_COVERAGE', message: 'The requested time is outside this point-in-time recovery window.' });
  } else if (targetMs !== Date.parse(point.recoveryTimestamp)) blockers.push({ code: 'TARGET_OUTSIDE_COVERAGE', message: 'A snapshot restores to its own timestamp only — choose a PITR window for any other time.' });
  if (targetMs > now) blockers.push({ code: 'TARGET_IN_FUTURE', message: 'The requested time is in the future.' });
  // §40 schema boundary: migrations are file names that sort in order (NNN_name.sql)
  if (point.schemaVersion > input.currentSchemaVersion) blockers.push({ code: 'SCHEMA_NEWER_THAN_CURRENT', message: `The point was taken on schema ${point.schemaVersion}, newer than this deployment (${input.currentSchemaVersion}). Restore with a matching release.` });
  else if (point.schemaVersion < input.currentSchemaVersion) warnings.push({ code: 'FORWARD_MIGRATION_REQUIRED', message: `The point is on schema ${point.schemaVersion}; this deployment is on ${input.currentSchemaVersion}. Staged rows are migrated forward before any comparison — never downgrade other tenants.` });
  let financial = 0;
  if (activity) {
    if (activity.unresolvedPaymentAttempts > 0) blockers.push({ code: 'UNRESOLVED_PAYMENT_ATTEMPTS', message: `${activity.unresolvedPaymentAttempts} card attempt(s) are still unresolved with the processor. Reconcile them first — a restore must never make a real payment look unpaid (§25).` });
    financial = activity.payments.count + activity.payrollPayouts.count + activity.giftCardTransactions + activity.loyaltyEntries;
    if (activity.payments.count) warnings.push({ code: 'PAYMENTS_AFTER_TARGET', message: `${activity.payments.count} payment(s) (${(activity.payments.amountCents / 100).toFixed(2)}) were recorded after the requested time. They are real-world money: they are kept and reconciled, never charged again.` });
    if (activity.payrollPayouts.count) warnings.push({ code: 'PAYOUTS_AFTER_TARGET', message: `${activity.payrollPayouts.count} payroll payout(s) (${activity.payrollPayouts.checksIssued} check(s)) after the requested time. A paid check or cash payout is never treated as unpaid (§26).` });
    if (activity.giftCardTransactions) warnings.push({ code: 'GIFT_CARD_ACTIVITY_AFTER_TARGET', message: `${activity.giftCardTransactions} gift-card ledger entr(ies) after the requested time — balances are rebuilt from the reconciled ledger, never from a stale total (§27).` });
    if (activity.loyaltyEntries) warnings.push({ code: 'LOYALTY_ACTIVITY_AFTER_TARGET', message: `${activity.loyaltyEntries} loyalty ledger entr(ies) after the requested time.` });
    if (activity.smsSent || activity.outboxEvents) warnings.push({ code: 'SIDE_EFFECTS_AFTER_TARGET', message: `${activity.smsSent} message(s) sent and ${activity.outboxEvents} event(s) published after the requested time. They are never replayed (§24).` });
    if (activity.ticketsChanged + activity.appointmentsChanged + activity.customersChanged) warnings.push({ code: 'RECORDS_CHANGED_AFTER_TARGET', message: `Changed after the requested time: ${activity.ticketsChanged} ticket(s), ${activity.appointmentsChanged} appointment(s), ${activity.customersChanged} customer(s).` });
    if (activity.sharedCustomersAcrossBranches) warnings.push({ code: 'SHARED_CUSTOMERS', message: `${activity.sharedCustomersAcrossBranches} customer(s) of this branch also visit sibling branches. Shared tenant records are shown as conflicts, never silently overwritten (§12).` });
    if (activity.centralIdentityLinks) warnings.push({ code: 'CENTRAL_IDENTITY_PRESERVED', message: `${activity.centralIdentityLinks} central customer identity link(s): global identities are never replaced by a tenant restore (§09).` });
  }
  return {
    mode, tenantId: input.tenantId, branchId: input.branchId, recoveryPointId: point.id, targetTimestamp: new Date(targetMs).toISOString(), timezone: BACKUP_TZ,
    point: { recoveryTimestamp: point.recoveryTimestamp, schemaVersion: point.schemaVersion, appRelease: point.appRelease, manifestSha256: point.manifestSha256, verificationStatus: point.verificationStatus },
    currentSchemaVersion: input.currentSchemaVersion, activity, blockers, warnings, financialEventsAfterTarget: financial,
    executable: blockers.length ? 'blocked' : 'preview_only',
  };
}

/** The checksum an approval binds to — the plan WITHOUT time-of-reading noise. */
export const planChecksum = (p: PlanPreview): string => sha256Hex(canonicalJson(p));

/** §35: two different people for anything that could write; the approval expires and binds to the plan checksum. */
export function checkApproval(plan: { mode: RestoreMode; requestedBy: string | null; planSha256: string; financialEvents: number }, approver: string | null, presentedSha: string, financeAcknowledged: boolean): PlanIssue | null {
  if (!approver) return { code: 'RESTORE_APPROVER_REQUIRED', message: 'An identified approver is required.' };
  if (presentedSha !== plan.planSha256) return { code: 'RESTORE_PLAN_CHANGED', message: 'The plan changed since you reviewed it. Reload it and review again.' };
  if (plan.mode !== 'NON_DESTRUCTIVE_PREVIEW' && plan.requestedBy && plan.requestedBy === approver) return { code: 'RESTORE_SECOND_PERSON_REQUIRED', message: 'A different operator must approve a restore that can change data.' };
  if (plan.financialEvents > 0 && !financeAcknowledged) return { code: 'RESTORE_FINANCE_ACK_REQUIRED', message: 'Payments, payouts or ledger entries exist after the requested time. Confirm they were reviewed with finance.' };
  return null;
}
