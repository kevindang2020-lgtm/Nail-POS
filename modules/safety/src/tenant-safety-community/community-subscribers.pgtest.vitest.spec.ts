// community-subscribers.pgtest.vitest.spec.ts — BUILD_PLAN Phase 8 (agent C): the fan-out's recipient join against the
// REAL migrated schema (tenant_community_settings + tenants + community_follows, migrations 360 / 361 / 529). The posting
// salon is never a recipient, a disabled or inactive salon is excluded, a salon with no contact keeps in-app + push but is
// never given an invented address, follows ride along, and SMS goes only to a critical post's opted-in salons.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyInteractionsRepo } from './community-interactions.repository';
import { planFanout } from './community-notify';

const id = (n: number) => `c8a00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), EMAILER = id(2), SMSER = id(3), NOADDR = id(4), OFF = id(5), SUSPENDED = id(6);
let repo: KyselyInteractionsRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  const rows: [string, string, string | null, string | null, string][] = [
    [AUTHOR, 'SUBA', 'author@example.com', '+15550000001', 'active'], [EMAILER, 'SUBB', 'emailer@example.com', '+15550000002', 'active'],
    [SMSER, 'SUBC', 'sms@example.com', '+15550000003', 'active'], [NOADDR, 'SUBD', null, null, 'active'],
    [OFF, 'SUBE', 'off@example.com', '+15550000005', 'active'], [SUSPENDED, 'SUBF', 'susp@example.com', '+15550000006', 'suspended'],
  ];
  for (const [t, code, email, phone, status] of rows) {
    await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, email, business_phone) values ($1, $2, $2, $3, $2, $4, $5, $6)`, [t, code, code.toLowerCase(), status, email, phone]);
  }
  await pg.exec(`
    insert into tenant_community_settings (tenant_id, enabled, critical_sms_enabled, notify_categories) values
      ('${AUTHOR}', true, true, '[]'), ('${EMAILER}', true, false, '["gift_card_scam"]'), ('${SMSER}', true, true, '[]'),
      ('${NOADDR}', true, true, '[]'), ('${OFF}', false, true, '[]'), ('${SUSPENDED}', true, true, '[]');
    insert into community_follows (tenant_id, category, severity_min, channels) values ('${SMSER}', 'phone_scam', 'high', '["in_app","push"]');
  `);
  repo = new KyselyInteractionsRepo(kyselyFor(pg));
});

describe('fan-out recipients (real schema)', () => {
  it('every enabled, active salon except the author — with preferences and real contacts only', async () => {
    const r = await repo.fanoutRecipients(AUTHOR);
    expect(r.map((x) => x.tenantId).sort()).toEqual([EMAILER, SMSER, NOADDR].sort());
    const smser = r.find((x) => x.tenantId === SMSER)!;
    expect(smser.follows).toEqual([{ category: 'phone_scam', region: null, severityMin: 'high', channels: ['in_app', 'push'] }]);
    expect(r.find((x) => x.tenantId === EMAILER)!.notifyCategories).toEqual(['gift_card_scam']);
    expect(r.find((x) => x.tenantId === NOADDR)).toMatchObject({ email: null, phone: null });
  });
  it('plan: a critical phone scam reaches all three; SMS only where opted in AND a phone exists; no invented address', async () => {
    const plan = planFanout({ originTenantId: AUTHOR, category: 'phone_scam', region: null, severity: 'critical' }, await repo.fanoutRecipients(AUTHOR));
    const by = Object.fromEntries(plan.map((p) => [p.tenantId, p]));
    expect(Object.keys(by).sort()).toEqual([EMAILER, SMSER, NOADDR].sort());
    expect(by[SMSER].sms).toBe('+15550000003');
    expect(by[EMAILER].sms).toBeNull();
    expect(by[NOADDR]).toMatchObject({ sms: null, email: null });
  });
  it('plan: a moderate phone scam reaches only the salon with no preferences (follow needs high; the emailer wants gift cards)', async () => {
    const plan = planFanout({ originTenantId: AUTHOR, category: 'phone_scam', region: null, severity: 'moderate' }, await repo.fanoutRecipients(AUTHOR));
    expect(plan.map((p) => p.tenantId)).toEqual([NOADDR]);
  });
});
