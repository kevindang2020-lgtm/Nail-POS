// language.controller.ts — BUILD_PLAN Phase 13 (Constitution 6 §97–98, audit bug 11): the signed-in user's app language.
//
// The four mobile apps translate with EN / VI catalogues (@aipowersalon/mobile-sdk i18n). The choice belongs to the USER,
// not the phone: it is stored on the login row (users.preferred_language, migration 560) so it follows them to a new
// device. Every route reads / writes the SESSION's own row only (no id in the path or body). One route per app prefix so
// each request passes that app's guard chain (the same layout as account.controllers.ts): GET {customer|owner|tech|pos}/
// me/locale on every sign-in; PUT pos/me/language from the POS topbar's switch. Kevin (Oct 28 2026): only the POS is
// bilingual — the Owner / Tech / Customer locale routes answer English, and PUT owner/me/language was removed.
import { Body, Controller, Get, HttpException, Put, Req } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { APP_LANGUAGES, isAppLanguage, resolveApplicationLocale, type AppLanguage, type SetUserLanguageBody, type UserLanguagePreference, type UserLocaleContext } from '@aipowersalon/api-contracts';

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
  /** The salon's POS default (Settings → Business, `defaultLanguage`, Oct 21 2026). Vietnamese POS mandate WP-A: the ONE
   *  authority is the salon-wide row (migration 695 mirrors it to the branch rows and tenants.locale; the Super Admin sets
   *  it through PUT super-admin/tenants/:id/pos-language); a branch row is read only when no salon-wide value exists (a
   *  database the 695 back-fill never saw). A row without a valid language never hides one that has it. null = never set. */
  async salonDefault(tenantId: string | null | undefined, branchId: string | null | undefined): Promise<AppLanguage | null> {
    if (!tenantId) return null;
    const r = await sql<{ lang: string | null }>`select settings_json->>'defaultLanguage' as lang from tenant_settings
      where tenant_id = ${tenantId} and category = 'business-branch' and (branch_id is null or branch_id::text = ${branchId ?? ''})
        and settings_json->>'defaultLanguage' in ('en', 'vi')
      order by (branch_id is null) desc limit 1`.execute(this.db);
    const v = r.rows[0]?.lang ?? null;
    return isAppLanguage(v) ? v : null;
  }
  /** POS: the user's own choice, else the salon's default (the app falls through to the device, then English). */
  async posLocale(ctx: { userId: string; tenantId?: string | null; branchId?: string | null }): Promise<UserLocaleContext & { salonDefault: AppLanguage | null }> {
    const [mine, salonDefault, timeZone] = await Promise.all([this.get(ctx.userId), this.salonDefault(ctx.tenantId, ctx.branchId), this.timeZone(ctx.tenantId, ctx.branchId)]);
    return { language: mine.language ?? salonDefault, salonDefault, timeZone };
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
  // §58: field + rule beside the English, so the POS words it ("Language must be one of: English, Tiếng Việt.")
  if (!isAppLanguage(v)) throw new HttpException({ ok: false, code: 'VALIDATION_FAILED', message: 'Choose English or Vietnamese.', details: { field: 'language', rule: 'ENUM', params: { allowed: 'English, Tiếng Việt' } } }, 400);
  return v;
}

@Controller()
export class LanguageController {
  constructor(private readonly svc: LanguageService) {}
  // Kevin's ruling (Oct 28 2026): customers are English-speaking — the Customer App is English for every customer (an
  // explicit 'en', so neither a stored preference nor the phone's own language turns its screens Vietnamese). The business
  // time zone is still the salon's.
  @Get('customer/me/locale') async customerGet(@Req() r: any): Promise<UserLocaleContext> { const l = await this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); return { ...l, language: resolveApplicationLocale('CUSTOMER_APP', l.language) }; }
  // Kevin (Oct 28 2026): ONLY the POS is bilingual — the Owner App and the Tech App are English for everyone (an explicit 'en',
  // so neither a saved preference nor the phone's own language turns them Vietnamese). The business time zone is unchanged.
  @RequirePermission('self.profile.view') @Get('owner/me/locale') async ownerGet(@Req() r: any): Promise<UserLocaleContext> { const l = await this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); return { ...l, language: resolveApplicationLocale('OWNER_APP', l.language) }; }
  // PUT owner/me/language removed Oct 28 2026: the Owner App is English only (Kevin), so there is no owner language to save
  @RequirePermission('self.profile.view') @Get('tech/me/locale') async techGet(@Req() r: any): Promise<UserLocaleContext> { const l = await this.svc.locale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); return { ...l, language: resolveApplicationLocale('TECHNICIAN_APP', l.language) }; }
  /** Oct 21 2026 (POS EN / VI): the user's choice, else the salon's default; PUT from the POS topbar's language switch. */
  @RequirePermission('self.profile.view') @Get('pos/me/locale') async posGet(@Req() r: any): Promise<UserLocaleContext> { return this.svc.posLocale({ userId: own(r), tenantId: r?.ctx?.tenantId, branchId: r?.ctx?.branchId }); }
  @RequirePermission('self.profile.edit') @Put('pos/me/language') async posPut(@Req() r: any, @Body(ValidatedBody(SET_LANGUAGE_BODY, { strict: true })) b: SetUserLanguageBody): Promise<UserLanguagePreference> { return this.svc.set(own(r), lang(b)); }
}
