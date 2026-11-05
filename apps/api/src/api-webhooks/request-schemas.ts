// request-schemas.ts — BUILD_PLAN Phase 12 (#17): tenant API keys + outbound webhooks (pos-web posApiWebhooksApi:
// { name, environment?, scopes?, expiresAt? } and { name, url, events? }). The service normalises scopes to the
// integration allow-list and checks the URL is safe; this declares the shape.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
export const API_KEY_CREATE_BODY: BodySchema = S.object({ name: str(200), environment: str(16), scopes: S.nullable(S.array(S.text(120), { maxItems: 200 })), expiresAt: str(40) });
export const WEBHOOK_CREATE_BODY: BodySchema = S.object({ name: str(200), url: str(2000), events: S.nullable(S.array(S.text(120), { maxItems: 200 })) });
