// request-schemas.ts — BUILD_PLAN Phase 13 B: the Super Admin version-policy body (admin-web MobileVersionsScreen). The
// service validates the values themselves (normaliseVersionPolicy in @aipowersalon/api-contracts); this caps the shape.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
export const MOBILE_VERSION_BODY: BodySchema = S.object({
  minSupported: str(40), recommended: str(40), latest: str(40), storeUrl: str(500), message: str(300),
  reason: str(500), expectedVersion: S.nullable(S.number()),
});
