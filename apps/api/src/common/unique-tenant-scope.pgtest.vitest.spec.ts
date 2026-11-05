// unique-tenant-scope.pgtest — BUILD_PLAN Phase 15 C (Constitution 1 §35 "unique rules are tenant-scoped unless global by
// design"; docs/UNIQUE_INDEX_TENANT_REVIEW.md), on the real migrated schema.
//
// The review of the 96 non-PK unique indexes on tenant tables that do not include tenant_id found two places where two
// salons legitimately hold the same value and the second one was silently refused:
//   1. payment_gateway_events — the card-processor webhook's duplicate CHECK reads (tenant, processor, event id), but the
//      claim index uq_payment_gateway_events_processed (538) was (processor, event id): salon B's settlement / refund
//      event that happens to carry the same processor event id as one of salon A's was answered "duplicate" and never
//      applied. Processor event ids are only promised unique inside one merchant's stream (each salon is its own
//      merchant, with its own webhook secret). 567/568 replace it with (tenant_id, processor_type, event_id).
//   2. security_incidents.incident_ref (global by design — a platform reference) was built by the fraud detector from
//      rule + day + subject, and a card-testing subject without a branch was `branch:none` for EVERY salon: the second
//      salon's card-testing incident that day hit ON CONFLICT DO NOTHING and was dropped (and its owner never told).
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentWebhookService } from '@aipowersalon/payments';
import { cardTestingFindings, fraudIncidentRef } from './fraud-detector';

let pg: any; let db: any;
const TA = 'd1500000-0000-4000-8000-00000000000a', TB = 'd1500000-0000-4000-8000-00000000000b';
const BA = 'd1510000-0000-4000-8000-00000000000a', BB = 'd1510000-0000-4000-8000-00000000000b';
const SECRET_A = 'p15-unique-fixture-a', SECRET_B = 'p15-unique-fixture-b';   // test fixtures, not credentials
const resolver: any = { resolveTenantByMerchantId: async (mid: string) => mid === 'MID-A' ? { tenantId: TA, webhookSecret: SECRET_A, merchantIdMasked: '***A' } : mid === 'MID-B' ? { tenantId: TB, webhookSecret: SECRET_B, merchantIdMasked: '***B' } : null };
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];
const count = async (table: string, where: string, p: unknown[] = []) => Number((await one(`SELECT count(*)::int c FROM ${table} WHERE ${where}`, p)).c);
function deliver(processor: string, body: Record<string, unknown>, secret: string) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return new PaymentWebhookService(db, resolver).handle(processor, raw, body, sig, { 'x-webhook-signature': sig });
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[TA, 'P15UA'], [TB, 'P15UB']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A'), ('${BB}', '${TB}', 'B')`);
}, 120_000);

