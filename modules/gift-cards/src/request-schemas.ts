// request-schemas.ts — BUILD_PLAN Phase 12 (#17): gift-card stock request bodies (pos-web posGiftCardsApi.register).
import { S, type BodySchema } from '@aipowersalon/permissions';

/** POST /pos/gift-cards/stock/register — { numbers: newline/comma-separated card numbers, batchLabel } */
export const STOCK_REGISTER_BODY: BodySchema = S.object({ numbers: S.nullable(S.text(200_000)), batchLabel: S.nullable(S.text(120)) });
