// terminal-capture-paid.pgtest — Phase 15 round 2: a card approved on the customer display's terminal is a PAID ticket like
// any other. Before this, the approval recorded its payment row, then marked the ticket paid with a bare UPDATE outside any
// transaction whose error was swallowed, and wrote NO domain events: a terminal-paid ticket produced no payment.captured
// (no loyalty points, no analytics), no checkout.completed and no visit.completed, and a failed status write left the
// money taken with the ticket open and nobody told.
//
// Now the approval goes through the canonical POS paid path — KyselyCheckoutRepository.recordPayment (payment.captured) and
// setStatus('paid') (checkout.completed + visit.completed) — in ONE transaction, exactly once per display session, and a
// failure to record is logged and left as the 'processing' row the POS's "Verify with processor" resolves.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

const T = '11111111-1111-4111-8111-1111111111f6', B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf6', C = 'dddddddd-dddd-4ddd-8ddd-ddddddddddf6';
const TERM = 'cccccccc-cccc-4ccc-8ccc-ccccccccccf6', CAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeef1', SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeef2';
let db: any; let n = 0;

async function session(): Promise<any> {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`.execute(db);
  const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'f6h' + n}, ${tk.id}) returning id`.execute(db)).rows[0];
  return { id: String(s.id), tenantId: T, branchId: B, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: C, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
const events = async (ticketId: string) => (await sql`SELECT event_type, aggregate_type, aggregate_id, payload_json FROM outbox_events WHERE tenant_id = ${T} AND (aggregate_id = ${ticketId} OR payload_json->>'ticketId' = ${ticketId}) ORDER BY event_type`.execute(db)).rows as any[];
const types = async (ticketId: string) => (await events(ticketId)).map((e) => e.event_type);
const payments = async (ticketId: string) => (await sql`SELECT id, status, amount_cents, tip_cents, processor_transaction_id, idempotency_key FROM payments WHERE ticket_id = ${ticketId}`.execute(db)).rows as any[];
const ticket = async (ticketId: string) => (await sql`SELECT status, paid_at FROM tickets WHERE id = ${ticketId}`.execute(db)).rows[0] as any;
const approving = (retref = 'RR-F') => () => ({ authCard: async () => ({ approved: true, retref, respstat: 'A' }) } as any);
/** an outbox that refuses one event type (a database / validation failure while recording the paid ticket) */
const refusing = (type: string, after = false) => {
  const w = new OutboxWriter(); const real = w.write.bind(w);
  w.write = async (trx: any, e: any) => { if (e.eventType === type && !after) throw new Error('outbox down'); await real(trx, e); if (e.eventType === type) throw new Error('outbox down after write'); };
  return w;
};

beforeAll(async () => {
  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'F', 'F Salon', 'f-term', 'FTERM6', 'active') on conflict (id) do nothing`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active') on conflict (id) do nothing`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000) on conflict (id) do nothing`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
  await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSNF6')`.execute(db);
  await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.cardpointe.com', 'enc')`.execute(db);
}, 120_000);

let leases: InMemoryTerminalLeases; let logged: string[];
beforeEach(() => { leases = new InMemoryTerminalLeases(); logged = []; });
const log = { error: (m: string) => { logged.push(m); } };
const svc = (device = approving(), outbox: OutboxWriter = new OutboxWriter()) => new TerminalCaptureService(db, device, (x) => x, undefined, leases, undefined, outbox, log);

