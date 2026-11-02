// request-schemas.ts — BUILD_PLAN Phase 12 (#17): Super Admin event operations (replay preview / run, dead-letter
// discard). A replay names the salon it replays (`tenantId` — kept by the tenant-context middleware for SUPER_ADMIN
// only), so the schema declares it; the replay service checks the window and the consumer.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const replay = { consumerName: str(120), tenantId: str(64), from: str(40), to: str(40), eventType: str(120), eventId: str(64) };
export const REPLAY_PREVIEW_BODY: BodySchema = S.object(replay);
export const REPLAY_RUN_BODY: BodySchema = S.object({ ...replay, token: str(512) });
/** the discard reads no field (admin-web sends {}) */
export const DEAD_LETTER_DISCARD_BODY: BodySchema = S.object({});
