// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the loyalty module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). From the controller's rewardBody (the fields read) and pos-web posLoyaltyApi
// (RewardInput, the api-contracts wire type). Unknown fields are stripped; tenantId / permissions are refused.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
/** the service range-checks these numbers (pointsCost ≥ 1, percent 1..100 …) */
const num: BodySchema = S.nullable(S.number());
export const REWARD_BODY: BodySchema = S.object({
  title: str(200), description: str(2000), pointsCost: num, rewardType: str(32), valueCents: num, percent: num, validDays: num, active: S.nullable(S.boolean()),
});
