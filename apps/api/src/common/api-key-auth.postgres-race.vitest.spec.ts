// api-key-auth.postgres-race.vitest.spec.ts — Constitution 3 Step 7: a tenant API key authenticates a request. Pure
// parts always; real Postgres (migration 498) opt-in via PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readApiKey, apiKeyRouteAllowed, integrationPermissions, KyselyApiKeyAuth, INTEGRATION_SCOPES } from './api-key-auth';

describe('API keys — the rules', () => {
  it('read from X-API-Key or Bearer ak_…; anything else is not a key', () => {
    const k = 'ak_live_' + 'A'.repeat(32);
    expect(readApiKey({ 'x-api-key': k })).toBe(k); expect(readApiKey({ authorization: 'Bearer ' + k })).toBe(k);
    expect(readApiKey({ authorization: 'Bearer eyJ…session' })).toBeNull(); expect(readApiKey({ 'x-api-key': 'ak_short' })).toBeNull(); expect(readApiKey({})).toBeNull();
  });
  it('salon routes only — never /auth, /customer, /super-admin, /platform, /internal, /jobs (also via /api/v1)', () => {
    expect(apiKeyRouteAllowed('/pos/booking/state')).toBe(true); expect(apiKeyRouteAllowed('/api/v1/pos/customers')).toBe(true);
    for (const p of ['/auth/me', '/customer/me', '/super-admin/tenants', '/api/v1/platform/x', '/internal/backups/report', '/jobs/appointment-reminders']) expect(apiKeyRouteAllowed(p)).toBe(false);
  });
  it('a key carries ONLY allow-listed, read-only permissions — a key claiming more gets nothing extra', () => {
    expect(integrationPermissions(['pos.booking.view', 'pos.checkout.refund', 'pos.team.manage', 'super_admin.tenants.view', '*'])).toEqual(['pos.booking.view']);
    expect(INTEGRATION_SCOPES.every((s) => s.endsWith('.view'))).toBe(true);
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a7f00000-0000-4000-8000-0000000000a1';
const h = (raw: string) => createHash('sha256').update(raw).digest('hex');
describe.skipIf(!url)('API key verification on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool; let auth: KyselyApiKeyAuth;
  const key = async (raw: string, o: { revoked?: boolean; expired?: boolean; scopes?: string[] } = {}) => String(((await sql`insert into tenant_api_keys (tenant_id, name, prefix, secret_hash, scopes, revoked_at, expires_at)
    values (${T}::uuid, 'Test', ${raw.slice(0, 12)}, ${h(raw)}, ${o.scopes ?? ['pos.booking.view']}::text[], ${o.revoked ? sql`now()` : null}, ${o.expired ? sql`now() - interval '1 minute'` : null}) returning id`.execute(db)).rows[0] as any).id);
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); auth = new KyselyApiKeyAuth(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'AK', 'AK', 'ak-salon', 'AKSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`delete from tenant_api_keys where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => { await sql`delete from tenant_api_keys where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('a live key verifies with its tenant and scopes; revoked, expired and unknown keys do not', async () => {
    const live = 'ak_live_' + 'L'.repeat(32), revoked = 'ak_live_' + 'R'.repeat(32), expired = 'ak_live_' + 'E'.repeat(32);
    const id = await key(live); await key(revoked, { revoked: true }); await key(expired, { expired: true });
    expect(await auth.verify(live)).toEqual({ keyId: id, tenantId: T, scopes: ['pos.booking.view'], viaPreviousSecret: false });
    expect(await auth.verify(revoked)).toBeNull(); expect(await auth.verify(expired)).toBeNull(); expect(await auth.verify('ak_live_' + 'Z'.repeat(32))).toBeNull();
  });
  it('rotation: the PREVIOUS secret keeps working inside the overlap window, then stops; the new one works', async () => {
    const old = 'ak_live_' + 'O'.repeat(32), neu = 'ak_live_' + 'N'.repeat(32); const id = await key(old);
    await sql`update tenant_api_keys set previous_secret_hash = secret_hash, previous_valid_until = now() + interval '24 hours', secret_hash = ${h(neu)} where id = ${id}::uuid`.execute(db);
    expect(await auth.verify(neu)).toMatchObject({ keyId: id, viaPreviousSecret: false });
    expect(await auth.verify(old)).toMatchObject({ keyId: id, viaPreviousSecret: true });
    await sql`update tenant_api_keys set previous_valid_until = now() - interval '1 second' where id = ${id}::uuid`.execute(db);
    expect(await auth.verify(old)).toBeNull();
  });
  it('every use is logged (route without the query string), and last_used_at is set', async () => {
    const raw = 'ak_live_' + 'U'.repeat(32); const id = await key(raw); const k = (await auth.verify(raw))!;
    await auth.recordUse(k, 'GET', '/pos/booking/state?date=2026-10-04', '10.0.0.9');
    const u: any = (await sql`select method, route, ip from tenant_api_key_uses where key_id = ${id}::uuid`.execute(db)).rows[0];
    expect(u).toEqual({ method: 'GET', route: '/pos/booking/state', ip: '10.0.0.9' });
    expect(((await sql`select last_used_at from tenant_api_keys where id = ${id}::uuid`.execute(db)).rows[0] as any).last_used_at).not.toBeNull();
  });
});
