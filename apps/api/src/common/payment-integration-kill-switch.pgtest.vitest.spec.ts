// Constitution 7 §34 on the real schema: pausing a payment INTEGRATION (platform kill switch) makes every salon on it
// unable to charge — the resolver returns no processor, status 'paused' — and releasing it restores charging. The
// salon's own gateway configuration is never touched. Stopping it goes through the kill-switch centre (reason, history,
// audit).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { KillSwitchService } from '@aipowersalon/super-admin';

const A = '73737373-7373-4737-8737-737373737373', ACTOR = '74747474-7474-4747-8747-747474747474';
let db: any;
const newResolver = () => new PaymentGatewayResolver(db, { encrypt: (s: string) => s, decrypt: (s: string) => s } as any);
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'P','Pay Salon','paysalon','PAYS01','active')`, [A]);
  await pg.query(`INSERT INTO tenant_payment_config (tenant_id, processor, environment, base_url, merchant_id, api_username_enc, api_password_enc, status)
                  VALUES ($1,'fiserv','sandbox','https://isv-uat.cardconnect.com/cardconnect/rest','MID-A','user','pass','active')`, [A]);
});

describe('payment integration kill switch', () => {
  it('running: the salon gets its CardPointe processor', async () => {
    const g = await newResolver().resolve(A);
    expect(g).toMatchObject({ configured: true, status: 'active' });
    expect(g.processor).toBeTruthy();
  });
  it('stopped through the centre: no processor, status paused, pausedByPlatform; the salon config is untouched', async () => {
    const list = await new KillSwitchService(db).setSettingSwitch('payments.cardpointe', { userId: ACTOR }, true, 'processor outage at Fiserv');
    expect(list.find((k) => k.key === 'payments.cardpointe')).toMatchObject({ active: true, reason: 'processor outage at Fiserv' });
    const g = await newResolver().resolve(A);
    expect(g).toMatchObject({ configured: false, status: 'paused', pausedByPlatform: true });
    expect(g.processor).toBeUndefined();
    expect((await sql<any>`select status, merchant_id from tenant_payment_config where tenant_id = ${A}`.execute(db)).rows[0]).toEqual({ status: 'active', merchant_id: 'MID-A' });
  });
  it('the Clover switch does not affect CardPointe salons; releasing CardPointe restores charging', async () => {
    const svc = new KillSwitchService(db);
    await svc.setSettingSwitch('payments.clover', { userId: ACTOR }, true, 'clover api incident');
    await svc.setSettingSwitch('payments.cardpointe', { userId: ACTOR }, false, 'fiserv outage resolved');
    const g = await newResolver().resolve(A);
    expect(g).toMatchObject({ configured: true, status: 'active' });
  });
});
