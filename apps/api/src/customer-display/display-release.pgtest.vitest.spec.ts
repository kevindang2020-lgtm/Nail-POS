// display-release.pgtest.vitest.spec.ts — 23-inch dual-screen spec §43–§46, §96, §103, §107 on the REAL schema
// (every migration, PGlite). The display releases a completed checkout; the session row ends ('completed', closed), the
// device's current session is gone, the release is idempotent, a refused release changes nothing, and the next
// customer's checkout can be attached to the same display (migration 505's one-active-session index lets it through).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDisplayRepository } from './customer-display.repository';
import { CustomerDisplayService } from './customer-display.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'd5000000-0000-0000-0000-000000000001';
const BR = 'd5000000-0000-0000-0000-0000000000b1';
const CUST = 'd5000000-0000-0000-0000-0000000000c1';
const DEV = 'd5000000-0000-0000-0000-0000000000d1';
const TK_PAID = 'd5000000-0000-0000-0000-0000000000e1';
const TK_OPEN = 'd5000000-0000-0000-0000-0000000000e2';
const TK_NEXT = 'd5000000-0000-0000-0000-0000000000e3';
const TK_CARD = 'd5000000-0000-0000-0000-0000000000e4';
const S_PAID = 'd5000000-0000-0000-0000-0000000005e1';
const S_OPEN = 'd5000000-0000-0000-0000-0000000005e2';
const TOKEN = 'device-token-for-release-test';

let pg: PGlite;
let repo: KyselyDisplayRepository;
let svc: CustomerDisplayService;
const emitted: string[] = [];
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyDisplayRepository(db as any);
  const rt: any = {
    toTenant: (_c: any, e: string) => emitted.push('tenant|' + e), toCustomerDisplayDevice: (id: string, e: string) => emitted.push(`device:${id}|${e}`),
    toCustomerDisplay() {}, toTicket() {}, toTechnician() {}, toOwner() {}, toPlatform() {},
  };
  svc = new CustomerDisplayService(repo, rt);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','d5a','D5A')`, [T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Lane','Sophia Lane')`, [CUST, T, BR]);
  await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status, device_token_hash) values ($1,$2,$3,'FRONT-DESK-CUSTOMER-DISPLAY-01','paired',$4)`,
    [DEV, T, BR, createHash('sha256').update(TOKEN).digest('hex')]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid', now())`, [TK_PAID, T, BR, CUST]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK_OPEN, T, BR, CUST]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK_NEXT, T, BR, CUST]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, status, amount_cents) values ($1,$2,$3,'cash','approved',14240)`, [T, BR, TK_PAID]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid', now())`, [TK_CARD, T, BR, CUST]);
});

const attach = (id: string, ticket: string) => q(`insert into customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, expires_at)
  values ($1,$2,$3,$4,$5,$6,'showing_ticket','h', now() + interval '10 minutes')`, [id, T, BR, DEV, ticket, CUST]);

describe('release on the real schema', () => {
  it('reads the timing the lifecycle needs: paid time, payment time, a version', async () => {
    await attach(S_PAID, TK_PAID);
    const row = await repo.getSession(S_PAID);
    expect(row?.ticketPaidAt).toBeTruthy();
    expect(row?.lastPaymentStatus).toBe('approved');
    expect(row?.lastPaymentAt).toBeTruthy();
    expect((row?.changedAtMs ?? 0) > 0).toBe(true);
    const st = await svc.getDeviceState(TOKEN);
    expect(st.state).toBe('payment_success');
    expect(st.sessionId).toBe(S_PAID);
    expect(st.customer?.firstName).toBe('Sophia');
  });

  it('releasing the completed checkout ends the session row and leaves the display idle', async () => {
    const st = await svc.releaseForDevice(TOKEN, S_PAID);
    expect(st.state).toBe('idle');
    expect(st.customer).toBeUndefined();
    const r = (await q(`select state, closed_at from customer_display_sessions where id=$1`, [S_PAID]))[0];
    expect(r.state).toBe('completed');
    expect(r.closed_at).not.toBeNull();
    expect(await repo.currentSessionForDevice(DEV)).toBeNull();
    expect(emitted).toContain(`device:${DEV}|customer_display_completed`);
    // a second release is a no-op, and re-reading never brings Sophia back
    expect((await svc.releaseForDevice(TOKEN, S_PAID)).state).toBe('idle');
    expect((await svc.getDeviceState(TOKEN)).state).toBe('idle');
  });

  it('an unpaid checkout cannot be released — the row stays open', async () => {
    await attach(S_OPEN, TK_OPEN);
    await expect(svc.releaseForDevice(TOKEN, S_OPEN)).rejects.toThrow(/not complete/);
    const r = (await q(`select state, closed_at from customer_display_sessions where id=$1`, [S_OPEN]))[0];
    expect(r.closed_at).toBeNull();
    expect(r.state).toBe('showing_ticket');
  });

  it('after a release the same display can take the next customer (one-active-session index ignores completed rows)', async () => {
    await q(`update customer_display_sessions set state='disconnected', closed_at=now() where id=$1`, [S_OPEN]);   // POS cancelled it
    await attach('d5000000-0000-0000-0000-0000000005e3', TK_NEXT);
    const st = await svc.getDeviceState(TOKEN);
    expect(st.sessionId).toBe('d5000000-0000-0000-0000-0000000005e3');
    expect(st.state).toBe('ticket_review');
  });

  it('an approved CARD payment is released at once — no signature on the display (Kevin, Oct 6 2026: the Clover terminal takes it)', async () => {
    await q(`update customer_display_sessions set state='disconnected', closed_at=now() where id='d5000000-0000-0000-0000-0000000005e3'`);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, status, amount_cents) values ($1,$2,$3,'card','approved',5000)`, [T, BR, TK_CARD]);
    await attach('d5000000-0000-0000-0000-0000000005e4', TK_CARD);
    const st = await svc.getDeviceState(TOKEN);
    expect(st.state).toBe('payment_success');
    expect(st).not.toHaveProperty('signatureRequired');
    expect((await svc.releaseForDevice(TOKEN, 'd5000000-0000-0000-0000-0000000005e4')).state).toBe('idle');
    expect(await repo.currentSessionForDevice(DEV)).toBeNull();
  });
});
