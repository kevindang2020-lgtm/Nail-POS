// time-clock-producer.pgtest — technician.clocked_in / clocked_out were declared since Constitution 8 and recorded by
// nothing. A punch now records them in its own transaction, and the projection refreshes the Staff-on-Duty boards with
// the same time_clock_updated event the service used to push directly.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyTimeClockRepository } from '@aipowersalon/workforce';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedTechnician } from './pgtest-seed';

const T = '13131313-1313-4131-8131-131313131313', B = '14141414-1414-4141-8141-141414141414', TECH = '15151515-1515-4151-8151-151515151515';
const ctx = { tenantId: T, branchId: B, userId: '16161616-1616-4161-8161-161616161616' } as any;
let db: any; let repo: KyselyTimeClockRepository;
const rows = async (type: string) => (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type}`.execute(db)).rows as any[];
async function project(e: any) {
  const sent: any[] = [];
  await new RealtimeProjectionConsumer({ toTenant: (scope: any, event: any, payload: any) => sent.push({ scope, event, payload }) } as any)
    .handle({ eventType: e.event_type, tenantId: e.tenant_id, branchId: e.branch_id, aggregateId: e.aggregate_id, payload: e.payload_json } as any);
  return sent;
}

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','C','Clock Salon','clock','CLOCK1','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
  `);
  await seedTechnician(pg, TECH, T, B);   // was a silently-failing insert (display_name does not exist)
  repo = new KyselyTimeClockRepository(db, new OutboxWriter());
});

describe('clock punches record technician.clocked_in / clocked_out (§343)', () => {
  it('clock in -> technician.clocked_in in the punch transaction -> time_clock_updated (clocked_in) on that branch', async () => {
    const { punch } = await repo.insertPunch(ctx, TECH, '2026-09-27', new Date().toISOString());   // merge Oct 12: { punch, created } (idempotent clock-in)
    const [e] = await rows('technician.clocked_in');
    expect(e).toMatchObject({ tenant_id: T, branch_id: B, aggregate_id: punch.id });
    expect(e.payload_json).toMatchObject({ technicianId: TECH, shiftDate: '2026-09-27' });
    expect(await project(e)).toEqual([{ scope: { tenantId: T, branchId: B }, event: 'time_clock_updated', payload: { technicianId: TECH, state: 'clocked_in' } }]);
    const closed = await repo.closePunch(ctx, punch.id, new Date().toISOString());
    expect(closed?.id).toBe(punch.id);
    const [o] = await rows('technician.clocked_out');
    expect(o).toMatchObject({ aggregate_id: punch.id, branch_id: B });
    expect((await project(o))[0].payload).toEqual({ technicianId: TECH, state: 'clocked_out' });
  });
});
