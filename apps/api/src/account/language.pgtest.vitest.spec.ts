// language.pgtest — BUILD_PLAN Phase 13 (Constitution 6 §97–98, audit bug 11): the user's app language, persisted on the
// login row (migration 560) and read / written ONLY for the session's own user, in every realm.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
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
    expect(await new LanguageController(svc).customerGet(req(U1))).toEqual({ language: null, timeZone: null });
  });
  it('set (owner selector → PUT owner/me/language) → read back; only the caller\'s own row changes', async () => {
    expect(await svc.set(U1, 'vi')).toEqual({ language: 'vi' });
    expect(await new LanguageController(svc).customerGet(req(U1))).toMatchObject({ language: 'vi' });
    expect(await new LanguageController(svc).techGet(req(U2))).toMatchObject({ language: null });
    const rows = (await pg.query(`SELECT id, preferred_language FROM users WHERE id IN ('${U1}', '${U2}') ORDER BY id`)).rows;
    expect(rows.map((r: any) => r.preferred_language)).toEqual(['vi', null]);
  });
  it('an unsupported language is refused (400), and the database refuses it too', async () => {
    await expect(new LanguageController(svc).ownerPut(req(U2), { language: 'fr' } as any)).rejects.toMatchObject({ status: 400 });
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
    await expect(new LanguageController(svc).ownerPut(req(null), { language: 'en' })).rejects.toMatchObject({ status: 401 });
  });
  it('every route is guarded: staff prefixes need self.profile.*, the customer prefix sits behind the customer realm', () => {
    const src = readFileSync(join(process.cwd(), 'src/account/language.controller.ts'), 'utf8');
    for (const p of ['owner', 'tech', 'pos']) expect(src).toMatch(new RegExp(`@RequirePermission\\('self\\.profile\\.view'\\) @Get\\('${p}/me/locale'\\)`));
    expect(src).toMatch(/@RequirePermission\('self\.profile\.edit'\) @Put\('owner\/me\/language'\)/);
  });
});
