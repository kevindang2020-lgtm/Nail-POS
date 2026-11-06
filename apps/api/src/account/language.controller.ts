// language.controller.ts — BUILD_PLAN Phase 13 (Constitution 6 §97–98, audit bug 11): the signed-in user's app language.
//
// The four mobile apps translate with EN / VI catalogues (@aipowersalon/mobile-sdk i18n). The choice belongs to the USER,
// not the phone: it is stored on the login row (users.preferred_language, migration 560) so it follows them to a new
// device. Every route reads / writes the SESSION's own row only (no id in the path or body). One route per app prefix so
// each request passes that app's guard chain (the same layout as account.controllers.ts): GET {customer|owner|tech|pos}/
// me/locale on every sign-in; PUT owner/me/language from the Owner App's selector (the only language UI today — a route
// no screen calls is a dead route, check:unreached; the other apps' selectors add their PUT with their UI).
import { Body, Controller, Get, HttpException, Put, Req } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { APP_LANGUAGES, isAppLanguage, type AppLanguage, type SetUserLanguageBody, type UserLanguagePreference, type UserLocaleContext } from '@aipowersalon/api-contracts';

export const SET_LANGUAGE_BODY: BodySchema = S.object({ language: S.enumOf(APP_LANGUAGES) }, ['language']);

export class LanguageService {
  constructor(private readonly db: Kysely<DB>) {}
  async get(userId: string): Promise<UserLanguagePreference> {
    const r = await sql<{ preferred_language: string | null }>`select preferred_language from users where id = ${userId}`.execute(this.db);
    const v = r.rows[0]?.preferred_language ?? null;
    return { language: isAppLanguage(v) ? v : null };
  }
  /** §99: the zone business dates are shown in — the session's branch, else the salon's first branch; only a real IANA name. */
  async timeZone(tenantId: string | null | undefined, branchId: string | null | undefined): Promise<string | null> {
    if (!tenantId) return null;
    const r = await sql<{ tz: string | null }>`select b.timezone as tz from branches b
      where b.tenant_id = ${tenantId} and b.timezone in (select name from pg_timezone_names)
      order by (b.id::text = ${branchId ?? ''}) desc, b.created_at limit 1`.execute(this.db);
    return r.rows[0]?.tz ?? null;
  }
  async locale(ctx: { userId: string; tenantId?: string | null; branchId?: string | null }): Promise<UserLocaleContext> {
    return { ...(await this.get(ctx.userId)), timeZone: await this.timeZone(ctx.tenantId, ctx.branchId) };
  }
  async set(userId: string, language: AppLanguage): Promise<UserLanguagePreference> {
    await sql`update users set preferred_language = ${language}, updated_at = now() where id = ${userId}`.execute(this.db);
    return { language };
  }
}

function own(req: any): string {
  const id = req?.ctx?.userId;
  if (!id) throw new HttpException({ ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' }, 401);
  return String(id);
}
function lang(b: unknown): AppLanguage {
  const v = (b as { language?: unknown } | null)?.language;
  if (!isAppLanguage(v)) throw new HttpException({ ok: false, code: 'VALIDATION_FAILED', message: 'Choose English or Vietnamese.' }, 400);
  return v;
}

@Controller()
export class LanguageController {
  constructor(private readonly svc: LanguageService) {}
  @Get('customer/me/locale') async customerGet(@Req() r: any): Promise<UserLocaleContext> { return this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); }
  @RequirePermission('self.profile.view') @Get('owner/me/locale') async ownerGet(@Req() r: any): Promise<UserLocaleContext> { return this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); }
  @RequirePermission('self.profile.edit') @Put('owner/me/language') async ownerPut(@Req() r: any, @Body(ValidatedBody(SET_LANGUAGE_BODY)) b: SetUserLanguageBody): Promise<UserLanguagePreference> { return this.svc.set(own(r), lang(b)); }
  @RequirePermission('self.profile.view') @Get('tech/me/locale') async techGet(@Req() r: any): Promise<UserLocaleContext> { return this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); }
  @RequirePermission('self.profile.view') @Get('pos/me/locale') async posGet(@Req() r: any): Promise<UserLocaleContext> { return this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); }
  // Nov 5 2026: the POS LanguageSwitch (apps/pos-web/src/shell/LanguageSwitch.tsx) saves here — it called this route and got a 404.
  @RequirePermission('self.profile.edit') @Put('pos/me/language') async posPut(@Req() r: any, @Body(ValidatedBody(SET_LANGUAGE_BODY)) b: SetUserLanguageBody): Promise<UserLanguagePreference> { return this.svc.set(own(r), lang(b)); }
}
