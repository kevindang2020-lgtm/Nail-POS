// ticket-status-replicas.pgtest — Round 2 C (Oct 12 2026): the ticket's checkout status lives in the DATABASE only.
// KyselyCheckoutRepository kept the board status in a per-process Map (`statuses`): with two API replicas one process
// showed — and acted on — a status another had already changed (sent to the display, reopened, paid). Two repository
// instances over ONE database stand in for two replicas: B must see what A wrote, and B's guards must refuse on the row,
// never on what B remembers.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';

const T = 'c9100000-0000-4000-8000-000000000001', B = 'c9100000-0000-4000-8000-000000000002';
const C = 'c9100000-0000-4000-8000-000000000004', U = 'c9100000-0000-4000-8000-000000000005';
const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.reopen_service', 'checkout.reopen_service'];
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: PERMS };
let pg: any; let repoA: KyselyCheckoutRepository; let repoB: KyselyCheckoutRepository; let svcA: CheckoutService; let svcB: CheckoutService; let n = 0;
const events: any[] = [];
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
async function ticket(): Promise<string> {
  n++;
  const id = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values ($1,$2,$3,'ready_checkout',$4,5000,0,0,5000,0) returning id`, [T, B, C, 'R' + n]))[0].id;
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,'00000000-0000-0000-0000-000000000000','Gel Manicure',5000,45,5000)`, [T, B, id]);
  return String(id);
}
const statusOn = async (r: KyselyCheckoutRepository, id: string) => (await r.ticket(ctx, id))?.status;
const boardRow = async (s: CheckoutService, id: string) => (await s.getState(ctx, {} as never) as any).tickets.items.find((t: any) => t.ticketId === id);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Replica LLC','Replica','replica-salon','REPL01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Rae','Replica','Rae Replica')`, [C, T, B]);
  const outbox: any = { write: async (_x: unknown, e: any) => { events.push(e); } };
  repoA = new KyselyCheckoutRepository(kyselyFor(pg) as never, outbox);
  repoB = new KyselyCheckoutRepository(kyselyFor(pg) as never, outbox);
  svcA = new CheckoutService(repoA); svcB = new CheckoutService(repoB);
});

describe('two replicas over one database', () => {
  it('B sees the display status A wrote — on the ticket and on the board — and it is stored on the row', async () => {
    const id = await ticket();
    expect(await statusOn(repoB, id)).toBe('ready_for_payment');
    expect(await repoA.setStatus(ctx, id, 'sent_to_customer_display')).toBe(true);
    expect(await statusOn(repoB, id)).toBe('sent_to_customer_display');
    expect((await boardRow(svcB, id)).status).toBe('sent_to_customer_display');
    expect((await q(`select checkout_status from tickets where id = $1`, [id]))[0].checkout_status).toBe('sent_to_customer_display');
  });

  it('A pays a ticket B last saw on the display: B shows it paid and B\'s reopen is refused (the row, not B\'s memory)', async () => {
    const id = await ticket();
    await repoB.setStatus(ctx, id, 'sent_to_customer_display');
    expect(await statusOn(repoB, id)).toBe('sent_to_customer_display');
    expect(await repoA.setStatus(ctx, id, 'paid')).toBe(true);
    expect(await statusOn(repoB, id)).toBe('paid');
    await expect(svcB.reopen(ctx, id, { reason: 'wrong service' } as any)).rejects.toThrow(/ALREADY_PAID/);
    expect((await q(`select status from tickets where id = $1`, [id]))[0].status).toBe('paid');
    expect(await statusOn(repoA, id)).toBe('paid');
  });

  it('a board status is never written over a paid row: B\'s stale send-to-display / reopen land nowhere', async () => {
    const id = await ticket();
    await repoA.setStatus(ctx, id, 'paid');
    expect(await repoB.setStatus(ctx, id, 'sent_to_customer_display')).toBe(false);
    expect(await repoB.setStatus(ctx, id, 'reopened')).toBe(false);
    expect(await statusOn(repoB, id)).toBe('paid');
    expect(await statusOn(repoA, id)).toBe('paid');
  });

  it('A reopens; B sees reopened. A payment in progress on A refuses B\'s stale reopen on the row', async () => {
    const id = await ticket();
    await svcA.reopen(ctx, id, { reason: 'add polish change' } as any);
    expect(await statusOn(repoB, id)).toBe('reopened');
    const id2 = await ticket();
    expect(await statusOn(repoB, id2)).toBe('ready_for_payment');           // B read it payable …
    await repoA.setStatus(ctx, id2, 'payment_in_progress');                  // … A started a payment …
    expect(await repoB.setStatus(ctx, id2, 'reopened')).toBe(false);         // … B's reopen is refused by the row
    expect(await statusOn(repoA, id2)).toBe('payment_in_progress');
  });

  it('B\'s reopen that read the ticket just before A paid it is refused by the row (409), and the row stays paid', async () => {
    const id = await ticket();
    const stale = await repoB.ticket(ctx, id);                               // B's read: payable
    await repoA.setStatus(ctx, id, 'paid');                                  // A pays in between
    const spy = vi.spyOn(repoB, 'ticket').mockResolvedValueOnce(stale as never);
    await expect(svcB.reopen(ctx, id, { reason: 'late reopen' } as any)).rejects.toMatchObject({ code: 'CHECKOUT_ALREADY_IN_PROGRESS' });
    spy.mockRestore();
    expect((await q(`select status, checkout_status from tickets where id = $1`, [id]))[0]).toEqual({ status: 'paid', checkout_status: null });
  });

  it('a voided payment returns the ticket to payable in the DATABASE (B sees it); paying it again is not a second visit', async () => {
    const id = await ticket();
    events.length = 0;
    await repoA.setStatus(ctx, id, 'paid');
    expect(events.filter((e) => e.eventType === 'visit.completed')).toHaveLength(1);
    expect(await repoA.setStatus(ctx, id, 'ready_for_payment')).toBe(true);  // reopenIfNoLongerPaid after a void
    expect(await statusOn(repoB, id)).toBe('ready_for_payment');
    expect((await boardRow(svcB, id))?.status).toBe('ready_for_payment');
    expect((await q(`select status from tickets where id = $1`, [id]))[0].status).toBe('ready_checkout');
    expect(await repoB.isPaid(ctx, id)).toBe(false);
    await repoB.setStatus(ctx, id, 'paid');
    expect(await statusOn(repoA, id)).toBe('paid');
    expect(events.filter((e) => e.eventType === 'visit.completed')).toHaveLength(1);
  });

  it('a ticket paid outside the checkout repository (the display terminal) shows paid even with a board status on it', async () => {
    const id = await ticket();
    await repoA.setStatus(ctx, id, 'sent_to_customer_display');
    await q(`update tickets set status = 'paid', paid_at = now() where id = $1`, [id]);
    expect(await statusOn(repoA, id)).toBe('paid');
    expect(await statusOn(repoB, id)).toBe('paid');
  });

  it('the repository keeps no per-process status or discount map', () => {
    for (const r of [repoA, repoB]) for (const v of Object.values(r as any)) expect(v instanceof Map).toBe(false);
  });
});
