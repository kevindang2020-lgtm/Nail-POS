// request-schemas.ts — BUILD_PLAN Phase 12 (#17): bodies of the routes defined in apps/api/src/common — step-up
// re-authentication (pos-web posStepUpApi, admin-web StepUpHost: { password, code? }) and the Super Admin feature-flag
// rollout (admin-web FeatureRegistryScreen). The flag service normalises the rollout and checks the version itself.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
export const STEP_UP_BODY: BodySchema = S.object({ password: str(1024), code: { type: ['string', 'number', 'null'], maxLength: 16 } });
export const FLAG_ROLLOUT_BODY: BodySchema = S.object({
  rolloutPercent: { type: ['number', 'string', 'null'], maxLength: 8 }, allowTenantIds: S.nullable(S.array(S.text(64), { maxItems: 10000 })),
  denyTenantIds: S.nullable(S.array(S.text(64), { maxItems: 10000 })), killed: S.nullable(S.boolean()), reason: str(2000), expectedVersion: S.nullable(S.number()),
});
