// offer-expiry-producer.pgtest — the platform sweep expires tech-queue offers nobody answered before their acceptance
// deadline. Each expiry is now a recorded fact (tech_queue.offer_expired) in the sweep's own transaction; a second pass
// expires nothing and records nothing; the projection refreshes the desk and the technician's own queue.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyTechQueueRepository } from '@aipowersalon/queue';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedRow, seedTechnician } from './pgtest-seed';

const T = '46464646-4646-4464-8464-464646464646', B = '47474747-4747-4474-8474-474747474747', TECH = '48484848-4848-4484-8484-484848484848';
const DUE = '49494949-4949-4494-8494-494949494949', LATER = '4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a';
let db: any; let repo: KyselyTechQueueRepository;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'O', display_name: 'Offer Salon', tenant_slug: 'offersalon', tenant_code: 'OFFR01', status: 'active' });
  await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
  await seedTechnician(pg, TECH, T, B);
  await seedRow(pg, 'pos_tech_queue_tickets', { id: DUE, tenant_id: T, branch_id: B, customer_name: 'Guest', assigned_technician_id: TECH, status: 'assigned' });
  await seedRow(pg, 'pos_tech_queue_tickets', { id: LATER, tenant_id: T, branch_id: B, customer_name: 'Guest 2', assigned_technician_id: TECH, status: 'assigned' });
  await pg.query(`UPDATE pos_tech_queue_tickets SET acceptance_deadline = now() - interval '1 minute' WHERE id = $1`, [DUE]);
  await pg.query(`UPDATE pos_tech_queue_tickets SET acceptance_deadline = now() + interval '1 hour' WHERE id = $1`, [LATER]);
  repo = new KyselyTechQueueRepository(db, new OutboxWriter());
});

describe('tech_queue.offer_expired', () => {
  it('the sweep records one fact per offer it actually expires; a second pass records nothing', async () => {
    const first = await repo.expireDueOffers(Date.now());
    const second = await repo.expireDueOffers(Date.now());
    expect(first.map((o) => o.id)).toEqual([DUE]);
    expect(second).toEqual([]);
    const out = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = 'tech_queue.offer_expired'`.execute(db)).rows as any[];
    expect(out.map((r) => r.aggregate_id)).toEqual([DUE]);
    expect(out[0]).toMatchObject({ tenant_id: T, branch_id: B });
    expect(out[0].payload_json).toMatchObject({ techQueueTicketId: DUE, technicianId: TECH });
    const sent: string[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push('desk:' + ev), toTechnician: (id: string, ev: string) => sent.push((id === TECH ? 'tech:' : id + ':') + ev) } as any)
      .handle({ eventType: out[0].event_type, tenantId: out[0].tenant_id, branchId: out[0].branch_id, aggregateId: out[0].aggregate_id, payload: out[0].payload_json } as any);
    expect(sent).toEqual(['desk:queue_updated', 'tech:queue_updated']);
  });
});