describe('terminal capture — approved is the canonical paid path', () => {
  it('records ONE payment.captured, ONE checkout.completed and ONE visit.completed with the payment and the paid ticket', async () => {
    const row = await session();
    const r = await svc().capture(row);
    expect(r).toMatchObject({ outcome: 'approved', retref: 'RR-F' });
    const [p] = await payments(row.ticketId);
    expect(p).toMatchObject({ status: 'approved', processor_transaction_id: 'RR-F', idempotency_key: `termcap_${row.id}` });
    expect((r as any).paymentId).toBe(String(p.id));
    const t = await ticket(row.ticketId);
    expect(t.status).toBe('paid');
    expect(t.paid_at).not.toBeNull();                                     // the bare UPDATE never set paid_at
    expect(await types(row.ticketId)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
    const ev = await events(row.ticketId);
    expect(ev.find((e) => e.event_type === 'payment.captured')).toMatchObject({ aggregate_type: 'payment', aggregate_id: String(p.id),
      payload_json: expect.objectContaining({ paymentId: String(p.id), ticketId: row.ticketId, method: 'card', amountCents: Number(p.amount_cents), tipCents: Number(p.tip_cents), status: 'approved' }) });
    expect(ev.find((e) => e.event_type === 'visit.completed').payload_json).toEqual({ ticketId: row.ticketId, customerId: C, channel: 'pos' });
    expect(logged).toEqual([]);
  });

  it('a retried approval for the same session is a duplicate — no second payment, no second event', async () => {
    const row = await session();
    await svc().capture(row);
    expect(await svc().capture(row)).toMatchObject({ outcome: 'duplicate' });
    expect(await svc().recordApproval(row as any, `termcap_${row.id}`, 5000, 0, 'RR-AGAIN')).toMatchObject({ duplicate: true });
    expect(await payments(row.ticketId)).toHaveLength(1);
    expect(await types(row.ticketId)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
  });

  it('an approval that another delivery already recorded while the terminal waited is a duplicate: no second row, event or realtime "paid"', async () => {
    const row = await session(); const emitted: string[] = [];
    const dev = () => ({ authCard: async () => {
      await svc().recordApproval(row, `termcap_${row.id}`, 5550, 0, 'RR-FIRST');    // the other delivery lands first
      return { approved: true, retref: 'RR-FIRST', respstat: 'A' };
    } } as any);
    const emitter: any = { toCustomerDisplay: (_s: string, ev: string) => emitted.push(ev), toTenant: () => undefined };
    const s = new TerminalCaptureService(db, dev, (x) => x, emitter, leases, undefined, new OutboxWriter(), log);
    expect(await s.capture(row)).toMatchObject({ outcome: 'duplicate' });
    expect(emitted).toEqual([]);
    expect(await payments(row.ticketId)).toHaveLength(1);
    expect(await types(row.ticketId)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
  });

  for (const [label, outbox] of [['payment.captured cannot be written', () => refusing('payment.captured')], ['visit.completed fails after it is written', () => refusing('visit.completed', true)]] as const) {
    it(`a failure while recording (${label}) commits NOTHING of the paid state, is logged, and leaves the 'processing' row Verify resolves`, async () => {
      const row = await session();
      const r = await svc(approving('RR-LOST'), outbox()).capture(row);
      expect(r).toMatchObject({ outcome: 'unknown' });
      expect(await types(row.ticketId)).toEqual([]);                      // no half-recorded paid ticket
      expect((await ticket(row.ticketId)).status).toBe('open');
      expect(await payments(row.ticketId)).toEqual([expect.objectContaining({ status: 'processing', processor_transaction_id: 'RR-LOST', idempotency_key: `termcap_${row.id}` })]);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatch(/approved.*not recorded/i);
      expect(logged[0]).toContain(row.ticketId);
      // and the money is still never charged twice: the same session's next tap is a duplicate
      expect(await svc().capture(row)).toMatchObject({ outcome: 'duplicate' });
    });
  }

  it('declined is unchanged: the honest declined row, no paid-ticket events, the ticket stays open', async () => {
    const row = await session();
    const r = await svc(() => ({ authCard: async () => ({ approved: false, respstat: 'C', respText: 'Insufficient funds', retref: 'RR-D' }) } as any)).capture(row);
    expect(r).toMatchObject({ outcome: 'declined' });
    expect((await payments(row.ticketId))[0].status).toBe('declined');
    expect(await types(row.ticketId)).toEqual([]);
    expect((await ticket(row.ticketId)).status).toBe('open');
  });

  it('a double Pay tap racing into capture() charges the card ONCE (the second attempt finds the ticket busy)', async () => {
    const row = await session(); let calls = 0; let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const dev = () => ({ authCard: async () => { calls++; await gate; return { approved: true, retref: 'RR-TAP', respstat: 'A' }; } } as any);
    const a = svc(dev).capture(row); const b = svc(dev).capture(row);
    await new Promise((r) => setTimeout(r, 200)); release();
    const out = (await Promise.all([a, b])).map((x) => x.outcome).sort();
    expect(out).toEqual(['approved', 'ticket_busy']);
    expect(calls).toBe(1);
    expect(await payments(row.ticketId)).toHaveLength(1);
  });
});
