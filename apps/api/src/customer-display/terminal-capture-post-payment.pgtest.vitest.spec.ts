// terminal-capture-post-payment.pgtest — Phase 15 round 3: a ticket paid on the customer display's terminal gets the SAME
// post-payment work as a ticket paid at the POS. Round 2 made the approval the canonical paid path (payment row, paid
// ticket, events in one transaction) but the POS's afterPaid — deals / coupons redeemed, reward code spent, technician
// compensation frozen, membership commission booked, review request, gift cards sold or reloaded on the ticket activated —
// never ran for it: a gift card sold on a terminal-paid ticket stayed worthless ('pending_payment'), the deal was never
// counted as redeemed, and the technician had no compensation snapshot (payroll missed the service).
//
// Now TerminalCaptureService hands a newly recorded approval to CheckoutService.runPostPaymentWork — the POS's own afterPaid,
// not a copy — once, after the paid transaction commits (as the POS does). A duplicate approval or a retry doubles nothing,
// a ticket that is not paid gets nothing, and a failing step is logged with the ticket, never swallowed.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { CheckoutService, KyselyCheckoutRepository, InMemoryTerminalLeases } from '@aipowersalon/checkout';
import { DealsCheckoutService, KyselyDealsLedger } from '@aipowersalon/deals';
import { CompensationService, KyselyCompensationPorts } from '@aipowersalon/workforce';
import { MembershipCompService, KyselyMembershipCompRepository } from '@aipowersalon/memberships';
import { TerminalCaptureService } from './terminal-capture.service';

const T = '11111111-1111-4111-8111-1111111111a8', B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', C = 'dddddddd-dddd-4ddd-8ddd-dddddddddda8';
const TERM = 'cccccccc-cccc-4ccc-8ccc-cccccccccca8', CAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeea1', SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeea2';
const TECH = 'ffffffff-ffff-4fff-8fff-ffffffffffa8', DEAL = '99999999-9999-4999-8999-9999999999a8';
let db: any; let n = 0;

