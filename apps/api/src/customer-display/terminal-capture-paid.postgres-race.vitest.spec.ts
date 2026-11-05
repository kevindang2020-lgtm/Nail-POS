// terminal-capture-paid.postgres-race — Phase 15 round 2, on real Postgres (a pool, so concurrent transactions really
// interleave and an event written outside the transaction really survives a rollback):
//   • the same terminal approval delivered twice at once records ONE payment, ONE payment.captured, ONE checkout.completed,
//     ONE visit.completed (loyalty earns on payment.captured — one event is one award);
//   • two Pay taps racing into capture() send ONE charge to the terminal;
//   • a recording failure after the events were written leaves none of them, an open ticket, and the 'processing' row.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

const url = process.env.PG_RACE_URL;
const T = 'a7400000-0000-4000-8000-0000000000f1', B = 'b7400000-0000-4000-8000-0000000000f1', C = 'c7400000-0000-4000-8000-0000000000f1';
const TERM = 'd7400000-0000-4000-8000-0000000000f1', CAT = 'e7400000-0000-4000-8000-0000000000f1', SVC = 'e7400000-0000-4000-8000-0000000000f2';
let db: Kysely<any>; let pool: pg.Pool; let n = 0;

async function session(): Promise<any> {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`.execute(db);
  const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'f1h' + n + Date.now()}, ${tk.id}) returning id`.execute(db)).rows[0];
  return { id: String(s.id), tenantId: T, branchId: B, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: C, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
const types = async (ticketId: string) => ((await sql`SELECT event_type FROM outbox_events WHERE tenant_id = ${T} AND (aggregate_id = ${ticketId} OR payload_json->>'ticketId' = ${ticketId}) ORDER BY event_type`.execute(db)).rows as any[]).map((r) => r.event_type);
const payments = async (ticketId: string) => (await sql`SELECT status, processor_transaction_id FROM payments WHERE ticket_id = ${ticketId}::uuid`.execute(db)).rows as any[];
const status = async (ticketId: string) => ((await sql`SELECT status FROM tickets WHERE id = ${ticketId}::uuid`.execute(db)).rows[0] as any).status;
const cleanup = async () => {
  for (const t of ['outbox_events', 'payment_signatures', 'checkout_locks', 'payments', 'ticket_service_lines', 'customer_display_sessions']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM tickets WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
};
const svc = (device: any, outbox = new OutboxWriter(), leases = new InMemoryTerminalLeases()) => new TerminalCaptureService(db as any, device, (x) => x, undefined, leases, undefined, outbox, { error: () => undefined });

describe.skipIf(!url)('terminal capture → paid, on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'TF', 'TF', 'tf-salon', 'TFSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000) on conflict (id) do nothing`.execute(db);
    await sql`delete from tenant_settings where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
    await sql`delete from pos_payment_terminals where tenant_id = ${T}`.execute(db);
    await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSNF1')`.execute(db);
    await sql`delete from tenant_payment_config where tenant_id = ${T}`.execute(db);
    await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.test', 'enc')`.execute(db);
    await cleanup();
  });
  afterAll(async () => { await cleanup(); await db?.destroy(); });

  it('the same approval delivered twice concurrently is recorded ONCE — one payment, one of each event, ticket paid', async () => {
    for (let i = 0; i < 5; i++) {
      const row = await session(); const s = svc(null);
      const out = await Promise.all([1, 2, 3].map(() => s.recordApproval(row, `termcap_${row.id}`, 5550, 0, 'RR-DUP')));
      expect(out.filter((o) => !o.duplicate)).toHaveLength(1);
      expect(new Set(out.map((o) => o.paymentId)).size).toBe(1);          // the duplicates name the recorded payment
      expect(await payments(row.ticketId)).toEqual([{ status: 'approved', processor_transaction_id: 'RR-DUP' }]);
      expect(await types(row.ticketId)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
      expect(await status(row.ticketId)).toBe('paid');
    }
  });

  it('two Pay taps racing into capture() send ONE charge to the terminal', async () => {
    for (let i = 0; i < 3; i++) {
      const row = await session(); let calls = 0; let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      const dev = () => ({ authCard: async () => { calls++; await gate; return { approved: true, retref: 'RR-TAP' + i, respstat: 'A' }; } });
      const leases = new InMemoryTerminalLeases();
      const a = svc(dev, undefined, leases).capture(row); const b = svc(dev, undefined, leases).capture(row);
      await new Promise((r) => setTimeout(r, 300)); release();
      expect((await Promise.all([a, b])).map((x) => x.outcome).sort()).toEqual(['approved', 'ticket_busy']);
      expect(calls).toBe(1);
      expect(await types(row.ticketId)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
    }
  });

  it('a failure after the events were written rolls ALL of them back with the paid state; the processing row remains', async () => {
    const row = await session();
    const w = new OutboxWriter(); const real = w.write.bind(w);
    w.write = async (trx: any, e: any) => { await real(trx, e); if (e.eventType === 'visit.completed') throw new Error('boom'); };
    const r = await svc(() => ({ authCard: async () => ({ approved: true, retref: 'RR-RB', respstat: 'A' }) }), w).capture(row);
    expect(r.outcome).toBe('unknown');
    expect(await types(row.ticketId)).toEqual([]);
    expect(await status(row.ticketId)).toBe('open');
    expect(await payments(row.ticketId)).toEqual([{ status: 'processing', processor_transaction_id: 'RR-RB' }]);
  });
});
