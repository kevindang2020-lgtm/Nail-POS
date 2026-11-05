// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the OAuth 2.0 endpoints' bodies (RFC 6749 / 7636 / 7009 parameter
// names, snake_case as the RFCs spell them). pos-web OAuthConsentScreen posts the authorize parameters it was opened
// with; third-party clients post the token / revoke forms. The OAuth service keeps every protocol rule.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 500): BodySchema => S.nullable(S.text(max));
export const OAUTH_AUTHORIZE_BODY: BodySchema = S.object({ client_id: str(200), redirect_uri: str(2000), scope: str(2000), state: str(2000), code_challenge: str(256), code_challenge_method: str(16), response_type: str(32) });
export const OAUTH_TOKEN_BODY: BodySchema = S.object({ grant_type: str(64), client_id: str(200), client_secret: str(512), code: str(512), redirect_uri: str(2000), code_verifier: str(256), refresh_token: str(1024) });
export const OAUTH_REVOKE_BODY: BodySchema = S.object({ token: str(2048), token_type_hint: str(32), client_id: str(200), client_secret: str(512) });
