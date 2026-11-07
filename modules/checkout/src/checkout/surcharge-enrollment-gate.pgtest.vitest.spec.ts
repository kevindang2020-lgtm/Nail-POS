// surcharge-enrollment-gate.pgtest — Fiserv master build §9.2 on the real schema: a card surcharge exists only when the
// salon's own switch is on AND Fiserv enrolled the merchant that charges this branch, at Fiserv's per-MID rate. The
// salon's typed percent is never used; a branch with its own merchant follows THAT merchant, never the tenant default.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { resolveCheckoutSettings, resolveSurchargeEnrollment } from './checkout-settings.resolver';

const T = 'f1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BR_OWN = 'f1111111-1111-4111-8111-111111111111';   // has its own merchant account
const BR_DEF = 'f2111111-1111-4111-8111-111111111111';   // uses the tenant default
let pg: any; let db: any;
const q = (s: string, p: any[] = []) => pg.query(s, p);
const salonSwitch = (on: boolean, pct = 3) => q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', $2::jsonb)
  on conflict do nothing`, [T, JSON.stringify({ creditCardSurchargeEnabled: on, creditCardSurchargePercent: pct })]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Surcharge Salon','sur-salon','SURSAL','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$3,'Own MID','active'), ($2,$3,'Default MID','active')`, [BR_OWN, BR_DEF, T]);
  await q(`insert into tenant_payment_config (tenant_id, processor, status, environment, merchant_id) values ($1,'fiserv','active','sandbox','MID-T')`, [T]);
  await q(`insert into payment_merchant_accounts (tenant_id, branch_id, processor, merchant_id, status) values ($1,$2,'fiserv','MID-B','active')`, [T, BR_OWN]);
}, 180000);

describe('surcharge enrollment gate (§9.2)', () => {
  it('not enrolled anywhere → no surcharge even though the salon switched it on at 3%', async () => {
    await salonSwitch(true, 3);
    const s = await resolveCheckoutSettings(db, T, BR_DEF);
    expect(s).toMatchObject({ creditCardSurchargeEnabled: false, creditCardSurchargePercent: 0, surchargeEnrolled: false, surchargeRateBps: null });
  });

  it('tenant default enrolled at Fiserv\'s 2.50% → the default branch surcharges at 2.50%, not the salon\'s typed 3%', async () => {
    await q(`update tenant_payment_config set surcharge_enrolled = true, surcharge_rate_bps = 250, surcharge_reference = 'FSV-123' where tenant_id = $1`, [T]);
    const s = await resolveCheckoutSettings(db, T, BR_DEF);
    expect(s).toMatchObject({ creditCardSurchargeEnabled: true, creditCardSurchargePercent: 2.5, surchargeEnrolled: true, surchargeRateBps: 250 });
  });

  it('a branch with its OWN merchant follows that merchant (not enrolled) — never falls back to the enrolled default', async () => {
    const s = await resolveCheckoutSettings(db, T, BR_OWN);
    expect(s).toMatchObject({ creditCardSurchargeEnabled: false, surchargeEnrolled: false });
    expect(await resolveSurchargeEnrollment(db, T, BR_OWN)).toEqual({ enrolled: false, rateBps: null, scope: 'branch' });
  });

  it('enrolled but the salon switch is off → no surcharge (the disclosure still knows the merchant is enrolled)', async () => {
    await q(`update tenant_settings set settings_json = $2::jsonb where tenant_id = $1 and category = 'payments-checkout'`, [T, JSON.stringify({ creditCardSurchargeEnabled: false })]);
    expect(await resolveCheckoutSettings(db, T, BR_DEF)).toMatchObject({ creditCardSurchargeEnabled: false, surchargeEnrolled: true });
  });

  it('an out-of-range rate is treated as NOT enrolled (fail closed)', async () => {
    await q(`update payment_merchant_accounts set surcharge_enrolled = true, surcharge_rate_bps = 450 where tenant_id = $1 and branch_id = $2`, [T, BR_OWN]).catch(() => undefined);   // the DB check refuses >300
    await q(`update payment_merchant_accounts set surcharge_enrolled = true, surcharge_rate_bps = null where tenant_id = $1 and branch_id = $2`, [T, BR_OWN]);
    expect(await resolveSurchargeEnrollment(db, T, BR_OWN)).toEqual({ enrolled: false, rateBps: null, scope: 'branch' });
  });

  it('unknown tenant → not enrolled', async () => {
    expect(await resolveSurchargeEnrollment(db, 'f9aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null)).toEqual({ enrolled: false, rateBps: null, scope: 'none' });
  });
});
