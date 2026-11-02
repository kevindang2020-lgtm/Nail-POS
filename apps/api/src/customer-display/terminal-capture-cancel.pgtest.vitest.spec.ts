// terminal-capture-cancel.pgtest — Oct 19 audit item, rebuilt Oct 21 2026: once the Bolt terminal was prompting for a card
// there was no way to call it off. A guest who walked away (or chose cash) left the terminal prompting until Bolt's own
// timeout, the ticket's checkout lock and the terminal lease held the whole time (cash refused with PAYMENT_IN_PROGRESS),
// and the eventual non-answer was recorded as a DECLINE — which, with one attempt key per display session, also meant
// that session could never pay by card again. Now the front desk cancels the prompt (Bolt /api/v2/cancel): the attempt
// ends as 'cancelled', nothing is recorded, the lease and the lock are released, and the same session can try again
// (card or cash). A cancel that reaches the terminal AFTER it already approved the card changes nothing: approved wins.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { TerminalCaptureService } from './terminal-capture.service';

const T = '11111111-1111-4111-8111-1111111111e7', B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae7', C = 'dddddddd-dddd-4ddd-8ddd-dddddddddde7';
const TERM = 'cccccccc-cccc-4ccc-8ccc-cccccccccce7', CAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
let db: any; let n = 0;

async function session(): Promise<any> {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`.execute(db);
  const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'e7h' + n}, ${tk.id}) returning id`.execute(db)).rows[0];
  return { id: String(s.id), tenantId: T, branchId: B, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: C, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, createdAt: new Date().toISOString() };
}
const payments = async (ticketId: string) => (await sql`SELECT status FROM payments WHERE ticket_id = ${ticketId}`.execute(db)).rows as any[];

/** a terminal that prompts until it is cancelled (then answers like Bolt: not approved, "Cancelled") or until `approve()` */
function promptingTerminal() {
  let settle!: (r: any) => void; const answered = new Promise<any>((res) => { settle = res; });
  const calls: string[] = [];
  const device = {
    name: 'sim', calls,
    authCard: async () => { calls.push('authCard'); return answered; },
    cancel: async (hsn: string) => { calls.push('cancel ' + hsn); settle({ approved: false, declined: false, respstat: 'C', respText: 'Cancelled' }); },
    approve: () => settle({ approved: true, retref: 'RR-E7', respstat: 'A' }),
  };
  return device;
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'E', 'E Salon', 'e-term', 'ETERM7', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000)`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
  await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSNE7')`.execute(db);
  await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.cardpointe.com', 'enc')`.execute(db);
}, 120_000);

let leases: InMemoryTerminalLeases; let emitted: any[];
beforeEach(() => { leases = new InMemoryTerminalLeases(); emitted = []; });
const emitter = { toTenant: (_s: any, event: string, payload: any) => { emitted.push({ event, payload }); } };
const svc = (device: any) => new TerminalCaptureService(db, () => device, (x) => x, emitter as any, leases, undefined, new OutboxWriter(), { error: () => undefined });
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('the front desk can cancel a terminal prompt', () => {
  it('cancel while prompting → outcome cancelled, nothing recorded, lease free, the session can pay again', async () => {
    const row = await session(); const dev = promptingTerminal(); const s = svc(dev);
    const capture = s.capture(row);
    await tick();
    expect(dev.calls).toEqual(['authCard']);
    expect(await s.cancel(T, row.id)).toEqual({ cancelled: true });
    expect(dev.calls).toEqual(['authCard', 'cancel HSNE7']);
    expect(await capture).toMatchObject({ outcome: 'cancelled' });
    expect(await payments(row.ticketId)).toEqual([]);                                          // no row: not a decline
    expect(emitted.at(-1)).toMatchObject({ event: expect.any(String), payload: { sessionId: row.id, cancelled: true } });
    expect(await leases.acquire(T, TERM, 'someone-else')).toBe(true);                           // the terminal is free
    await leases.release(T, TERM, 'someone-else');
    // the same session tries again — and this time the guest taps
    const dev2 = promptingTerminal(); const again = svc(dev2).capture(row);
    await tick(); dev2.approve();
    expect(await again).toMatchObject({ outcome: 'approved', retref: 'RR-E7' });
    expect(await payments(row.ticketId)).toEqual([{ status: 'approved' }]);
  });
  it('nothing in progress for that session → cancelled: false with the reason (no terminal call)', async () => {
    const row = await session(); const dev = promptingTerminal();
    expect(await svc(dev).cancel(T, row.id)).toEqual({ cancelled: false, reason: 'NOTHING_IN_PROGRESS' });
    expect(dev.calls).toEqual([]);
  });
  it('another salon cannot cancel this salon\'s prompt', async () => {
    const row = await session(); const dev = promptingTerminal(); const s = svc(dev);
    const capture = s.capture(row); await tick();
    expect(await s.cancel('22222222-2222-4222-8222-222222222222', row.id)).toEqual({ cancelled: false, reason: 'NOTHING_IN_PROGRESS' });
    expect(dev.calls).toEqual(['authCard']);
    dev.approve(); expect(await capture).toMatchObject({ outcome: 'approved' });
  });
  it('a cancel that lands after the terminal approved changes nothing: the approval stands', async () => {
    const row = await session(); const dev = promptingTerminal(); const s = svc(dev);
    const capture = s.capture(row); await tick();
    dev.cancel = async (hsn: string) => { dev.calls.push('cancel ' + hsn); dev.approve(); };   // the card was already read
    expect(await s.cancel(T, row.id)).toEqual({ cancelled: true });                            // the request was sent …
    expect(await capture).toMatchObject({ outcome: 'approved', retref: 'RR-E7' });            // … but approved wins
    expect(await payments(row.ticketId)).toEqual([{ status: 'approved' }]);
  });
});
