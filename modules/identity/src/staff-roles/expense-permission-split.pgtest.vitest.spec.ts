// expense-permission-split.pgtest — F7 §73 (Nov 6 2026; migration 825): splitting owner.expenses.manage into
// delete_draft / archive / bills.manage takes access from NOBODY — saved custom roles and live per-user overrides that name
// owner.expenses.manage get the three keys with the same effect; running the migration again changes nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite } from '@aipowersalon/testing';
import { permissionsFor, templatePermissions, DEFAULT_ROLE_TEMPLATES } from '@aipowersalon/permissions';

const MIG = readFileSync(join(MIGRATIONS_DIR, '825_expense_permission_split.sql'), 'utf8');
const SPLIT = ['owner.expenses.delete_draft', 'owner.expenses.archive', 'owner.expenses.bills.manage'];
const T = 'c8250000-0000-4000-8000-000000000001', U1 = 'c8250000-0000-4000-8000-000000000011', U2 = 'c8250000-0000-4000-8000-000000000012', OWN = 'c8250000-0000-4000-8000-000000000010';
let pg: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','S','split-825','SPL825','active')`, [T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$4,'Owner','o@825.test','active','OWNER'), ($2,$4,'Mgr','m@825.test','active','MANAGER'), ($3,$4,'Mgr2','m2@825.test','active','MANAGER')`, [OWN, U1, U2, T]);
  await q(`insert into tenant_custom_roles (tenant_id, name, base_role, scope, permissions) values
    ($1, 'Bookkeeper', 'MANAGER', 'TENANT', '["owner.expenses.view","owner.expenses.manage"]'::jsonb),
    ($1, 'Viewer', 'MANAGER', 'TENANT', '["owner.expenses.view"]'::jsonb)`, [T]);
  await q(`insert into tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, granted_by_user_id) values
    ($1, $2, 'owner.expenses.manage', 'ALLOW', 'covers expenses while the owner travels', $4), ($1, $3, 'owner.expenses.manage', 'DENY', 'no spending records', $4)`, [T, U1, U2, OWN]);
}, 240_000);

describe('F7 §73 — the expense permission split takes access from nobody', () => {
  it('ES-01 the OWNER and MANAGER base sets (and so every default template except Accountant) carry the three keys', () => {
    for (const r of ['OWNER', 'MANAGER'] as const) expect(permissionsFor(r)).toEqual(expect.arrayContaining(SPLIT));
    const acct = DEFAULT_ROLE_TEMPLATES.find((t) => t.key === 'ACCOUNTANT')!;
    expect(templatePermissions(acct).filter((p) => SPLIT.includes(p))).toEqual([]);   // read + export only, as before
  });
  it('ES-02 a saved custom role with owner.expenses.manage gains the keys; one without it does not', async () => {
    await pg.exec(MIG);
    const rows = await q(`select name, permissions from tenant_custom_roles where tenant_id = $1 order by name`, [T]);
    expect(rows[0].permissions).toEqual(expect.arrayContaining(['owner.expenses.manage', ...SPLIT]));
    expect(rows[1].permissions).toEqual(['owner.expenses.view']);
  });
  it('ES-03 per-user overrides carry over with the same effect (ALLOW stays allowed, DENY stays denied); a second run adds nothing', async () => {
    const live = async () => q(`select user_id, permission, effect from tenant_user_permission_overrides where tenant_id = $1 and revoked_at is null order by user_id, permission`, [T]);
    const after = await live();
    expect(after.filter((r: any) => r.user_id === U1).map((r: any) => [r.permission, r.effect])).toEqual(
      [['owner.expenses.archive', 'ALLOW'], ['owner.expenses.bills.manage', 'ALLOW'], ['owner.expenses.delete_draft', 'ALLOW'], ['owner.expenses.manage', 'ALLOW']]);
    expect(after.filter((r: any) => r.user_id === U2).every((r: any) => r.effect === 'DENY')).toBe(true);
    expect(after).toHaveLength(8);
    await pg.exec(MIG);
    expect(await live()).toHaveLength(8);
  });
});