describe('payment_gateway_events: a processor event id is unique per SALON, not platform-wide', () => {
  it('two salons on the SAME processor whose settlement events share an event id → both settlements are applied', async () => {
    const a = await deliver('cardpointe', { merchantId: 'MID-A', eventType: 'settlement.batch_closed', eventId: 'evt-p15-shared', settlementId: 'BATCH-A', grossCents: 5000 }, SECRET_A);
    const b = await deliver('cardpointe', { merchantId: 'MID-B', eventType: 'settlement.batch_closed', eventId: 'evt-p15-shared', settlementId: 'BATCH-B', grossCents: 7000 }, SECRET_B);
    expect(a.body).toMatchObject({ ok: true, recordedSettlement: true });
    expect(b.body, 'salon B was answered "duplicate" for salon A\'s event').toMatchObject({ ok: true, recordedSettlement: true });
    expect(await count('payment_settlements', `tenant_id = $1 AND settlement_id = 'BATCH-B'`, [TB])).toBe(1);
    expect(await count('payment_gateway_events', `event_id = 'evt-p15-shared' AND processed_at IS NOT NULL`)).toBe(2);
  });

  it('the same event delivered twice to ONE salon (in sequence and concurrently) is still applied once', async () => {
    const body = { merchantId: 'MID-B', eventType: 'settlement.batch_closed', eventId: 'evt-p15-once', settlementId: 'BATCH-B2', grossCents: 100 };
    const out = await Promise.all([deliver('cardpointe', body, SECRET_B), deliver('cardpointe', body, SECRET_B), deliver('cardpointe', body, SECRET_B)]);
    expect(out.filter((o) => (o.body as any).duplicate === true).length).toBe(2);
    expect((await deliver('cardpointe', body, SECRET_B)).body).toMatchObject({ duplicate: true });
    expect(await count('payment_settlements', `tenant_id = $1 AND settlement_id = 'BATCH-B2'`, [TB])).toBe(1);
    expect(await count('payment_gateway_events', `tenant_id = $1 AND event_id = 'evt-p15-once' AND processed_at IS NOT NULL`, [TB])).toBe(1);
  });

  it('the schema: the tenant-scoped claim index exists and the platform-wide one is gone', async () => {
    const defs = (await pg.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'payment_gateway_events' AND indexdef LIKE 'CREATE UNIQUE%'`)).rows;
    expect(defs.map((d: any) => d.indexname)).not.toContain('uq_payment_gateway_events_processed');
    expect(defs.find((d: any) => d.indexname === 'uq_payment_gateway_events_tenant_processed')?.indexdef).toMatch(/\(tenant_id, processor_type, event_id\) WHERE \(\(event_id IS NOT NULL\) AND \(processed_at IS NOT NULL\)\)/);
  });

  it('a PROCESSED event with no salon is refused (NULL tenants never collide in a unique index, so the CHECK closes that gap); unprocessed attempts may have none', async () => {
    await pg.query(`INSERT INTO payment_gateway_events (processor_type, event_id, signature_valid) VALUES ('clover', 'evt-p15-nt', false)`);
    await expect(pg.query(`INSERT INTO payment_gateway_events (processor_type, event_id, signature_valid, processed_at) VALUES ('clover', 'evt-p15-nt', true, now())`))
      .rejects.toThrow(/chk_payment_gateway_events_processed_tenant/);
  });
});

describe('security_incidents.incident_ref: the fraud detector names one incident per SALON', () => {
  it('two salons with card testing at no branch on the same day get two different references', () => {
    const f = cardTestingFindings([{ tenantId: TA, branchId: null, declines: 50 }, { tenantId: TB, branchId: null, declines: 50 }]);
    expect(f).toHaveLength(2);
    const refs = f.map((x) => fraudIncidentRef(x, '20261010'));
    expect(new Set(refs).size).toBe(2);
    expect(refs.every((r) => r.length <= 120)).toBe(true);
  });
  it('the platform-wide finding (sms_wave, no salon) keeps one reference per day; a branch finding stays per branch', () => {
    expect(fraudIncidentRef({ rule: 'sms_wave', level: 'HIGH', tenantId: null, subject: 'platform', explanation: '' }, '20261010')).toBe('FRAUD-sms_wave-20261010-platform');
    const [x] = cardTestingFindings([{ tenantId: TA, branchId: BA, declines: 50 }]);
    expect(fraudIncidentRef(x, '20261010')).toContain(BA);
  });
  it('two salons\' card-testing incidents on the same day are BOTH stored', async () => {
    for (const f of cardTestingFindings([{ tenantId: TA, branchId: null, declines: 50 }, { tenantId: TB, branchId: null, declines: 50 }])) {
      await pg.query(`INSERT INTO security_incidents (incident_ref, title, description, category, severity, status, detection_source, tenant_id, detected_at)
        VALUES ($1, 'Fraud pattern: card testing', 'x', 'fraud', 'high', 'detected', 'fraud_detector', $2, '2026-10-10T12:00:00Z') ON CONFLICT (incident_ref) DO NOTHING`, [fraudIncidentRef(f, '20261010'), f.tenantId]);
    }
    expect(await count('security_incidents', `detection_source = 'fraud_detector' AND tenant_id = ANY($1)`, [[TA, TB]])).toBe(2);
  });
});
