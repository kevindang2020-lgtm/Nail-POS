// tenant-a2p-audit.pgtest — wave 3 PAYI §137 / §55: an A2P status change (carrier review moving the brand or the campaign)
// and a number attachment are audited. Before: refresh() and attachNumber() wrote the new state silently, so nobody could
// tell when a salon's texting went live or was rejected. A refresh that changes nothing writes no audit row.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TenantA2pService } from './tenant-a2p.service';

const T = 'a2a2a2a2-1111-4111-8111-111111111111';
let db: any;
const audit = { record: vi.fn(async () => ({})) };
const fake = { getBrand: vi.fn(), getCampaign: vi.fn(), attachNumber: vi.fn(async () => ({})) };

beforeAll(async () => {
  process.env.TWILIO_ACCOUNT_SID = 'AC' + '0'.repeat(32); process.env.TWILIO_AUTH_TOKEN = 'test-token-not-real';
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values (${T}, 'A2P LLC', 'A2P', 'a2p-audit', 'A2PA')`.execute(db);
  await sql`insert into tenant_a2p_registrations (tenant_id, status, brand_sid, brand_status, messaging_service_sid, campaign_status)
            values (${T}, 'campaign_pending', ${'BN' + '1'.repeat(32)}, 'APPROVED', ${'MG' + '2'.repeat(32)}, 'IN_PROGRESS')`.execute(db);
}, 180_000);
afterAll(() => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });
beforeEach(() => { audit.record.mockClear(); });

function svc() {
  const s = new TenantA2pService(db, audit as any);
  (s as any).client = () => fake;
  return s;
}

describe('A2P audit trail (§137)', () => {
  it('a refresh that moves the campaign to VERIFIED records a2p.status_changed with from → to', async () => {
    fake.getBrand.mockResolvedValueOnce({ status: 'APPROVED' }); fake.getCampaign.mockResolvedValueOnce({ status: 'VERIFIED' });
    await svc().refresh(T);
    const calls = audit.record.mock.calls.filter((c: any[]) => c[1]?.action === 'a2p.status_changed');
    expect(calls).toHaveLength(1);
    expect((calls[0] as any[])[0]).toMatchObject({ tenantId: T });
    expect((calls[0] as any[])[1].metadata).toMatchObject({ from: { campaignStatus: 'IN_PROGRESS' }, to: { campaignStatus: 'VERIFIED' } });
  });
  it('a refresh that changes nothing is not audited', async () => {
    fake.getBrand.mockResolvedValueOnce({ status: 'APPROVED' }); fake.getCampaign.mockResolvedValueOnce({ status: 'VERIFIED' });
    await svc().refresh(T);
    expect(audit.record.mock.calls.filter((c: any[]) => c[1]?.action === 'a2p.status_changed')).toHaveLength(0);
  });
  it('attaching a number to the Messaging Service is audited', async () => {
    await svc().attachNumber('sa_1', T, 'PN' + 'a'.repeat(32));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, userId: 'sa_1' }), expect.objectContaining({ module: 'messaging', action: 'a2p.number_attached' }));
  });
});
