// tech-help-producer.pgtest — a technician asking a colleague to take one service line: requested / accepted / declined are
// recorded with the request row (ids only — the note and any decline reason stay in the row), and the projection reaches
// exactly the audiences the service used to push to.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyHelpRepository } from '@aipowersalon/queue';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedRow, seedTechnician } from './pgtest-seed';

const T = '3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c', B = '3d3d3d3d-3d3d-43d3-83d3-3d3d3d3d3d3d', CU = '3e3e3e3e-3e3e-43e3-83e3-3e3e3e3e3e3e';
const TK = '3f3f3f3f-3f3f-43f3-83f3-3f3f3f3f3f3f', LINE = '40404040-4040-4404-8404-404040404040', LINE2 = '41414141-4141-4414-8414-414141414141';
const PRIMARY = '42424242-4242-4424-8424-424242424242', HELPER = '43434343-4343-4434-8434-434343434343';
const actor = { tenantId: T, branchId: B, userId: '44444444-4343-4434-8434-434343434344', technicianId: HELPER } as any;
let db: any; let repo: KyselyHelpRepository;
const facts = async (type: string) => (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];
async function project(row: any) {
  const sent: string[] = [];
  await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push('desk:' + ev), toTechnician: (id: string, ev: string) => sent.push(`${id === PRIMARY ? 'primary' : id === HELPER ? 'helper' : id}:` + ev) } as any)
    .handle({ eventType: row.event_type, tenantId: row.tenant_id, branchId: row.branch_id, aggregateId: row.aggregate_id, payload: row.payload_json } as any);
  return sent;
}
const req = (line: string) => ({ tenantId: T, branchId: B, ticketId: TK, serviceLineId: line, serviceId: null, primaryTechnicianId: PRIMARY, helperTechnicianId: HELPER,
  reason: 'busy', note: 'please take the pedicure', createdByUserId: null, createdByTechnicianId: PRIMARY } as any);

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'H', display_name: 'Help Salon', tenant_slug: 'helpsalon', tenant_code: 'HELP01', status: 'active' });
  await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
  await seedRow(pg, 'customers', { id: CU, tenant_id: T, branch_id: B, first_name: 'H', last_name: 'S', full_name: 'H S', normalized_phone: '+16095550144', status: 'active' });
  await seedTechnician(pg, PRIMARY, T, B); await seedTechnician(pg, HELPER, T, B);
  await seedRow(pg, 'tickets', { id: TK, tenant_id: T, branch_id: B, customer_id: CU });
  await seedRow(pg, 'ticket_service_lines', { id: LINE, tenant_id: T, ticket_id: TK, technician_id: PRIMARY, service_id: '45454545-4545-4454-8454-454545454545' });
  await seedRow(pg, 'ticket_service_lines', { id: LINE2, tenant_id: T, ticket_id: TK, technician_id: PRIMARY, service_id: '45454545-4545-4454-8454-454545454546' });
  repo = new KyselyHelpRepository(db, new OutboxWriter());
});

describe('technician help facts', () => {
  it('requested -> the asked helper (own room) and the desk; the note is not in the event', async () => {
    const r = await repo.insertRequest(actor, req(LINE));
    const [e] = await facts('tech_help.requested');
    expect(e.aggregate_id).toBe(r.id);
    expect(e.payload_json).toMatchObject({ ticketId: TK, serviceLineId: LINE, primaryTechnicianId: PRIMARY, helperTechnicianId: HELPER });
    expect(JSON.stringify(e.payload_json)).not.toContain('pedicure');
    expect(await project(e)).toEqual(['helper:technician_help_requested', 'desk:technician_help_requested']);
  });
  it('accepted once (a second accept loses the race and records nothing) -> desk accepted + line assigned, the primary told', async () => {
    const [{ aggregate_id: id }] = await facts('tech_help.requested');
    expect(await repo.transition(actor, id, 'pending', 'accepted', { respondedAt: new Date().toISOString() })).toBe(true);
    expect(await repo.transition(actor, id, 'pending', 'accepted', { respondedAt: new Date().toISOString() })).toBe(false);
    const acc = await facts('tech_help.accepted');
    expect(acc.length).toBe(1);
    expect(await project(acc[0])).toEqual(['desk:technician_help_accepted', 'desk:ticket_line_technician_assigned', 'primary:technician_help_accepted']);
  });
  it('declined -> the primary told, the desk told; the decline reason is not in the event', async () => {
    const r = await repo.insertRequest(actor, req(LINE2));
    expect(await repo.transition(actor, r.id, 'pending', 'declined', { respondedAt: new Date().toISOString(), declineReason: 'on my lunch' })).toBe(true);
    const [d] = await facts('tech_help.declined');
    expect(JSON.stringify(d.payload_json)).not.toContain('lunch');
    expect(await project(d)).toEqual(['primary:technician_help_declined', 'desk:technician_help_declined']);
  });
});
