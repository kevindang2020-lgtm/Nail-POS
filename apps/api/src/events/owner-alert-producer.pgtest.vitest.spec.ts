// owner-alert-producer.pgtest — acknowledging / resolving / dismissing an owner alert is recorded with the status write,
// only when the status actually changed, and the projection tells the owner app's room.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyOwnerRepository } from '@aipowersalon/analytics';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedRow } from './pgtest-seed';

const T = '4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a', B = '4b4b4b4b-4b4b-44b4-84b4-4b4b4b4b4b4b', AL = '4c4c4c4c-4c4c-44c4-84c4-4c4c4c4c4c4c', U = '4d4d4d4d-4d4d-44d4-84d4-4d4d4d4d4d4d';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'owner', permissions: ['owner.alerts.resolve'] } as any;
let db: any; let repo: KyselyOwnerRepository;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'O', display_name: 'Owner Salon', tenant_slug: 'ownersalon', tenant_code: 'OWNR01', status: 'active' });
  await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
  await seedRow(pg, 'owner_alerts', { id: AL, tenant_id: T, branch_id: B, category: 'general', severity: 'warning', status: 'new', title: 'Low stock: gel polish' });
  repo = new KyselyOwnerRepository(db, new OutboxWriter());
});

describe('owner_alert.status_changed', () => {
  it('acknowledge records it once (acknowledging again records nothing); resolve records the next change; the owner room is told', async () => {
    expect((await repo.updateAlertStatus(ctx, AL, 'acknowledged', U, false))?.status).toBe('acknowledged');
    await repo.updateAlertStatus(ctx, AL, 'acknowledged', U, false);
    expect((await repo.updateAlertStatus(ctx, AL, 'resolved', U, true))?.status).toBe('resolved');
    const rows = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = 'owner_alert.status_changed' ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(rows.map((r) => r.payload_json)).toEqual([{ alertId: AL, status: 'acknowledged', previousStatus: 'new' }, { alertId: AL, status: 'resolved', previousStatus: 'acknowledged' }]);
    expect(JSON.stringify(rows)).not.toContain('gel polish');
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push(['tenant', ev]), toOwner: (t: string, ev: string, pl: any) => sent.push(['owner', t === T ? 'T' : t, ev, pl.status]) } as any)
      .handle({ eventType: rows[1].event_type, tenantId: rows[1].tenant_id, branchId: rows[1].branch_id, aggregateId: rows[1].aggregate_id, payload: rows[1].payload_json } as any);
    expect(sent).toEqual([['owner', 'T', 'owner_alert_updated', 'resolved']]);
  });
});
