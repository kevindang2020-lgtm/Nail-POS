// request-schemas.ts — G9 Backup & Disaster Recovery bodies (strict: an unknown field is refused, not stripped).
import { S, type BodySchema } from '@aipowersalon/permissions';

const ARTIFACT: BodySchema = S.strict(S.object({
  kind: S.text(20), location: S.text(500), sha256: S.text(64), sizeBytes: S.integer({ minimum: 0 }), keyRef: S.text(200), immutable: S.nullable(S.boolean()),
}));
/** POST /internal/backups/recovery-points — what the provider's backup job produced (validated again by validateManifest). */
export const RECOVERY_POINT_BODY: BodySchema = S.object({
  backupRef: S.text(200), environment: S.text(40), scope: S.text(20), tenantId: S.nullable(S.text(40)), branchId: S.nullable(S.text(40)),
  source: S.text(40), recoveryTimestamp: S.text(40), pitrWindowStart: S.nullable(S.text(40)), pitrWindowEnd: S.nullable(S.text(40)),
  databaseCheckpoint: S.nullable(S.text(200)), walTimeline: S.nullable(S.text(60)), schemaVersion: S.text(200), appRelease: S.nullable(S.text(200)),
  artifacts: S.array(ARTIFACT, { maxItems: 200 }),
}, ['backupRef', 'environment', 'scope', 'source', 'recoveryTimestamp', 'schemaVersion', 'artifacts']);
/** POST /internal/backups/recovery-points/:id/verification — a restore test's evidence. */
export const POINT_VERIFICATION_BODY: BodySchema = S.object({
  checks: S.strict(S.object({ schema: S.nullable(S.boolean()), data: S.nullable(S.boolean()), checksums: S.nullable(S.boolean()), decrypt: S.nullable(S.boolean()), objects: S.nullable(S.boolean()), smoke: S.nullable(S.boolean()) })),
  detail: S.nullable(S.text(1500)), startedAt: S.nullable(S.text(40)), completedAt: S.nullable(S.text(40)),
}, ['checks']);
export const RESTORE_PLAN_BODY: BodySchema = S.object({
  mode: S.text(30), tenantId: S.nullable(S.uuid()), branchId: S.nullable(S.uuid()), recoveryPointId: S.uuid(), targetTimestamp: S.nullable(S.text(40)),
  reason: S.text(1000), idempotencyKey: S.text(120),
}, ['mode', 'recoveryPointId', 'reason', 'idempotencyKey']);
export const RESTORE_APPROVE_BODY: BodySchema = S.object({ planSha256: S.text(64), financeAcknowledged: S.nullable(S.boolean()) }, ['planSha256']);
export const RESTORE_EXECUTE_BODY: BodySchema = S.object({ planSha256: S.text(64) }, ['planSha256']);
export const RESTORE_CANCEL_BODY: BodySchema = S.object({ reason: S.text(500) }, ['reason']);
