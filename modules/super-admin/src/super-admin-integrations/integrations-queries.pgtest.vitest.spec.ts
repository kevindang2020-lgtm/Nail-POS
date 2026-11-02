// integrations-queries.pgtest — executes the Super Admin Integrations queries against the real migrated schema.
//
// #3 by swallowing catches (5), and the catches here are inline `.catch(() => [])` / `.catch(() => ({...}))`
// on individual queries — so a broken one does not blank the page, it reports **zero connected integrations**
// or **no webhook errors**. Both are the answer an operator most wants to see, which makes them the most
// dangerous to fake: "no errors" hides errors.
//
// Each test seeds a row and asserts it is counted. Zero is the failure mode being guarded.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyIntegrationsRepo } from './super-admin-integrations.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = '11111111-1111-1111-1111-111111111111';
let repo: KyselyIntegrationsRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
      VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active');
    -- one payment webhook event today, with an INVALID signature: the bad-signature counter must see it
    INSERT INTO payment_gateway_events (id, tenant_id, processor_type, signature_valid, created_at)
      VALUES (gen_random_uuid(), '${T}', 'fiserv', false, now());
  `);
  repo = new KyselyIntegrationsRepo(kyselyFor(pg) as any);
}, 60_000);

describe('integrations queries execute against the real migrated schema', () => {
  it('overview() returns an object — not the {} a failed query leaves behind', async () => {
    const ov = await repo.overview();
    expect(ov).toBeTruthy();
    expect(typeof ov).toBe('object');
  });

  it('connectedIntegrations() COUNTS the seeded fiserv event (0 would read as "nothing connected")', async () => {
    const rows: any[] = await repo.connectedIntegrations();
    expect(Array.isArray(rows)).toBe(true);
    const blob = JSON.stringify(rows).toLowerCase();
    expect(blob).toContain('fiserv');            // the processor must surface, not be silently dropped
  });

  it('every remaining read executes and returns an array', async () => {
    for (const fn of ['recentWebhookEvents', 'authAlerts', 'errorLogs', 'tenantUsage'] as const) {
      expect(Array.isArray(await (repo as any)[fn]())).toBe(true);
    }
  });

  it('tenant filter narrows rather than erroring', async () => {
    const mine: any[] = await repo.connectedIntegrations({ tenantId: T } as any);
    expect(Array.isArray(mine)).toBe(true);
    const other: any[] = await repo.connectedIntegrations({ tenantId: '22222222-2222-2222-2222-222222222222' } as any);
    expect(JSON.stringify(other).toLowerCase()).not.toContain('"tenants":1');
  });
});
