// BUILD_PLAN Phase 12 (#27): the support_ticket machine on the REAL schema — today's triage table still holds, a move
// it does not list is refused, and a triager who read a stale state gets 'conflict' (the update is conditional).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SupportTicketsService } from './support-tickets.service';
import { SUPPORT_TICKET } from './support-ticket-lifecycle';

const T = '5c000000-0000-4000-8000-0000000000a1';
const U = '5c000000-0000-4000-8000-0000000000c1';
let pg: any; let svc: SupportTicketsService;
const ctx = { tenantId: T, branchId: '', userId: U, role: 'OWNER', permissions: ['help.triage', 'help.view'] };
const statusOf = async (id: string) => (await pg.query(`select status, assigned_agent from support_tickets where id = $1`, [id])).rows[0];
const ticket = async (status = 'submitted') => {
  const r = await svc.createTicket(ctx, { subject: 'Printer offline', description: 'The receipt printer stopped', category: 'general' });
  expect(r.ok).toBe(true);
  if (status !== 'submitted') await pg.query(`update support_tickets set status = $2 where id = $1`, [r.ticket!.id, status]);
  return r.ticket!.id;
};

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Help LLC','Help','help-lc','HELPLC','active')`, [T]);
  await pg.query(`insert into users (id, tenant_id, email, full_name, role, status, password_hash) values ($1,$2,'help-owner@example.test','Help Owner','OWNER','active','x')`, [U, T]).catch(() => undefined);
  svc = new SupportTicketsService(kyselyFor(pg) as never);
}, 120_000);

describe('support_ticket machine', () => {
  it('reproduces the triage table: submitted → assigned (by assigning) → in_progress → resolved → closed → reopened', async () => {
    const id = await ticket();
    expect(await svc.assignTicket(ctx, id, 'Kim')).toEqual({ ok: true });
    expect(await statusOf(id)).toEqual({ status: 'assigned', assigned_agent: 'Kim' });
    for (const to of ['in_progress', 'resolved', 'closed', 'reopened']) expect(await svc.transitionStatus(ctx, id, to)).toEqual({ ok: true });
    expect((await statusOf(id)).status).toBe('reopened');
  });
  it('a move the table does not list is refused and writes nothing (closed → in_progress)', async () => {
    const id = await ticket('closed');
    expect(await svc.transitionStatus(ctx, id, 'in_progress')).toEqual({ ok: false, error: 'invalid_transition' });
    expect((await statusOf(id)).status).toBe('closed');
  });
  it('re-assigning a ticket past assignment changes the agent only (no status write)', async () => {
    const id = await ticket('resolved');
    expect(await svc.assignTicket(ctx, id, 'Lee')).toEqual({ ok: true });
    expect(await statusOf(id)).toEqual({ status: 'resolved', assigned_agent: 'Lee' });
  });
  it('two triagers race from the same state: one lands, the other gets conflict (no lost update)', async () => {
    const id = await ticket('in_progress');
    const r = await Promise.all([svc.transitionStatus(ctx, id, 'resolved'), svc.transitionStatus(ctx, id, 'waiting_customer')]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const lost = r.find((x) => !x.ok)!;
    expect(['conflict', 'invalid_transition']).toContain(lost.error);
    expect(['resolved', 'waiting_customer']).toContain((await statusOf(id)).status);
    expect(SUPPORT_TICKET.can('closed', 'in_progress')).toBe(false);
  });
});
