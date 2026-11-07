// terminal-capture.postgres-race.vitest.spec.ts — TerminalCaptureService (the Bolt kiosk path) had no tests. On real
// Postgres with a fake terminal: approved marks the ticket paid; declined is recorded honestly; a busy shared terminal
// records nothing; a config failure before any charge is 'failed'; and (Decision 22 on this path, Oct 2 2026) a terminal
// call that THROWS mid-charge is 'processing' — may have been charged, verify — never 'failed'. One attempt per session.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { InMemoryTerminalLeases, KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

const url = process.env.PG_RACE_URL;
const T = 'a7400000-0000-4000-8000-0000000000a1', B = 'b7400000-0000-4000-8000-0000000000b1', C = 'c7400000-0000-4000-8000-0000000000c1';
const TERM = 'd7400000-0000-4000-8000-0000000000d1';
const CAT = 'e7400000-0000-4000-8000-0000000000e1', SVC = 'e7400000-0000-4000-8000-0000000000e2';
let db: Kysely<any>; let pool: pg.Pool; let n = 0;
const ticketIds: string[] = [];

async function session(): Promise<any> {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  ticketIds.push(String(tk.id));
  // a ticket's total is its LINES (what the POS charges) — one $50 service
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`.execute(db);
  const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'h' + n + Date.now()}, ${tk.id}) returning id`.execute(db)).rows[0];
  return { id: String(s.id), tenantId: T, branchId: B, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: C, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
const payment = async (ticketId: string) => ((await sql`select status, amount_cents, processor_transaction_id from payments where ticket_id = ${ticketId}::uuid`.execute(db)).rows as any[]);
const ticketStatus = async (ticketId: string) => ((await sql`select status from tickets where id = ${ticketId}::uuid`.execute(db)).rows[0] as any).status;
const device = (auth: (a?: any) => Promise<any>) => () => ({ authCard: auth } as any);

describe.skipIf(!url)('TerminalCaptureService on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'TC', 'TC', 'tc-salon', 'TCSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000) on conflict (id) do nothing`.execute(db);
    await sql`delete from tenant_settings where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
    await sql`delete from pos_payment_terminals where tenant_id = ${T}`.execute(db);
    await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSN123')`.execute(db);
    await sql`delete from tenant_payment_config where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.cardpointe.com', 'enc')`.execute(db);
  });
  afterAll(async () => {
    for (const id of ticketIds) { await sql`delete from payments where ticket_id = ${id}::uuid`.execute(db).catch(() => undefined); await sql`delete from ticket_service_lines where ticket_id = ${id}::uuid`.execute(db).catch(() => undefined); await sql`delete from customer_display_sessions where ticket_id = ${id}::uuid`.execute(db).catch(() => undefined); await sql`delete from tickets where id = ${id}::uuid`.execute(db).catch(() => undefined); }
    await db?.destroy();
  });
  let leases: InMemoryTerminalLeases;
  beforeEach(() => { leases = new InMemoryTerminalLeases(); });
  const svc = (auth: (a?: any) => Promise<any>) => new TerminalCaptureService(db as any, device(auth), (x) => x, undefined, leases);

  // Nov 5 2026 (Fiserv master build: a payment counts only when the approved amount matches exactly): a partial
  // approval is NOT a paid ticket — the outcome is unknown and the ticket stays unpaid until verified.
  it('an approval for a different amount than requested is unknown, never approved', async () => {
    const row = await session();
    const r = await svc(async (a: any) => ({ approved: true, retref: 'RR-PART', amountCents: a.amountCents - 100, respstat: 'A' })).capture(row);
    expect(r).toMatchObject({ outcome: 'unknown' });
    expect((await payment(row.ticketId)).some((p: any) => p.status === 'approved')).toBe(false);
  });

  it('approved → an approved card payment with the retref, and the ticket is paid; a second tap is a duplicate (no second charge)', async () => {
    const row = await session(); let calls = 0;
    // the terminal approves exactly what it was asked for (the ticket's total due, tax included)
    const s = svc(async (a: any) => { calls++; return { approved: true, retref: 'RR1', amountCents: a.amountCents, respstat: 'A' }; });
    expect(await s.capture(row)).toMatchObject({ outcome: 'approved', retref: 'RR1' });
    expect(await payment(row.ticketId)).toEqual([expect.objectContaining({ status: 'approved', processor_transaction_id: 'RR1' })]);
    expect(await ticketStatus(row.ticketId)).toBe('paid');
    expect(await s.capture(row)).toMatchObject({ outcome: 'duplicate' });
    expect(calls).toBe(1);
  });

  it('declined → an honest declined payment; the ticket stays open', async () => {
    const row = await session();
    expect(await svc(async () => ({ approved: false, respstat: 'C', respText: 'Insufficient funds', retref: 'RR2' })).capture(row)).toMatchObject({ outcome: 'declined', respText: 'Insufficient funds' });
    expect((await payment(row.ticketId))[0].status).toBe('declined');
    expect(await ticketStatus(row.ticketId)).toBe('open');
  });

  it('a busy shared terminal (Decision 34) charges nothing and records nothing', async () => {
    const row = await session(); let calls = 0;
    await leases.acquire(T, TERM, 'someone-else');
    expect(await svc(async () => { calls++; return { approved: true }; }).capture(row)).toMatchObject({ outcome: 'terminal_busy' });
    expect(calls).toBe(0);
    expect(await payment(row.ticketId)).toEqual([]);
  });

  it("DECISION 22 ON THIS PATH: the terminal call throws mid-charge → 'processing' (verify), never 'failed'; the terminal is released", async () => {
    const row = await session();
    const r = await svc(async () => { throw new Error('socket hang up'); }).capture(row);
    expect(r).toMatchObject({ outcome: 'unknown' });
    expect((await payment(row.ticketId))[0].status).toBe('processing');
    expect(await ticketStatus(row.ticketId)).toBe('open');
    expect(await leases.acquire(T, TERM, 'next-customer')).toBe(true);
  });

  it("a config failure BEFORE any charge (key cannot be decrypted) is 'failed' — nothing was sent to the terminal", async () => {
    const row = await session(); let calls = 0;
    const s = new TerminalCaptureService(db as any, device(async () => { calls++; return { approved: true }; }), () => { throw new Error('bad key'); }, undefined, leases);
    expect(await s.capture(row)).toMatchObject({ outcome: 'failed' });
    expect(calls).toBe(0);
    expect((await payment(row.ticketId))[0].status).toBe('failed');
  });

  // 23-inch spec §35 — one authoritative checkout. The terminal used to be asked for the DISPLAY SESSION's copy of the
  // total (subtotal + tip stored when the session was created), so a tip or discount added at the POS afterwards, or a
  // gift card that already paid part of it, never reached the charge. It now charges what the POS would: the ticket's
  // card total, less what is already paid.
  const ctxFor = (row: any) => ({ tenantId: row.tenantId, branchId: row.branchId, userId: 'test', role: 'OWNER', permissions: [] } as any);
  const posDue = async (row: any) => { const r = new KyselyCheckoutRepository(db as any); return (await r.totalsFor(ctxFor(row), row.ticketId, 'card'))!.totalDueCents - await r.paidTotalCents(ctxFor(row), row.ticketId); };

  it('charges the TICKET\'s card total — a tip the POS added after the session was created is charged, not the stale session copy', async () => {
    const row = await session();                                                                   // session copy: $50, no tip
    await sql`update tickets set tip_cents = 1000 where id = ${row.ticketId}::uuid`.execute(db);   // then the POS added a $10 tip
    const due = await posDue(row);
    expect(due).toBeGreaterThan(5000 + 1000);                     // the ticket's card total: lines + tip + tax + card surcharge
    const asked: number[] = [];
    const s1 = new TerminalCaptureService(db as any, () => ({ authCard: async (a: any) => { asked.push(a.amountCents); return { approved: true, retref: 'RR-T', respstat: 'A' }; } }) as any, (x) => x, undefined, leases);
    expect(await s1.capture(row)).toMatchObject({ outcome: 'approved' });
    expect(asked).toEqual([due]);
    expect((await payment(row.ticketId))[0].amount_cents).toBe(due);
    expect(await posDue(row)).toBe(0);                            // nothing left due on the ticket
  });

  it('after a gift card paid part of it, the terminal is asked for the BALANCE only', async () => {
    const row = await session();
    await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values (${T}, ${B}, ${row.ticketId}, 'gift_card', 2000, 'approved')`.execute(db);
    const due = await posDue(row);
    const asked: number[] = [];
    const s3 = new TerminalCaptureService(db as any, () => ({ authCard: async (a: any) => { asked.push(a.amountCents); return { approved: true, retref: 'RR-B', respstat: 'A' }; } }) as any, (x) => x, undefined, leases);
    expect(await s3.capture(row)).toMatchObject({ outcome: 'approved' });
    expect(asked).toEqual([due]);
    expect((await payment(row.ticketId)).find((p: any) => p.processor_transaction_id === 'RR-B').amount_cents).toBe(due);
  });

  it('a ticket that is already paid in full is never charged again', async () => {
    const row = await session();
    const full = await posDue(row);
    await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values (${T}, ${B}, ${row.ticketId}, 'cash', ${full}, 'approved')`.execute(db);
    let calls = 0;
    const r = await svc(async () => { calls++; return { approved: true, retref: 'RR-X' }; }).capture(row);
    expect(r).toMatchObject({ outcome: 'skipped' });
    expect(calls).toBe(0);
  });
});
