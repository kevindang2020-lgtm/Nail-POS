// request-schemas.ts — BUILD_PLAN Phase 12 (#17): POS global search "result opened" (pos-web posSearchApi).
import { S, type BodySchema } from '@aipowersalon/permissions';

export const SEARCH_OPEN_BODY: BodySchema = S.object({ resultType: S.nullable(S.text(40)), entityId: S.nullable(S.text(64)), q: S.nullable(S.text(500)) });
