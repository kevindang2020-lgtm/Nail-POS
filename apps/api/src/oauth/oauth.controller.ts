// oauth.controller.ts — Constitution 3 §79 (Step 10d): the authorization server's endpoints.
//   GET  /oauth/authorize              (owner session) → what the consent screen shows, after validating the request
//   POST /oauth/authorize              (owner session) → approve → { redirect } back to the app with ?code=&state=
//   POST /oauth/token                  (public)        → authorization_code (+PKCE) | refresh_token (rotating)
//   POST /oauth/revoke                 (public)        → RFC 7009, always 200
//   GET  /pos/connected-apps           (owner)         → the salon's connected apps
//   POST /pos/connected-apps/:id/revoke (owner)        → disconnect: the grant and every token end
// Only an OWNER (settings.edit) may connect an app to the salon.
import { Body, Controller, Get, HttpCode, HttpException, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { DATABASE } from '@aipowersalon/database';
import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { OAuthService, OAuthError, type AuthorizeRequest } from './oauth.service';
import { OAUTH_AUTHORIZE_BODY, OAUTH_REVOKE_BODY, OAUTH_TOKEN_BODY } from './request-schemas';

function svcOf(db: any): OAuthService { if (!db) throw new HttpException({ error: 'temporarily_unavailable' }, 503); return new OAuthService(db); }
async function run<T>(fn: () => Promise<T>, tokenEndpoint = false): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof OAuthError) throw new HttpException(tokenEndpoint ? { error: e.code, error_description: e.message } : { ok: false, code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const reqOf = (q: any): AuthorizeRequest => ({ clientId: String(q?.client_id ?? ''), redirectUri: String(q?.redirect_uri ?? ''), scope: String(q?.scope ?? ''), state: q?.state ? String(q.state).slice(0, 500) : undefined, codeChallenge: String(q?.code_challenge ?? ''), codeChallengeMethod: q?.code_challenge_method ? String(q.code_challenge_method) : undefined });
function owner(r: any): { userId: string; tenantId: string } {
  const c = r?.ctx; if (!c?.userId || !c?.tenantId) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401);
  if (c.actorType === 'INTEGRATION') throw new HttpException({ ok: false, code: 'FORBIDDEN', message: 'An integration cannot connect apps.' }, 403);
  return { userId: c.userId, tenantId: c.tenantId };
}

@Controller('oauth')
export class OAuthController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  @Get('authorize') @RequirePermission('settings.edit')
  describe(@Req() r: any, @Query() q: any) { owner(r); return run(() => svcOf(this.db).describe(reqOf(q))); }
  @Post('authorize') @HttpCode(200) @RequirePermission('settings.edit')
  approve(@Req() r: any, @Body(ValidatedBody(OAUTH_AUTHORIZE_BODY)) b: any) { const o = owner(r); return run(() => svcOf(this.db).approve(reqOf(b), o)); }
  @Post('token') @HttpCode(200)
  token(@Body(ValidatedBody(OAUTH_TOKEN_BODY)) b: any) {
    const svc = svcOf(this.db);
    if (b?.grant_type === 'authorization_code') return run(() => svc.exchangeCode({ clientId: String(b.client_id ?? ''), clientSecret: b.client_secret, code: String(b.code ?? ''), redirectUri: String(b.redirect_uri ?? ''), codeVerifier: String(b.code_verifier ?? '') }), true);
    if (b?.grant_type === 'refresh_token') return run(() => svc.refresh({ clientId: String(b.client_id ?? ''), clientSecret: b.client_secret, refreshToken: String(b.refresh_token ?? '') }), true);
    throw new HttpException({ error: 'unsupported_grant_type', error_description: 'authorization_code or refresh_token' }, 400);
  }
  @Post('revoke') @HttpCode(200)
  async revoke(@Body(ValidatedBody(OAUTH_REVOKE_BODY)) b: any) { if (typeof b?.token === 'string' && this.db) await svcOf(this.db).revokeToken(b.token); return {}; }
}

@Controller('pos/connected-apps')
export class ConnectedAppsController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  @Get() @RequirePermission('settings.edit')
  list(@Req() r: any) { const o = owner(r); return run(async () => ({ apps: await svcOf(this.db).listGrants(o.tenantId) })); }
  @Post(':id/revoke') @HttpCode(200) @RequirePermission('settings.edit')
  revoke(@Req() r: any, @Param('id') id: string) { const o = owner(r); return run(async () => ({ ok: await svcOf(this.db).revokeGrant(o.tenantId, id) })); }
}
