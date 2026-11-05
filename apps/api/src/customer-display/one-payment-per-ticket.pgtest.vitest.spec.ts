// one-payment-per-ticket.pgtest.vitest.spec.ts — Oct 6 2026, on the real schema: the customer display's card charge on the
// terminal and a front-desk payment can never both be taken for one ticket. The display's charge holds the ticket's
// checkout lock (checkout_locks, one active row per ticket) while the terminal waits for the card; the POS payment paths
// take the same lock, so whichever starts second is refused with nothing charged and nothing recorded.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { InMemoryTerminalLeases, KyselyCheckoutRepository, CheckoutService, CheckoutLockService, KyselyCheckoutLockRepository } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BR = 'a1111111-1111-4111-8111-111111111111';
const BR2 = 'b1111111-1111-4111-8111-111111111111';
const CUST = 'a3333333-3333-4333-8333-333333333333';
const SVC = 'a4444444-4444-4444-8444-444444444444';
const USER = 'a2222222-2222-4222-8222-222222222222';
let pg: PGlite; let db: Kysely<any>; let n = 0;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

/** A ticket with one $50 line, shown on a display session, about to be paid on the terminal. */
async function paying(): Promise<any> {
  n++;
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'open',5000,0,0,5000) returning id`, [T, BR, CUST]))[0];
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Gel Manicure',5000,45,5000)`, [T, BR, tk.id, SVC]);
  const s = (await q(`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values ($1,$2,$3,$4) returning id`, [T, BR, 'h' + n + Date.now(), tk.id]))[0];
  return { id: String(s.id), tenantId: T, branchId: BR, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: CUST, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
beforeAll(async () => {
  pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    if (f.startsWith('386') || f.startsWith('513')) await pg.exec(s);   // the signature migrations are NOT tolerated
    else try { await pg.exec(s); } catch { /* pg_trgm / btree_gist / etc. */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle','belle','BELLE','active')`, [T, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR, T, BR2, OTHER]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Lee','Ana Lee')`, [CUST, T, BR]);
  const cat = (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Nails') returning id`, [T, BR]))[0].id;
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,5000)`, [SVC, T, BR, cat]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', $2::jsonb)`, [T, JSON.stringify({ customerDisplayCaptureMode: 'terminal' })]);
  await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (gen_random_uuid(),$1,$2,'Clover Flex','paired','HSN1')`, [T, BR]);
  await q(`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values ($1,'M1','https://bolt.test','enc')`, [T]);
}, 180000);

const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'];
const desk = { tenantId: T, branchId: BR, userId: USER, role: 'OWNER', permissions: PERMS } as any;
const pos = () => new CheckoutService(new KyselyCheckoutRepository(db as any), undefined, undefined, undefined, undefined, undefined, undefined, undefined, new CheckoutLockService(new KyselyCheckoutLockRepository(db as any)));
const cashFor = async (ticketId: string) => { const s = pos(); return s.payCash(desk, ticketId, { amountReceivedCents: (await s.recalculate(desk, ticketId, 'cash')).totalDueCents } as any); };
const payments = (ticketId: string) => q(`select method, status from payments where tenant_id = $1 and ticket_id = $2 order by created_at`, [T, ticketId]);
const activeLock = async (ticketId: string) => (await q(`select source from checkout_locks where tenant_id = $1 and ticket_id = $2 and released_at is null`, [T, ticketId]))[0]?.source ?? null;
/** A terminal whose customer has not tapped yet: authCard waits until the test lets it answer. */
function slowTerminal() {
  let answer!: (a: any) => void; let asked = 0;
  const pending = new Promise<any>((r) => { answer = r; });
  const svc = new TerminalCaptureService(db as any, () => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async () => { asked++; return pending; } }) as any, (x) => x, undefined, new InMemoryTerminalLeases());
  return { svc, approve: () => answer({ approved: true, declined: false, respstat: 'A', respText: 'Approval', retref: 'RR' + n, amountCents: 5000 }), asked: () => asked };
}

describe('one payment at a time per ticket — the terminal and the front desk', () => {
  it('while the customer is tapping their card, front-desk cash is refused and nothing is recorded; the card payment then lands alone', async () => {
    const row = await paying(); const t = slowTerminal();
    const charging = t.svc.capture(row as any);
    for (let i = 0; i < 50 && t.asked() === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(t.asked()).toBe(1);
    expect(await activeLock(row.ticketId)).toBe('display');
    await expect(cashFor(row.ticketId)).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    expect(await payments(row.ticketId)).toEqual([]);
    t.approve();
    expect(await charging).toMatchObject({ outcome: 'approved' });
    expect(await payments(row.ticketId)).toEqual([{ method: 'card', status: 'approved' }]);
    expect(await activeLock(row.ticketId)).toBeNull();
    await expect(cashFor(row.ticketId)).rejects.toThrow(/already paid/);   // and it is paid — no second payment possible
  });

  it('while the front desk holds the ticket, the display does not start a charge: the terminal is never asked, nothing recorded', async () => {
    const row = await paying();
    await q(`insert into checkout_locks (tenant_id, branch_id, ticket_id, owner_user_id, session_id, source, expires_at) values ($1,$2,$3,$4,'pos-pay:x','pos', now() + interval '60 seconds')`, [T, BR, row.ticketId, USER]);
    const t = slowTerminal();
    expect(await t.svc.capture(row as any)).toMatchObject({ outcome: 'ticket_busy', reason: 'PAYMENT_IN_PROGRESS', heldBy: 'pos' });
    expect(t.asked()).toBe(0);
    expect(await payments(row.ticketId)).toEqual([]);
  });

  it('a terminal that never answers still lets go of the ticket (the payment is "processing" for staff to verify)', async () => {
    const row = await paying();
    const svc = new TerminalCaptureService(db as any, () => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async () => { throw new Error('socket hang up'); } }) as any, (x) => x, undefined, new InMemoryTerminalLeases());
    expect(await svc.capture(row as any)).toMatchObject({ outcome: 'unknown' });
    expect(await activeLock(row.ticketId)).toBeNull();
  });

  it('cash first: once the front desk has recorded it, the display has nothing to charge', async () => {
    const row = await paying();
    expect((await cashFor(row.ticketId)).payment.status).toBe('approved');
    const t = slowTerminal();
    expect(await t.svc.capture(row as any)).toMatchObject({ outcome: 'skipped', reason: 'the ticket is already paid' });   // not the card fee's difference
    expect(t.asked()).toBe(0);
    expect(await payments(row.ticketId)).toEqual([{ method: 'cash', status: 'approved' }]);
  });
});

describe('the display\'s charge goes to the terminal tied to its register (Oct 6 2026)', () => {
  it('with several terminals, the session\'s register picks its own; a register with no terminal says so', async () => {
    const [front, back, bare] = (await q(`insert into pos_stations (tenant_id, branch_id, name) values ($1,$2,'Front Desk'), ($1,$2,'Back Register'), ($1,$2,'Pedicure Bar') returning id`, [T, BR])).map((r: any) => String(r.id));
    await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, station_id) values ('term_front',$1,$2,'Front Clover','paired','HSN-FRONT',$3), ('term_back',$1,$2,'Back Clover','paired','HSN-BACK',$4)`, [T, BR, front, back]);
    const asked: string[] = [];
    const svc = new TerminalCaptureService(db as any, () => ({ name: 'fake', ping: async () => true, display: async () => {}, authCard: async (i: any) => { asked.push(i.hsn); return { approved: true, declined: false, respstat: 'A', respText: 'Approval', retref: 'R' + asked.length, amountCents: 5000 }; } }) as any, (x) => x, undefined, new InMemoryTerminalLeases());
    const atRegister = async (reg: string) => { const row = await paying(); await q(`update customer_display_sessions set pos_station_id = $1 where id = $2`, [reg, row.id]); return row; };
    expect(await svc.capture(await atRegister(back) as any)).toMatchObject({ outcome: 'approved' });
    expect(await svc.capture(await atRegister(front) as any)).toMatchObject({ outcome: 'approved' });
    expect(asked).toEqual(['HSN-BACK', 'HSN-FRONT']);
    expect(await svc.capture(await atRegister(bare) as any)).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/no terminal is tied to this register/) });
    expect(asked).toHaveLength(2);
  });
});
