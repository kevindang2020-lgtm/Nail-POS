// request-schemas.ts — BUILD_PLAN Phase 12 (#17): observability bodies — the backup / restore-drill report (the backup
// job's contract, validateReport keeps the rules), the browser error report (every app's client-telemetry reporter;
// parseReport drops what it cannot use, so the types here are deliberately wide — an error reporter must not fail on a
// field it would have ignored), and the Super Admin capacity controls (admin-web SystemOpsCapacity).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const wide = (max = 20000): BodySchema => ({ type: ['string', 'number', 'boolean', 'null'], maxLength: max });
const bool: BodySchema = S.nullable(S.boolean());
export const BACKUP_REPORT_BODY: BodySchema = S.object({
  kind: str(20), status: str(20), startedAt: str(40), completedAt: str(40), sizeBytes: S.nullable(S.number()), pitrEnabled: bool, integrityOk: bool, smokeTestOk: bool, detail: str(4000),
});
export const CLIENT_ERROR_BODY: BodySchema = S.object({ app: wide(40), kind: wide(40), message: wide(), stack: wide(), route: wide(2000), version: wide(200), requestId: wide(200), platform: wide(40) });
// BUILD_PLAN Phase 13 (C6 §116–119): the analytics / perf batch. Wide on purpose (as above): the shared allowlist
// (api-contracts sanitizeTelemetryBatch) drops what it cannot use; this only bounds sizes.
const EVENT_ITEM: BodySchema = S.object({ name: wide(64), props: S.nullable(S.freeObject()), at: S.nullable(S.number()) });
const PERF_ITEM: BodySchema = S.object({ metric: wide(64), ms: { type: ['number', 'string', 'null'], maxLength: 32 }, labels: S.nullable(S.freeObject()) });
export const CLIENT_EVENTS_BODY: BodySchema = S.object({
  app: wide(40), version: wide(200), platform: wide(40),
  events: S.nullable(S.array(EVENT_ITEM, { maxItems: 200 })), perf: S.nullable(S.array(PERF_ITEM, { maxItems: 200 })),
});
export const COST_PRICES_BODY: BodySchema = S.object({
  prices: S.nullable(S.array(S.object({ key: str(120), usd: { type: ['number', 'string', 'null'], maxLength: 32 } }), { maxItems: 100 })), reason: str(2000),
});
const quota: BodySchema = { type: ['number', 'string', 'null'], maxLength: 24 };
export const QUOTA_BODY: BodySchema = S.object({ api_requests_per_min: quota, jobs_in_flight: quota, storage_bytes: quota, reason: str(2000) });
