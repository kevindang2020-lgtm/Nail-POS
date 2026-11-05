// copilot-settings.pgtest — the Reception Copilot settings hierarchy against the real schema.
//
// Unlike Skip-the-Line, this reader fails LOUDLY: readRow has no catch, and the only catches are on the cache
// layer, where a miss falls through to the database. So there is no fail-open to fix — checked, not assumed.
//
// What is worth pinning is the resolution hierarchy (defaults ← tenant-wide ← branch) and that a salon turning
// the copilot's ACTIONS off is honoured, because every default is `true`: if the tenant-wide row were not read,
// the copilot would silently regain the ability to create, reschedule and cancel appointments.
//
// It also exercises migration 441. Tenant-wide rows are read with `branch_id IS NULL`, and `patch` does
// select-then-insert; before 441, Postgres treated those NULLs as distinct, so repeated saves could silently
// duplicate the row and `LIMIT 1` would return whichever came back first.
import { describe, it, expect, beforeAll } from 'vitest';
import { CopilotSettingsService } from './copilot-settings.service';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'a4a4a4a4-0000-4000-8000-000000000001';
const B = 'a4a4a4a4-0000-4000-8000-000000000002';
const USER = 'a4a4a4a4-0000-4000-8000-000000000003';
const tenantCtx = { tenantId: T, userId: USER, role: 'OWNER', permissions: ['ai.manage'], branchId: null };
const branchCtx = { ...tenantCtx, branchId: B };
let svc: CopilotSettingsService;
let pgRef: any;

beforeAll(async () => {
  const pg = await migratedPglite();
  pgRef = pg;
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Copilot Salon LLC', 'Copilot Salon', 'copilot-salon', 'COPI1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  await pg.exec(`
    INSERT INTO users (id, tenant_id, email, role, status) VALUES ('${USER}', '${T}', 'owner@copilot.test', 'OWNER', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  const audit = { log: async () => undefined, record: async () => undefined } as never;
  svc = new CopilotSettingsService(kyselyFor(pg) as never, audit);
});

const tenantWideRows = async () =>
  Number((await pgRef.query(`SELECT count(*)::int AS c FROM tenant_settings WHERE tenant_id = '${T}' AND branch_id IS NULL AND category = 'reception_copilot'`)).rows[0].c);

describe('the resolution hierarchy', () => {
  it('with nothing stored, every capability is on (the product defaults)', async () => {
    expect((await svc.get(tenantCtx as never)).actionsEnabled).toBe(true);
  });

  it('a salon turning copilot ACTIONS off is honoured — every default is true, so an unread row re-enables them', async () => {
    await svc.patch(tenantCtx as never, { actionsEnabled: false }, 'tenant');
    expect((await svc.get(tenantCtx as never)).actionsEnabled).toBe(false);
  });

  it('the tenant-wide choice reaches a branch that has no override of its own', async () => {
    expect((await svc.get(branchCtx as never)).actionsEnabled).toBe(false);
  });

  it('a branch override WINS over the tenant-wide value', async () => {
    await svc.patch(branchCtx as never, { actionsEnabled: true }, 'branch');
    expect((await svc.get(branchCtx as never)).actionsEnabled).toBe(true);
  });

  it('…without changing the tenant-wide value for everyone else', async () => {
    expect((await svc.get(tenantCtx as never)).actionsEnabled).toBe(false);
  });
});

describe('migration 441: repeated tenant-wide saves leave ONE row, not several', () => {
  it('saving the tenant-wide settings three times keeps exactly one tenant-wide row', async () => {
    await svc.patch(tenantCtx as never, { allowCancel: false }, 'tenant');
    await svc.patch(tenantCtx as never, { allowReschedule: false }, 'tenant');
    await svc.patch(tenantCtx as never, { allowCreate: false }, 'tenant');
    expect(await tenantWideRows()).toBe(1);
  });

  it('all three changes are present — later saves merged, they did not replace the row', async () => {
    const s = await svc.get(tenantCtx as never);
    expect(s.allowCancel).toBe(false);
    expect(s.allowReschedule).toBe(false);
    expect(s.allowCreate).toBe(false);
  });

  it('the database itself REFUSES a second tenant-wide row — the guarantee is in the schema, not the service', async () => {
    await expect(pgRef.query(
      `INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}', NULL, 'reception_copilot', '{}'::jsonb)`,
    )).rejects.toThrow();
  });
});
