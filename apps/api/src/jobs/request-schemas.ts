// request-schemas.ts — BUILD_PLAN Phase 12 (#17): Super Admin job queue actions (admin-web superAdminJobsApi).
import { S, type BodySchema } from '@aipowersalon/permissions';

export const JOB_SELF_TEST_BODY: BodySchema = S.object({ count: { type: ['number', 'string', 'null'], maxLength: 8 }, holdMs: { type: ['number', 'string', 'null'], maxLength: 8 } });
export const JOB_ACTION_BODY: BodySchema = S.object({ reason: S.nullable(S.text(1000)) }, [], { 'x-forbidden': ['status'] });
