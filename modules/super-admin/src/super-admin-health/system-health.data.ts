// system-health.data.ts — DB probe port for System Health, with a Kysely (Postgres) adapter and an in-memory fallback.
// The Kysely probe measures real connectivity/latency and reads live counts; the in-memory adapter reports that no
// Postgres is wired (the platform health view is a Postgres/production surface).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { HealthDbResult } from '@aipowersalon/api-contracts/platform';
import type { HealthDbResult } from '@aipowersalon/api-contracts/platform';

export interface HealthDb { probe(): Promise<HealthDbResult>; }

export class KyselyHealthDb implements HealthDb {
  constructor(private readonly db: Kysely<DB>) {}
  async probe(): Promise<HealthDbResult> {
    const t0 = Date.now();
    try {
      await sql`select 1`.execute(this.db);                       // connectivity + round-trip latency
      const latencyMs = Date.now() - t0;
      const num = (eb: any) => eb.fn.countAll().as('c');
      const ver = await sql<{ v: string }>`select version() as v`.execute(this.db);
      const tbl = await sql<{ c: number }>`select count(*)::int as c from information_schema.tables where table_schema = 'public'`.execute(this.db);
      const tenants = await this.db.selectFrom('tenants').select(num).executeTakeFirst();
      const users = await this.db.selectFrom('users').select(num).executeTakeFirst();
      const subs = await this.db.selectFrom('tenant_subscriptions').select(num).where('status', '=', 'active').executeTakeFirst();
      // Payment gateway health — real signal: error/failure/decline events (or invalid signatures) in the last 24h,
      // matching the alerts module's gateway-error rule, plus the count of configured tenant gateways. ok = no errors.
      const gwErr = await sql<{ n: number }>`select count(*)::int n from payment_gateway_events where created_at > now() - interval '24 hours' and (coalesce(event_type,'') ilike '%error%' or coalesce(event_type,'') ilike '%fail%' or coalesce(event_type,'') ilike '%decline%' or signature_valid = false)`.execute(this.db).then((r) => Number(r.rows[0]?.n ?? 0)).catch(() => 0);
      const gwCfg = await sql<{ n: number }>`select count(*)::int n from tenant_payment_config where coalesce(status,'') <> 'pending'`.execute(this.db).then((r) => Number(r.rows[0]?.n ?? 0)).catch(() => 0);
      return {
        driver: 'postgres', ok: true, latencyMs,
        serverVersion: (ver.rows[0]?.v || '').split(' on ')[0] || undefined,
        tableCount: Number(tbl.rows[0]?.c ?? 0),
        counts: { tenants: Number((tenants as any)?.c ?? 0), users: Number((users as any)?.c ?? 0), activeSubscriptions: Number((subs as any)?.c ?? 0) },
        gateway: { errors24h: gwErr, configured: gwCfg, ok: gwErr === 0 },
      };
    } catch (e: any) {
      return { driver: 'postgres', ok: false, latencyMs: Date.now() - t0, error: String(e?.message || e) };
    }
  }
}

export class InMemoryHealthDb implements HealthDb {
  async probe(): Promise<HealthDbResult> {
    return { driver: 'in-memory', ok: false, error: 'No Postgres configured (set REPO_DRIVER=postgres + DATABASE_URL).' };
  }
}
