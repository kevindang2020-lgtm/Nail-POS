// hold-and-move.pgtest — POS Checkout's Hold Ticket and Move to Front Desk on the real schema (Oct 6 2026; migration 514).
// Both buttons used to show a message and change nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';

const T = 'c9000000-0000-4000-8000-000000000001', B = 'c9000000-0000-4000-8000-000000000002', B2 = 'c9000000-0000-4000-8000-000000000003';
const C = 'c9000000-0000-4000-8000-000000000004', U = 'c9000000-0000-4000-8000-000000000005';
const REG_FRONT = 'c9000000-0000-4000-8000-0000000000a1', REG_BACK = 'c9000000-0000-4000-8000-0000000000a2', REG_OTHER = 'c9000000-0000-4000-8000-0000000000a3', REG_RETIRED = 'c9000000-0000-4000-8000-0000000000a4';
const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'];
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: PERMS };
let pg: any; let svc: CheckoutService; let n = 0;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
async function ticket(): Promise<string> {
  n++;
  const id = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values ($1,$2,$3,'ready_checkout',$4,5000,0,0,5000,500) returning id`, [T, B, C, 'H' + n]))[0].id;
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,'00000000-0000-0000-0000-000000000000','Gel Manicure',5000,45,5000)`, [T, B, id]);
  return String(id);
}
const row = async (id: string) => (await svc.getState(ctx, {} as never) as any).tickets.items.find((t: any) => t.ticketId === id);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Hold LLC','Hold','hold-salon','HOLD01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$3,'Main','active'), ($2,$3,'Second','active')`, [B, B2, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Rae','Hold','Rae Hold')`, [C, T, B]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name, retired_at) values ($1,$5,$6,'Front Desk',null), ($2,$5,$6,'Back Register',null), ($3,$5,$7,'Second Front',null), ($4,$5,$6,'Old Register',now())`, [REG_FRONT, REG_BACK, REG_OTHER, REG_RETIRED, T, B, B2]);
  svc = new CheckoutService(new KyselyCheckoutRepository(kyselyFor(pg) as never));
});

describe('Hold Ticket', () => {
  it('sets the ticket aside with its tip and lines as they were; it leaves the ready count; Resume brings it back', async () => {
    const id = await ticket();
    const before = (await svc.getState(ctx, {} as never) as any).kpisFull.ticketsReadyForPayment;
    expect(await svc.holdTicket(ctx, id, true)).toEqual({ ticketId: id, status: 'on_hold' });
    expect((await row(id)).status).toBe('on_hold');
    expect((await svc.getState(ctx, {} as never) as any).kpisFull.ticketsReadyForPayment).toBe(before - 1);
    expect((await svc.getState(ctx, { status: 'on_hold' } as never) as any).tickets.items.map((t: any) => t.ticketId)).toEqual([id]);
    const [t] = await q(`select tip_cents, checkout_held_at is not null as held, checkout_held_by from tickets where id = $1`, [id]);
    expect(t).toEqual({ tip_cents: 500, held: true, checkout_held_by: U });
    await svc.holdTicket(ctx, id, false);
    expect((await row(id)).status).toBe('ready_for_payment');
  });

  it('a held ticket can still be paid, and paying clears the hold; a paid ticket cannot be held', async () => {
    const id = await ticket();
    await svc.holdTicket(ctx, id, true);
    const due = (await svc.recalculate(ctx, id, 'cash')).totalDueCents;
    await svc.payCash(ctx, id, { amountReceivedCents: due } as any);
    expect((await q(`select status, checkout_held_at from tickets where id = $1`, [id]))[0]).toEqual({ status: 'paid', checkout_held_at: null });
    await expect(svc.holdTicket(ctx, id, true)).rejects.toThrow(/paid ticket cannot be held/);
  });

  it('needs the take-payment permission', async () => {
    const id = await ticket();
    await expect(svc.holdTicket({ ...ctx, permissions: ['pos.checkout.view'], role: 'FRONT_DESK' }, id, true)).rejects.toThrow();
  });
});

describe('Move to Front Desk', () => {
  it('moves the ticket to one of this location\'s registers: it shows that register\'s name', async () => {
    const id = await ticket();
    expect(await svc.moveToRegister(ctx, id, REG_FRONT)).toEqual({ ticketId: id, registerId: REG_FRONT, station: 'Front Desk' });
    expect((await row(id)).station).toBe('Front Desk');
    expect((await q(`select checkout_register_id, station_label from tickets where id = $1`, [id]))[0]).toEqual({ checkout_register_id: REG_FRONT, station_label: 'Front Desk' });
    await svc.moveToRegister(ctx, id, REG_BACK);
    expect((await row(id)).station).toBe('Back Register');
    expect((await svc.getState(ctx, { station: 'Back Register' } as never) as any).tickets.items.map((t: any) => t.ticketId)).toContain(id);
  });

  it('refuses another location\'s register, a retired one, nonsense — and a paid ticket', async () => {
    const id = await ticket();
    for (const reg of [REG_OTHER, REG_RETIRED, 'not-a-uuid', '']) await expect(svc.moveToRegister(ctx, id, reg)).rejects.toThrow();
    expect((await q(`select checkout_register_id from tickets where id = $1`, [id]))[0].checkout_register_id).toBeNull();
    const due = (await svc.recalculate(ctx, id, 'cash')).totalDueCents;
    await svc.payCash(ctx, id, { amountReceivedCents: due } as any);
    await expect(svc.moveToRegister(ctx, id, REG_FRONT)).rejects.toThrow(/already paid/);
  });
});
