// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the account-deletion request bodies (customer-web customerApi,
// owner-web ownerApi, tech-web techApi — { reason?, contactEmail? }), applied with @Body(ValidatedBody(SCHEMA)).
import { S, type BodySchema } from '@aipowersalon/permissions';

export const DELETE_ACCOUNT_REQUEST_BODY: BodySchema = S.object({ reason: S.nullable(S.text(2000)), contactEmail: S.nullable(S.text(254)) });
