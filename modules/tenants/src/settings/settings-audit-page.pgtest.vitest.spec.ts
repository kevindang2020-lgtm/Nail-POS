// settings-audit-page.pgtest — SUNMI batch 9 guide 20 (Nov 10 2026): the settings change history on the REAL schema —
// newest first (time, then id), search over area / action / who, salon-day From–To, paging, this salon only
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySettingsRepository } from './settings.kysely.repository';
import { PosSettingsService } from './settings.service';

const id = (n: number) => 'a9020000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1), X = id(2), B = id(3), BX = id(4), U = id(5);
let svc: any;
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['settings.view'] };

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC';
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'A LLC', 'A', 'set-b9', 'SETB9', 'active'), ('${X}', 'X LLC', 'X', 'setx-b9', 'SETXB9', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York'), ('${BX}', '${X}', 'Other', 'active', 'America/New_York');
    INSERT INTO users (id, email, full_name, role) VALUES ('${U}', 'owner-b9@example.com', 'Kim Owner', 'OWNER');`);
  const row = (n: number, tenant: string, branch: string | null, area: string, action: string, at: string) =>
    pg.exec(`INSERT INTO settings_audit_logs (id, tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata, created_at)
      VALUES ('${id(n)}', '${tenant}', ${branch ? `'${branch}'` : 'null'}, '${U}', 'OWNER', '${action}', '${area}', '${area}', '{"changedKeys":["taxRatePercent"]}', '${at}')`);
  await row(10, T, B, 'tax', 'pos_settings_tax_updated', '2026-11-08T15:00:00Z');
  await row(11, T, B, 'business_branch', 'pos_settings_business_branch_updated', '2026-11-09T15:00:00Z');
  await row(12, T, null, 'tips', 'pos_settings_tips_updated', '2026-11-10T03:30:00Z');   // Nov 9 in New York
  await row(13, X, BX, 'tax', 'pos_settings_tax_updated', '2026-11-10T15:00:00Z');       // another salon — never shown
  svc = new PosSettingsService(new KyselySettingsRepository(kyselyFor(pg) as any) as any);
}, 180_000);

describe('settings change history', () => {
  it('newest first, this salon only, with who and what changed', async () => {
    const r = await svc.auditPage(ctx, {});
    expect(r.items.map((x: any) => x.area)).toEqual(['tips', 'business_branch', 'tax']);
    expect(r.items[0]).toMatchObject({ actor: 'Kim Owner', changedKeys: ['taxRatePercent'] });
    expect(r.timezone).toBe('America/New_York');
  });
  it('searches area / action / who, filters salon days, and pages', async () => {
    expect((await svc.auditPage(ctx, { q: 'business' })).items.map((x: any) => x.area)).toEqual(['business_branch']);
    expect((await svc.auditPage(ctx, { q: 'kim' })).total).toBe(3);
    expect((await svc.auditPage(ctx, { from: '2026-11-09', to: '2026-11-09' })).items.map((x: any) => x.area)).toEqual(['tips', 'business_branch']);
    const p2 = await svc.auditPage(ctx, { pageSize: 10, page: 1 });
    expect(p2).toMatchObject({ total: 3, page: 1, pageSize: 10 });
  });
});
