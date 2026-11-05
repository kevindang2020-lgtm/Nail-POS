// request-schemas.ts — BUILD_PLAN Phase 12 (#17): Super Admin project-status recheck by module key.
import { S, type BodySchema } from '@aipowersalon/permissions';

export const RECHECK_MODULE_BODY: BodySchema = S.object({ moduleKey: S.nullable(S.text(120)) });
