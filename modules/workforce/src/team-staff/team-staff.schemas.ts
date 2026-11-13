// team-staff.schemas.ts — strict request bodies for Team Management round 2 (30 Oct 2026): all-role onboarding (TM-06),
// optional birthdays (TM-08) and training & certification (TM-09). The repositories keep every authority rule; these
// refuse malformed input first. Tenant and branch never travel in a body (the session owns them).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const ymd: BodySchema = S.nullable(S.text(10));

export const TS_ONBOARD_BODY: BodySchema = S.object({
  role: S.text(80), fullName: S.text(200), email: str(254), phone: str(40),
  branchIds: S.nullable(S.array(S.text(64), { maxItems: 50 })), idempotencyKey: S.text(100), channel: str(10),
}, ['role', 'fullName', 'idempotencyKey']);

export const TS_BIRTHDAY_BODY: BodySchema = S.object({
  month: S.nullable(S.integer({ minimum: 1, maximum: 12 })), day: S.nullable(S.integer({ minimum: 1, maximum: 31 })), visibleToTeam: S.nullable(S.boolean()),
}, ['month', 'day']);

export const TS_COURSE_BODY: BodySchema = S.object({
  name: S.text(120), category: str(60), description: str(1000), validityMonths: S.nullable(S.integer({ minimum: 1, maximum: 120 })), certificationName: str(120),
}, ['name']);
export const TS_COURSE_ARCHIVE_BODY: BodySchema = S.object({ expectedVersion: S.number(), reason: S.text(1000) }, ['expectedVersion', 'reason']);
export const TS_ASSIGN_BODY: BodySchema = S.object({ memberId: S.text(64), courseId: S.text(64), dueDate: ymd }, ['memberId', 'courseId']);
export const TS_START_BODY: BodySchema = S.object({ expectedVersion: S.number() }, ['expectedVersion']);
export const TS_COMPLETE_BODY: BodySchema = S.object({ expectedVersion: S.number(), completedOn: ymd, note: str(1000) }, ['expectedVersion']);
export const TS_CANCEL_BODY: BodySchema = S.object({ expectedVersion: S.number(), reason: S.text(1000) }, ['expectedVersion', 'reason']);
export const TS_CERT_BODY: BodySchema = S.object({
  memberId: S.text(64), name: S.text(120), issuer: str(120), credentialRef: str(120), issuedOn: ymd, expiresOn: ymd, assignmentId: str(64),
}, ['memberId', 'name']);
export const TS_CERT_VERIFY_BODY: BodySchema = S.object({ expectedVersion: S.number(), decision: S.enumOf(['VERIFIED', 'REJECTED', 'REVOKED']), note: S.text(1000) }, ['expectedVersion', 'decision', 'note']);
/** round 11 (extras 200-Technician 08): bulk invite — the selected member ids (the ceiling of 200 is enforced in the
 *  repository with a clear message), the run key (a retry with the same key never sends twice), and the salon switch */
export const TS_BULK_INVITE_PREVIEW_BODY: BodySchema = S.object({ memberIds: S.array(S.text(64), { maxItems: 250 }) }, ['memberIds']);
export const TS_BULK_INVITE_RUN_BODY: BodySchema = S.object({ memberIds: S.array(S.text(64), { maxItems: 250 }), runKey: S.text(200) }, ['memberIds', 'runKey']);
export const TS_BULK_INVITE_SETTING_BODY: BodySchema = S.object({ enabled: S.boolean() }, ['enabled']);
