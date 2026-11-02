// language.pgtest — BUILD_PLAN Phase 13 (Constitution 6 §97–98, audit bug 11): the user's app language, persisted on the
// login row (migration 560) and read / written ONLY for the session's own user, in every realm.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { LanguageService, LanguageController } from './language.controller';

let pg: any; let db: any; let svc: LanguageService;
const U1 = '00000000-0000-4000-8000-0000000000a1';
const U2 = '00000000-0000-4000-8000-0000000000a2';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); svc = new LanguageService(db);
  await pg.exec(`INSERT INTO users (id, tenant_id, email, status, role, mfa_enabled, must_change_password) VALUES
    ('${U1}', NULL, 'u1@example.test', 'active', 'CUSTOMER', false, false), ('${U2}', NULL, 'u2@example.test', 'active', 'TECHNICIAN', false, false)`);
});
const req = (userId: string | null) => ({ ctx: userId ? { userId } : null });

describe('user language preference', () => {
  it('never chosen → null (the app follows the device; English is the default)', async () => {
    expect(await new LanguageController(svc).customerGet(req(U1))).toEqual({ language: 'en', timeZone: null });   // the Customer App is English (Kevin, Oct 28 2026)
  });
  it('set (the stored preference, as the POS writes it) → read back; only the caller\'s own row changes', async () => {
    expect(await svc.set(U1, 'vi')).toEqual({ language: 'vi' });
    expect(await new LanguageController(svc).customerGet(req(U1))).toMatchObject({ language: 'en' });   // a stored 'vi' does not change the Customer App (customers are English)
    expect(await new LanguageController(svc).techGet(req(U2))).toMatchObject({ language: 'en' });   // Tech App: English (Kevin, Oct 28 2026)
    const rows = (await pg.query(`SELECT id, preferred_language FROM users WHERE id IN ('${U1}', '${U2}') ORDER BY id`)).rows;
    expect(rows.map((r: any) => r.preferred_language)).toEqual(['vi', null]);
  });
  it('an unsupported language is refused (400), and the database refuses it too', async () => {
    await expect(new LanguageController(svc).posPut(req(U2), { language: 'fr' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(pg.exec(`UPDATE users SET preferred_language = 'xx' WHERE id = '${U2}'`)).rejects.toThrow();
  });
  it('§99: the business time zone is the SESSION branch\'s, else the salon\'s first branch; a bogus zone is never returned', async () => {
    const T = '00000000-0000-4000-8000-0000000000b1';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'TZ LLC', 'TZ', 'tz-t', 'TZT01', 'active') ON CONFLICT DO NOTHING`);
    const [b1, b2] = ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2'];
    await pg.exec(`INSERT INTO branches (id, tenant_id, name, timezone, created_at) VALUES
      ('${b1}', '${T}', 'Main', 'America/New_York', now() - interval '2 days'), ('${b2}', '${T}', 'West', 'America/Los_Angeles', now())`);
    const c = new LanguageController(svc);
    expect((await c.techGet({ ctx: { userId: U2, tenantId: T, branchId: b2 } })).timeZone).toBe('America/Los_Angeles');
    expect((await c.techGet({ ctx: { userId: U2, tenantId: T, branchId: null } })).timeZone).toBe('America/New_York');
    await pg.exec(`UPDATE branches SET timezone = 'Mars/Olympus' WHERE id = '${b2}'`);
    expect((await c.techGet({ ctx: { userId: U2, tenantId: T, branchId: b2 } })).timeZone).toBe('America/New_York');
  });
  it('no session → 401, never a write', async () => {
    await expect(new LanguageController(svc).posPut(req(null), { language: 'en' })).rejects.toMatchObject({ status: 401 });
  });
  it('every route is guarded: staff prefixes need self.profile.*, the customer prefix sits behind the customer realm', () => {
    const src = readFileSync(join(process.cwd(), 'src/account/language.controller.ts'), 'utf8');
    for (const p of ['owner', 'tech', 'pos']) expect(src).toMatch(new RegExp(`@RequirePermission\\('self\\.profile\\.view'\\) @Get\\('${p}/me/locale'\\)`));
    expect(src).toMatch(/@RequirePermission\('self\.profile\.edit'\) @Put\('pos\/me\/language'\)/);
    expect(src).not.toMatch(/@Put\('owner\/me\/language'\)/);   // removed Oct 28 2026: the Owner App is English only
  });
});

// Oct 21 2026 (Kevin: "let tenants have options to switch from English and Vietnamese"): the POS reads the salon's default
// (Settings → Business → defaultLanguage) for staff who never chose a language; a person's own choice always wins; the
// salon-wide row beats a branch row; another salon's default is never read; the POS topbar's PUT writes the user's row.
describe('POS: the salon default and the user\'s own choice', () => {
  const T = 'd1a00000-0000-4000-8000-0000000000b1', T2 = 'd1a00000-0000-4000-8000-0000000000b2', B = 'd1a00000-0000-4000-8000-0000000000c1';
  const U3 = 'd1a00000-0000-4000-8000-0000000000a3', U4 = 'd1a00000-0000-4000-8000-0000000000a4';
  beforeAll(async () => {
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'L', 'Lang Salon', 'lang-s', 'LANG1', 'active'), ('${T2}', 'O', 'Other', 'other-s', 'OTHR1', 'active')`);
    await pg.exec(`INSERT INTO users (id, tenant_id, email, status, role, mfa_enabled, must_change_password) VALUES ('${U3}', '${T}', 'u3@example.test', 'active', 'RECEPTION', false, false), ('${U4}', '${T}', 'u4@example.test', 'active', 'RECEPTION', false, false)`);
    await pg.exec(`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T2}', NULL, 'business-branch', '{"defaultLanguage":"vi"}'::jsonb)`);
  });
  const posReq = (userId: string, tenantId = T, branchId: string | null = B) => ({ ctx: { userId, tenantId, branchId } });
  it('no salon default, no choice → language null (device decides); another salon\'s "vi" is never read', async () => {
    expect(await new LanguageController(svc).posGet(posReq(U3))).toMatchObject({ language: null, salonDefault: null });
  });
  it('the owner sets the salon default to Vietnamese → every staff member who never chose sees Vietnamese; a person\'s own choice wins', async () => {
    await pg.exec(`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}', NULL, 'business-branch', '{"salonName":"Lang Salon","defaultLanguage":"vi"}'::jsonb)`);
    expect(await new LanguageController(svc).posGet(posReq(U3))).toMatchObject({ language: 'vi', salonDefault: 'vi' });
    expect(await new LanguageController(svc).posPut(posReq(U4), { language: 'en' })).toEqual({ language: 'en' });   // the POS topbar switch
    expect(await new LanguageController(svc).posGet(posReq(U4))).toMatchObject({ language: 'en', salonDefault: 'vi' });
    expect(await new LanguageController(svc).posGet(posReq(U3))).toMatchObject({ language: 'vi' });   // U4's choice changed nothing for U3
  });
  it("Kevin (Oct 28 2026): only the POS is bilingual — the Owner and Tech apps answer English even at a Vietnamese salon", async () => {
    const c = new LanguageController(svc);
    expect(await c.techGet(posReq(U3))).toMatchObject({ language: 'en' });
    expect(await c.ownerGet(posReq(U3))).toMatchObject({ language: 'en' });
    expect(await c.posGet(posReq(U3))).toMatchObject({ language: 'vi' });   // the POS still follows the salon default
  });
  it('a bad default stored in the JSON is ignored (never a language the app does not have)', async () => {
    await pg.exec(`UPDATE tenant_settings SET settings_json = '{"defaultLanguage":"fr"}'::jsonb WHERE tenant_id = '${T}' AND category = 'business-branch'`);
    expect(await new LanguageController(svc).posGet(posReq(U3))).toMatchObject({ language: null, salonDefault: null });
  });
});

// Vietnamese POS mandate WP-A (§13 conflict, §93, §102 server half): ONE authority for the salon's default POS language —
// the salon-wide Business & Branch row's defaultLanguage (migration 695). The Super Admin sets it (PUT super-admin/tenants/
// :id/pos-language, step-up, tenants.edit, audited); the owner still sets it in POS Settings (saved on the BRANCH row — the
// trigger lifts it to the authority); tenants.locale is a derived copy. A person's own choice is never overridden.
describe('WP-A: tenant default POS language authority + Super Admin control', () => {
  const TA = 'a7a00000-0000-4000-8000-0000000000b1', TB = 'a7a00000-0000-4000-8000-0000000000b2', TC = 'a7a00000-0000-4000-8000-0000000000b3';
  const BA = 'a7a00000-0000-4000-8000-0000000000c1', BC = 'a7a00000-0000-4000-8000-0000000000c3';
  const UA1 = 'a7a00000-0000-4000-8000-0000000000a1', UA2 = 'a7a00000-0000-4000-8000-0000000000a2', UA3 = 'a7a00000-0000-4000-8000-0000000000a3';
  const UB1 = 'a7a00000-0000-4000-8000-0000000000a4', UC1 = 'a7a00000-0000-4000-8000-0000000000a5', SA = 'a7a00000-0000-4000-8000-0000000000ff';
  let sa: any; let Err: any;
  beforeAll(async () => {
    const mod = await import('@aipowersalon/super-admin');
    sa = new mod.TenantPosLanguageService(db); Err = mod.TenantPosLanguageError;
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
      ('${TA}', 'A', 'Salon A', 'wpa-a', 'WPAA1', 'active'), ('${TB}', 'B', 'Salon B', 'wpa-b', 'WPAB1', 'active'), ('${TC}', 'C', 'Salon C', 'wpa-c', 'WPAC1', 'active')`);
    await pg.exec(`INSERT INTO branches (id, tenant_id, name, timezone) VALUES ('${BA}', '${TA}', 'Main', 'America/New_York'), ('${BC}', '${TC}', 'Main', 'America/New_York')`);
    await pg.exec(`INSERT INTO users (id, tenant_id, email, status, role, mfa_enabled, must_change_password, preferred_language) VALUES
      ('${UA1}', '${TA}', 'wa1@example.test', 'active', 'RECEPTION', false, false, NULL),
      ('${UA2}', '${TA}', 'wa2@example.test', 'active', 'MANAGER', false, false, 'en'),
      ('${UB1}', '${TB}', 'wb1@example.test', 'active', 'RECEPTION', false, false, NULL),
      ('${UC1}', '${TC}', 'wc1@example.test', 'active', 'RECEPTION', false, false, NULL),
      ('${SA}', NULL, 'sa@example.test', 'active', 'SUPER_ADMIN', false, false, NULL)`);
  });
  const pos = (userId: string, tenantId: string, branchId: string | null = null) => new LanguageController(svc).posGet({ ctx: { userId, tenantId, branchId } });
  const locale = async (t: string) => (await pg.query(`SELECT locale FROM tenants WHERE id = '${t}'`)).rows[0].locale;
  const audits = async (t: string) => (await pg.query(`SELECT user_id, role, action_type, before_json, after_json FROM settings_audit_logs WHERE tenant_id = '${t}' AND action_type = 'pos_settings_default_language_updated' ORDER BY created_at`)).rows;

  it('never set → language null, effective English; the Super Admin view says so', async () => {
    expect(await sa.get(TA)).toEqual({ tenantId: TA, language: null, effective: 'en', staffWithOwnChoice: { en: 1, vi: 0 }, updatedAt: null });
    expect(await pos(UA1, TA, BA)).toMatchObject({ language: null, salonDefault: null });
  });
  it('Super Admin sets Vietnamese → staff without a choice get vi; a person who chose English keeps English; another salon untouched', async () => {
    const out = await sa.set(TA, 'vi', { userId: SA, ip: '10.0.0.9' }, 'Owner asked by phone');
    expect(out).toMatchObject({ tenantId: TA, language: 'vi', effective: 'vi', changed: true });
    expect(await pos(UA1, TA, BA)).toMatchObject({ language: 'vi', salonDefault: 'vi' });
    expect(await pos(UA2, TA, BA)).toMatchObject({ language: 'en', salonDefault: 'vi' });          // explicit preference wins
    expect((await pg.query(`SELECT preferred_language FROM users WHERE id = '${UA2}'`)).rows[0].preferred_language).toBe('en');   // never rewritten
    expect(await pos(UB1, TB)).toMatchObject({ language: null, salonDefault: null });               // isolation
    expect(await locale(TA)).toBe('vi-VN'); expect(await locale(TB)).toBeNull();                    // derived copy follows
  });
  it('a NEW staff member (no choice yet) inherits the salon default', async () => {
    await pg.exec(`INSERT INTO users (id, tenant_id, email, status, role, mfa_enabled, must_change_password) VALUES ('${UA3}', '${TA}', 'wa3@example.test', 'active', 'TECHNICIAN', false, false)`);
    expect(await pos(UA3, TA, BA)).toMatchObject({ language: 'vi' });
  });
  it('the change is audited (actor, old → new, Super Admin role) in the salon\'s own settings trail; a no-op change writes nothing', async () => {
    expect(await audits(TA)).toEqual([expect.objectContaining({ user_id: SA, role: 'SUPER_ADMIN', before_json: { defaultLanguage: null }, after_json: { defaultLanguage: 'vi' } })]);
    expect(await sa.set(TA, 'vi', { userId: SA })).toMatchObject({ changed: false });
    expect(await audits(TA)).toHaveLength(1);
    expect(await audits(TB)).toHaveLength(0);
  });
  it('refusals: an unsupported language (fr) and an unknown tenant change nothing', async () => {
    await expect(sa.set(TA, 'fr', { userId: SA })).rejects.toBeInstanceOf(Err);
    await expect(sa.set(TA, 'fr', { userId: SA })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(sa.set('a7a00000-0000-4000-8000-00000000dead', 'en', { userId: SA })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(sa.get('not-a-uuid')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await sa.get(TA)).language).toBe('vi');
  });
  it('the owner\'s POS Settings save (BRANCH row) is lifted to the authority: English everywhere, branch rows and tenants.locale in step', async () => {
    await pg.exec(`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${TA}', '${BA}', 'business-branch', '{"timezone":"America/New_York","defaultLanguage":"en"}'::jsonb)`);
    expect((await sa.get(TA)).language).toBe('en');
    expect(await pos(UA1, TA, BA)).toMatchObject({ language: 'en', salonDefault: 'en' });
    expect(await locale(TA)).toBe('en-US');
    await sa.set(TA, 'vi', { userId: SA });                                                          // and back: the branch row mirrors
    const rows = (await pg.query(`SELECT branch_id, settings_json->>'defaultLanguage' AS l, settings_json->>'timezone' AS tz FROM tenant_settings WHERE tenant_id = '${TA}' AND category = 'business-branch' ORDER BY branch_id NULLS FIRST`)).rows;
    expect(rows.map((r: any) => r.l)).toEqual(['vi', 'vi']);
    expect(rows[1].tz).toBe('America/New_York');                                                     // the owner's other settings kept
  });
  it('migration 695 back-fill: a default saved only on a branch row (behind a salon-wide row without one) becomes the authority; a stray tenants.locale is replaced', async () => {
    await pg.exec(`ALTER TABLE tenant_settings DISABLE TRIGGER trg_tenant_pos_language`);
    await pg.exec(`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES
      ('${TC}', NULL, 'business-branch', '{"salonName":"Salon C"}'::jsonb), ('${TC}', '${BC}', 'business-branch', '{"defaultLanguage":"vi"}'::jsonb)`);
    await pg.exec(`UPDATE tenants SET locale = 'fr-FR' WHERE id = '${TC}'`);
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, '695_tenant_pos_language_authority.sql'), 'utf8'));   // idempotent re-run
    expect(await sa.get(TC)).toMatchObject({ language: 'vi' });
    expect((await pg.query(`SELECT settings_json->>'salonName' AS n FROM tenant_settings WHERE tenant_id = '${TC}' AND branch_id IS NULL AND category = 'business-branch'`)).rows[0].n).toBe('Salon C');
    expect(await locale(TC)).toBe('vi-VN');
    expect(await pos(UC1, TC, BC)).toMatchObject({ language: 'vi' });
    expect(await locale(TB)).toBeNull();
  });
  it('the Super Admin routes: GET needs tenants.view; PUT needs tenants.edit AND a step-up (controller behaviour: tenant-pos-language.vitest)', () => {
    const src = readFileSync(join(process.cwd(), '../../modules/super-admin/src/super-admin-tenants/super-admin-tenants.controller.ts'), 'utf8');
    expect(src).toMatch(/@RequirePermission\('super_admin\.tenants\.view'\)\s*@Get\('tenants\/:id\/pos-language'\)/);
    expect(src).toMatch(/@RequireStepUp\(\)[^\n]*\n\s*@RequirePermission\('super_admin\.tenants\.edit'\)\s*@Put\('tenants\/:id\/pos-language'\)/);
  });
});