/** A ticket carrying all three: a technician's service line, a deal applied to it, and a gift card sold on it (pending). */
async function session(): Promise<any> {
  n++;
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot)
            values (${T}, ${B}, ${tk.id}, ${SVC}, ${TECH}, 'Gel Manicure', 5000, 45, 5000, 'percent', 40)`.execute(db);
  await sql`insert into gift_cards (tenant_id, code, status, purchased_cents, initial_balance_cents, balance_cents, sale_ticket_id) values (${T}, ${'GC-A8-' + n}, 'pending_payment', 2500, 2500, 0, ${tk.id})`.execute(db);
  await sql`insert into deal_redemptions (deal_id, tenant_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status) values (${DEAL}, ${T}, ${C}, ${tk.id}, 500, 1, 'applied')`.execute(db);
  const s: any = (await sql`insert into customer_display_sessions (tenant_id, branch_id, public_token_hash, ticket_id) values (${T}, ${B}, ${'a8h' + n}, ${tk.id}) returning id`.execute(db)).rows[0];
  return { id: String(s.id), tenantId: T, branchId: B, state: 'payment_processing', ticketId: String(tk.id), ticketNumber: null, customerId: C, publicTokenHash: null, selectedTipCents: 0, subtotalCents: 5000, paymentMethod: 'card', expiresAt: null, closedAt: null, ticketStatus: 'open', lastPaymentStatus: null };
}
const one = async (q: any) => (await q.execute(db)).rows[0] as any;
const giftCard = (ticketId: string) => one(sql`select status, balance_cents, (select count(*)::int from gift_card_transactions x where x.gift_card_id = g.id and x.type = 'activate') as activations from gift_cards g where sale_ticket_id = ${ticketId}`);
const redemption = (ticketId: string) => one(sql`select status from deal_redemptions where ticket_id = ${ticketId}`);
const dealCount = async () => Number((await one(sql`select redemption_count from deals where id = ${DEAL}`)).redemption_count);
const snapshots = async (ticketId: string) => (await sql`select technician_id, tech_service_earnings_cents from ticket_compensation_snapshots where ticket_id = ${ticketId}`.execute(db)).rows as any[];
const facts = async (ticketId: string) => (await sql`select event_type from outbox_events where tenant_id = ${T} and payload_json->>'ticketId' = ${ticketId} and event_type in ('deal.redeemed', 'gift_card.issued') order by event_type`.execute(db)).rows.map((r: any) => r.event_type);
const approving = (retref = 'RR-A8') => () => ({ authCard: async () => ({ approved: true, retref, respstat: 'A' }) } as any);

beforeAll(async () => {
  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'H', 'H Salon', 'h-term', 'HTERM8', 'active') on conflict (id) do nothing`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active') on conflict (id) do nothing`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Kim', 'Tran', 'Kim Tran')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000) on conflict (id) do nothing`.execute(db);
  await sql`insert into deals (id, tenant_id, owner_type, title, discount_type, discount_percent, status) values (${DEAL}, ${T}, 'salon', 'Ten off', 'percent', 10, 'active')`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'payments-checkout', ${JSON.stringify({ customerDisplayCaptureMode: 'terminal' })}::jsonb)`.execute(db);
  await sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn) values (${TERM}, ${T}, ${B}, 'Front', 'paired', 'HSNA8')`.execute(db);
  await sql`insert into tenant_payment_config (tenant_id, merchant_id, bolt_base_url, bolt_api_key_enc) values (${T}, 'M1', 'https://bolt.test', 'enc')`.execute(db);
}, 120_000);

let leases: InMemoryTerminalLeases; let logged: string[]; let outbox: OutboxWriter; let checkout: CheckoutService;
const log = { error: (m: string) => { logged.push(m); } };
/** The CheckoutService the API wires (its real Kysely repository, deals ledger, compensation and membership commission). */
const realCheckout = (deals: KyselyDealsLedger = new KyselyDealsLedger(db, outbox)) => {
  const c = new CheckoutService(new KyselyCheckoutRepository(db, outbox), undefined, undefined, undefined, undefined, undefined,
    new CompensationService(new KyselyCompensationPorts(db)), new MembershipCompService(new KyselyMembershipCompRepository(db))).useDeals(new DealsCheckoutService({} as any, deals));
  (c as any).useMoneyPathLog?.(log);
  return c;
};
beforeEach(() => { leases = new InMemoryTerminalLeases(); logged = []; outbox = new OutboxWriter(); checkout = realCheckout(); });
const svc = (device = approving(), co: CheckoutService = checkout) => new TerminalCaptureService(db, device, (x) => x, undefined, leases, undefined, outbox, log, co);

describe('terminal-paid ticket — the POS post-payment work runs, once', () => {
  it('(a) a gift card sold on the ticket is ACTIVATED with its value, one activation, one gift_card.issued', async () => {
    const row = await session();
    expect(await svc().capture(row)).toMatchObject({ outcome: 'approved' });
    expect(await giftCard(row.ticketId)).toEqual({ status: 'active', balance_cents: 2500, activations: 1 });
    expect((await facts(row.ticketId)).filter((e) => e === 'gift_card.issued')).toHaveLength(1);
    expect(logged).toEqual([]);
  });

  it('(b) the deal applied to the ticket is REDEEMED (counted once, deal.redeemed recorded)', async () => {
    const row = await session(); const before = await dealCount();
    await svc().capture(row);
    expect((await redemption(row.ticketId)).status).toBe('redeemed');
    expect(await dealCount()).toBe(before + 1);
    expect((await facts(row.ticketId)).filter((e) => e === 'deal.redeemed')).toHaveLength(1);
  });

  it('(c) the technician\'s compensation snapshot is written from the service line', async () => {
    const row = await session();
    await svc().capture(row);
    const s = await snapshots(row.ticketId);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ technician_id: TECH });
    expect(Number(s[0].tech_service_earnings_cents)).toBeGreaterThan(0);
  });

  it('a duplicate approval, a second Pay delivery and a retried post-payment run double NOTHING', async () => {
    const row = await session(); const before = await dealCount();
    await svc().capture(row);
    expect(await svc().capture(row)).toMatchObject({ outcome: 'duplicate' });
    expect(await svc().recordApproval(row as any, `termcap_${row.id}`, 5000, 0, 'RR-AGAIN')).toMatchObject({ duplicate: true });
    await checkout.runPostPaymentWork({ tenantId: T, branchId: B }, row.ticketId);   // a retry of the post-payment work itself
    expect(await giftCard(row.ticketId)).toEqual({ status: 'active', balance_cents: 2500, activations: 1 });
    expect(await dealCount()).toBe(before + 1);
    expect(await snapshots(row.ticketId)).toHaveLength(1);
    expect(await facts(row.ticketId)).toEqual(['deal.redeemed', 'gift_card.issued']);
  });

  it('a ticket that is NOT paid gets no post-payment work (the gift card stays unpaid, the deal applied)', async () => {
    const row = await session();
    await checkout.runPostPaymentWork({ tenantId: T, branchId: B }, row.ticketId);
    expect(await giftCard(row.ticketId)).toEqual({ status: 'pending_payment', balance_cents: 0, activations: 0 });
    expect((await redemption(row.ticketId)).status).toBe('applied');
    expect(await snapshots(row.ticketId)).toHaveLength(0);
  });

  it('a declined card runs none of it', async () => {
    const row = await session();
    await svc(() => ({ authCard: async () => ({ approved: false, respstat: 'C', respText: 'Declined', retref: 'RR-D' }) } as any)).capture(row);
    expect(await giftCard(row.ticketId)).toEqual({ status: 'pending_payment', balance_cents: 0, activations: 0 });
    expect((await redemption(row.ticketId)).status).toBe('applied');
  });

  it('a step that fails is LOGGED with the ticket (best-effort after the money, as on the POS) and the rest still runs', async () => {
    const row = await session();
    const broken = new KyselyDealsLedger(db, outbox); (broken as any).markTicketPaid = async () => { throw new Error('deals ledger down'); };
    const r = await svc(approving(), realCheckout(broken)).capture(row);
    expect(r).toMatchObject({ outcome: 'approved' });                         // the payment stands
    expect((await redemption(row.ticketId)).status).toBe('applied');          // the lifecycle job redeems it later
    expect(await giftCard(row.ticketId)).toMatchObject({ status: 'active' }); // later steps still ran
    expect(logged.some((m) => /deals/i.test(m) && m.includes(row.ticketId) && /deals ledger down/.test(m))).toBe(true);
  });
});
