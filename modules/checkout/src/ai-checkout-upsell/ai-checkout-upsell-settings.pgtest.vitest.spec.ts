// ai-checkout-upsell-settings.pgtest — w4 sweep SW-15 (Oct 13 2026): the salon's own AI checkout upsell switches were
// IGNORED. layers() compared device_id / user_id (uuid columns) with '' whenever the caller had no device (every POS web
// session) — PostgreSQL refused the statement ("invalid input syntax for type uuid", x17 in the live UI sweep's log), the
// .catch(() => []) returned no layers, and a salon that switched upsell OFF still got the platform default.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyUpsellSettings } from './ai-checkout-upsell.kysely';

const T = 'c5e90000-0000-4000-8000-0000000000a1', B = 'c5e90000-0000-4000-8000-0000000000b1', U = 'c5e90000-0000-4000-8000-0000000000e1';
let s: KyselyUpsellSettings;

beforeAll(async () => {
  const pg: any = await migratedPglite();
  const q = (x: string, p: unknown[] = []) => pg.query(x, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Upsell LLC','Upsell','upsell-w4','UPSW41','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into ai_checkout_upsell_settings (id, tenant_id, level, enabled) values (gen_random_uuid(), $1, 'tenant', false)`, [T]);
  await q(`insert into ai_checkout_upsell_settings (id, tenant_id, level, branch_id, enabled) values (gen_random_uuid(), $1, 'branch', $2, true)`, [T, B]);
  s = new KyselyUpsellSettings(kyselyFor(pg) as never);
}, 180_000);

describe('AI checkout upsell — the salon\'s own switches', () => {
  it('a POS session with NO device still reads the tenant and branch layers', async () => {
    const l = await s.layers({ tenantId: T, branchId: B, userId: U, deviceId: null } as any);
    expect(l.tenant).toEqual({ enabled: false });
    expect(l.branch).toEqual({ enabled: true });
  });
  it('a context with no branch either (branchId \'\') still reads the tenant layer', async () => {
    const l = await s.layers({ tenantId: T, branchId: '', userId: '', deviceId: null } as any);
    expect(l.tenant).toEqual({ enabled: false });
  });
});
