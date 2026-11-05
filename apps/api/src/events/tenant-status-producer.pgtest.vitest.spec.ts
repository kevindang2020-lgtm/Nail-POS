// tenant-status-producer.pgtest — platform.tenant_suspended / platform.tenant_activated were declared in the event contract
// since Constitution 8 and recorded by nothing. A Super Admin status change now records them in the same transaction; they
// are PLATFORM events (no tenant on the envelope, §168) and name the salon in their payload, which is how the realtime
// projection reaches exactly that salon's screens.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselySuperAdminTenantsRepo } from '@aipowersalon/super-admin';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = '12121212-1212-4121-8121-121212121212';
let db: any; let repo: KyselySuperAdminTenantsRepo;
const rows = async (type: string) => (await sql`SELECT event_type, tenant_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type}`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','P','Pause Salon','pause','PAUSE1','active') ON CONFLICT (id) DO NOTHING;`);
  repo = new KyselySuperAdminTenantsRepo(db, new OutboxWriter());
});

describe('Super Admin tenant status changes are recorded as platform events', () => {
  it('suspend -> platform.tenant_suspended, no tenant on the envelope, the salon in the payload', async () => {
    await repo.setStatus(T, 'suspended' as any);
    const [e] = await rows('platform.tenant_suspended');
    expect(e).toMatchObject({ tenant_id: null, aggregate_id: T });
    expect(e.payload_json).toEqual({ tenantId: T, status: 'suspended' });
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (scope: any, event: any, payload: any) => sent.push({ scope, event, payload }) } as any)
      .handle({ eventType: e.event_type, tenantId: undefined, aggregateId: e.aggregate_id, payload: e.payload_json } as any);
    expect(sent).toEqual([{ scope: { tenantId: T, branchId: '' }, event: 'tenant_status_updated', payload: { status: 'suspended' } }]);
  });
  it('reactivate -> platform.tenant_activated', async () => {
    await repo.setStatus(T, 'active' as any);
    expect((await rows('platform.tenant_activated')).map((r) => r.payload_json)).toEqual([{ tenantId: T, status: 'active' }]);
  });
  it('a status with no declared event records nothing (the service keeps its direct push for it)', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM outbox_events`.execute(db)).rows[0] as any;
    await repo.setStatus(T, 'cancelled' as any).catch(() => {});
    const after = (await sql`SELECT count(*)::int AS n FROM outbox_events`.execute(db)).rows[0] as any;
    expect(after.n).toBe(before.n);
  });
  it('a platform event without a salon in its payload is projected nowhere', async () => {
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (...a: any[]) => sent.push(a) } as any)
      .handle({ eventType: 'platform.tenant_suspended', tenantId: undefined, aggregateId: T, payload: {} } as any);
    expect(sent).toEqual([]);
  });
});
