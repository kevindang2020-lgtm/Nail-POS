// request-schemas.ts — BUILD_PLAN Phase 12 (#17): realtime presence report (the shared realtime client: { connectionId, state }).
import { S, type BodySchema } from '@aipowersalon/permissions';

export const PRESENCE_BODY: BodySchema = S.object({ connectionId: S.nullable(S.text(200)), state: S.nullable(S.text(20)) });
