// service-pause-producer.pgtest — service.paused / service.resumed were declared since Constitution 8 and recorded by
// nothing. Both pause paths (the POS Serving screen and the technician's app) now record them on the canonical ticket, in
// the transaction of the marker that IS the fact, and only for a real transition.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyTechRepository } from '@aipowersalon/queue';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedTechnician } from './pgtest-seed';

const T = '2b2b2b2b-2b2b-42b2-82b2-2b2b2b2b2b2b', B = '2c2c2c2c-2c2c-42c2-82c2-2c2c2c2c2c2c', CU = '2d2d2d2d-2d2d-42d2-82d2-2d2d2d2d2d2d';
const TK = '2e2e2e2e-2e2e-42e2-82e2-2e2e2e2e2e2e', TECH = '2f2f2f2f-2f2f-42f2-82f2-2f2f2f2f2f2f', QT = '30303030-3030-4303-8303-303030303030', QT2 = '32323232-3030-4303-8303-303030303032', QT3 = '33333333-3030-4303-8303-303030303033';
const ctx = { tenantId: T, branchId: B, userId: '31313131-3131-4313-8313-313131313131' } as any;
let db: any; let repo: KyselyTechRepository;
const facts = async (type: string) => (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','S','Pause Salon','pausesalon','PAUSE2','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CU}','${T}','${B}','P','Q','P Q','+16095550122','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TK}','${T}','${B}','${CU}') ON CONFLICT (id) DO NOTHING;
  `);
  await seedTechnician(pg, TECH, T, B);
  const cols = (await pg.query(`select column_name, data_type from information_schema.columns where table_name='pos_tech_queue_tickets' and is_nullable='NO' and column_default is null`)).rows;
  const vals: Record<string, unknown> = { id: QT, tenant_id: T, branch_id: B, ticket_id: TK, assigned_technician_id: TECH, customer_name: 'P Q', status: 'in_service' };
  for (const c of cols) if (!(c.column_name in vals)) vals[c.column_name] = /uuid/.test(c.data_type) ? crypto.randomUUID() : /int|numeric/.test(c.data_type) ? 0 : /timestamp|date/.test(c.data_type) ? new Date().toISOString() : 'x';
  const keys = Object.keys(vals);
  await pg.query(`INSERT INTO pos_tech_queue_tickets (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')})`, keys.map((k) => vals[k]));
  for (const [id, status] of [[QT2, 'assigned'], [QT3, 'assigned']]) {
    const v2 = { ...vals, id, status }; const k2 = Object.keys(v2);
    await pg.query(`INSERT INTO pos_tech_queue_tickets (${k2.join(', ')}) VALUES (${k2.map((_, i) => '$' + (i + 1)).join(', ')})`, k2.map((k) => v2[k]));
  }
  repo = new KyselyTechRepository(db, new OutboxWriter());
});

describe('service.paused / service.resumed (the tech-app path)', () => {
  it('pause records service.paused once (a second pause is a no-op and records nothing); resume records service.resumed', async () => {
    await repo.pause(ctx, QT);
    await repo.pause(ctx, QT);
    const p = await facts('service.paused');
    expect(p.map((r) => r.aggregate_id)).toEqual([TK]);
    expect(p[0].payload_json).toMatchObject({ ticketId: TK, technicianId: TECH, source: 'tech_app' });
    await repo.resume(ctx, QT);
    expect((await facts('service.resumed')).map((r) => r.aggregate_id)).toEqual([TK]);
  });
  it('the projection refreshes the boards AND the technician\'s own app', async () => {
    const [e] = await facts('service.paused');
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (s: any, ev: any) => sent.push(['tenant', ev]), toTechnician: (id: string, ev: any) => sent.push(['technician', ev, id]) } as any)
      .handle({ eventType: 'service.paused', tenantId: T, branchId: B, aggregateId: e.aggregate_id, payload: e.payload_json } as any);
    expect(sent).toEqual([['tenant', 'service_paused'], ['technician', 'service_paused', TECH]]);
  });
});

describe('tech_queue.offer_accepted / offer_declined and service.started (the tech-app path)', () => {
  it('accept records once (a second accept lost the race and records nothing); start records service.started on the canonical ticket', async () => {
    expect(await repo.accept(ctx, QT2)).toBe(true);
    expect(await repo.accept(ctx, QT2)).toBe(false);
    const acc = await facts('tech_queue.offer_accepted');
    expect(acc.map((r) => r.aggregate_id)).toEqual([QT2]);
    expect(acc[0].payload_json).toMatchObject({ techQueueTicketId: QT2, ticketId: TK, technicianId: TECH });
    expect(await repo.start(ctx, QT2)).toBe(true);
    const st = (await facts('service.started')).filter((r) => r.payload_json?.techQueueTicketId === QT2);
    expect(st.map((r) => r.aggregate_id)).toEqual([TK]);
    expect(st[0].payload_json).toMatchObject({ source: 'tech_app', technicianId: TECH });
    const sent: string[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push('desk:' + ev), toTechnician: (id: string, ev: string) => sent.push((id === TECH ? 'tech:' : id) + ev) } as any)
      .handle({ eventType: 'tech_queue.offer_accepted', tenantId: T, branchId: B, aggregateId: QT2, payload: acc[0].payload_json } as any);
    expect(sent).toEqual(['desk:queue_updated', 'tech:queue_updated']);
  });
  it('decline records once, with the reason kept in the notes and out of the event', async () => {
    await repo.decline(ctx, QT3, { reason: 'double booked' } as any);
    await repo.decline(ctx, QT3, { reason: 'again' } as any);
    const d = await facts('tech_queue.offer_declined');
    expect(d.map((r) => r.aggregate_id)).toEqual([QT3]);
    expect(JSON.stringify(d[0].payload_json)).not.toContain('double booked');
    expect(String(((await sql`SELECT notes FROM pos_tech_queue_tickets WHERE id = ${QT3}`.execute(db)).rows[0] as any).notes)).toContain('double booked');
  });
});
