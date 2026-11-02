// stream-tickets.pgtest.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §28–32): the stream ticket against REAL Postgres
// (migration 557). Single use is ONE conditional UPDATE, so two redemptions racing for the same ticket open one stream.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyStreamTicketStore, StreamTicketService, hashTicket } from './stream-tickets';

const T = '11111111-1111-4111-8111-1111111111a7', B = '22222222-2222-4222-8222-2222222222a7', U = '33333333-3333-4333-8333-3333333333a7';
let pg: any; let svc: StreamTicketService; let store: KyselyStreamTicketStore;
const claims = () => ({ userId: U, tenantId: T, branchId: B, role: 'TECHNICIAN', permissions: [], subscriptionStatus: 'active', sid: 'sess-pg', exp: Math.floor(Date.now() / 1000) + 900 });

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Ticket Salon LLC','Ticket Salon','ticket-salon','TICKET','active') ON CONFLICT (id) DO NOTHING;`);
  store = new KyselyStreamTicketStore(kyselyFor(pg));
  svc = StreamTicketService.withStore(store);
}, 60_000);

describe('realtime_stream_tickets (557)', () => {
  it('stores only the hash, the binding and the expiry; redeems once', async () => {
    const { ticket } = await svc.issue({ claims: claims(), sessionId: 'sess-pg', deviceId: 'dev-0123456789abcdef' });
    const rows = (await pg.query(`SELECT ticket_hash, realm, tenant_id, branch_id, device_id, session_id, used_at, expires_at - created_at AS ttl FROM realtime_stream_tickets WHERE session_id='sess-pg'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticket_hash: hashTicket(ticket), realm: 'tenant', tenant_id: T, branch_id: B, device_id: 'dev-0123456789abcdef', used_at: null });
    const all = JSON.stringify((await pg.query(`SELECT * FROM realtime_stream_tickets`)).rows);
    expect(all.includes(ticket)).toBe(false);                                            // never the ticket itself
    await expect(svc.redeem({ ticket, path: '/tech/stream', deviceId: 'dev-0123456789abcdef' })).resolves.toMatchObject({ sid: 'sess-pg', tenantId: T });
    await expect(svc.redeem({ ticket, path: '/tech/stream', deviceId: 'dev-0123456789abcdef' })).rejects.toMatchObject({ status: 401 });
  });
  it('two concurrent redemptions of one ticket: exactly one wins', async () => {
    const { ticket } = await svc.issue({ claims: claims(), sessionId: 'sess-pg' });
    const r = await Promise.allSettled([store.consume(hashTicket(ticket), new Date()), store.consume(hashTicket(ticket), new Date())]);
    expect(r.filter((x) => x.status === 'fulfilled' && x.value).length).toBe(1);
  });
  it('an expired ticket redeems nothing; the database refuses a long-lived one', async () => {
    const { ticket } = await svc.issue({ claims: claims(), sessionId: 'sess-pg' });
    expect(await store.consume(hashTicket(ticket), new Date(Date.now() + 61_000))).toBeNull();
    await expect(pg.exec(`INSERT INTO realtime_stream_tickets (ticket_hash, session_id, realm, user_id, claims, expires_at)
      VALUES ('${'a'.repeat(64)}','s','tenant','u','{}', now() + interval '1 day')`)).rejects.toThrow(/short_lived/);
  });
});
