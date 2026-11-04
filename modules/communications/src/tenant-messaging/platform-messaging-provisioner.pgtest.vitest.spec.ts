// platform-messaging-provisioner.pgtest — B-16 (Oct 20 2026): Super Admin provisions a PLATFORM-MANAGED salon's messaging —
// its Twilio subaccount → sealed token → Messaging Service → number (purchased, registered to this salon only, attached) →
// configured — on the real schema against a fake Twilio. Resumable after a failure, never a second subaccount, refuses a
// salon that brought its own account, honest "not configured" without the platform's master credentials.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { PlatformMessagingProvisioner } from './platform-messaging-provisioner';
import { KyselyTenantSmsSenderResolver } from '../notifications/notifications.tenant-sender';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';

const T = 'd1600000-0000-4000-8000-000000000001', T_OWN = 'd1600000-0000-4000-8000-000000000002', T_OTHER = 'd1600000-0000-4000-8000-000000000003';
const U = 'd1600000-0000-4000-8000-0000000000aa';
const MASTER = { TWILIO_ACCOUNT_SID: 'AC' + 'm'.repeat(32), TWILIO_AUTH_TOKEN: 'master-token', PUBLIC_API_BASE_URL: 'https://api.example' };
const SUB_SID = 'AC' + '5'.repeat(32), SUB_TOKEN = 'sub-token-secret-7788', MG = 'MG' + 'a'.repeat(32), PN = 'PN' + 'b'.repeat(32), NUMBER = '+18565550142';
let db: any;
const audit = { record: vi.fn(async () => ({})) };

/** A fake Twilio. `fail` names a step that answers 500 once. */
function twilio(opts: { existingSub?: boolean; fail?: string; number?: string } = {}) {
  const calls: string[] = []; let failed = false;
  const http = (async (url: string, init: any = {}) => {
    const m = init.method || 'GET'; const key = `${m} ${url.replace(/\?.*$/, '')}`; calls.push(key);
    const say = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body } as any);
    const step = key.includes('/Accounts.json') && m === 'POST' ? 'subaccount' : key.endsWith('/v1/Services') ? 'messaging_service' : key.includes('IncomingPhoneNumbers') ? 'purchase' : key.includes('/PhoneNumbers') ? 'attach' : null;
    if (opts.fail && step === opts.fail && !failed) { failed = true; return say(500, { message: `${step} exploded` }); }
    if (key.endsWith('/2010-04-01/Accounts.json') && m === 'GET') return say(200, { accounts: opts.existingSub ? [{ sid: SUB_SID, auth_token: SUB_TOKEN, status: 'active' }] : [] });
    if (key.endsWith('/2010-04-01/Accounts.json') && m === 'POST') return say(201, { sid: SUB_SID, auth_token: SUB_TOKEN, status: 'active' });
    if (key.endsWith('/v1/Services')) return say(201, { sid: MG });
    if (key.includes('/AvailablePhoneNumbers/US/Local.json')) return say(200, { available_phone_numbers: [{ phone_number: opts.number ?? NUMBER, friendly_name: '(856) 555-0142' }] });
    if (key.includes('/IncomingPhoneNumbers.json')) return say(201, { sid: PN, phone_number: new URLSearchParams(init.body).get('PhoneNumber') });
    if (key.endsWith(`/Services/${MG}/PhoneNumbers`)) return say(201, { sid: PN });
    return say(404, { message: 'no route ' + key });
  }) as typeof fetch;
  return { http, calls };
}
const prov = (http: typeof fetch, env: Record<string, string> = MASTER) => new PlatformMessagingProvisioner(db, audit as any, testProviderSecrets, http, env);
const row = async (t: string) => (await sql`select * from tenant_messaging_credentials where tenant_id = ${t} and branch_id is null`.execute(db)).rows[0] as any;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [t, code] of [[T, 'PM1'], [T_OWN, 'PM2'], [T_OTHER, 'PM3']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${code}, ${'Salon ' + code}, ${code.toLowerCase()}, ${code}, 'active')`.execute(db);
}, 180_000);
beforeEach(() => audit.record.mockClear());

describe('B-16: provisioning a platform-managed salon', () => {
  it('without the platform master credentials → not_configured, nothing written, no Twilio call', async () => {
    const tw = twilio();
    expect(await prov(tw.http, {}).provision(U, T, { reason: 'onboarding' })).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(tw.calls).toEqual([]); expect(await row(T)).toBeUndefined();
  });
  it('a failure part-way stops with the step and the reason; the retry RESUMES (one subaccount, one service), then the salon is live', async () => {
    const first = twilio({ fail: 'messaging_service' });
    const r1 = await prov(first.http).provision(U, T, { reason: 'onboarding', areaCode: '856' });
    expect(r1).toMatchObject({ ok: false, step: 'subaccount', error: expect.stringMatching(/messaging_service exploded/) });
    let r = await row(T);
    expect(r).toMatchObject({ account_mode: 'platform_managed', status: 'not_configured', account_sid: SUB_SID, provisioning_step: 'subaccount', provisioning_claimed_at: null });
    expect(r.provisioning_error).toMatch(/exploded/);
    expect(r.auth_token_enc).not.toContain('sub-token'); expect(testProviderSecrets.decrypt(r.auth_token_enc)).toBe(SUB_TOKEN);

    const second = twilio({ existingSub: true });
    const r2 = await prov(second.http).provision(U, T, { reason: 'onboarding', areaCode: '856' });
    expect(r2).toMatchObject({ ok: true, number: NUMBER, messagingServiceSid: MG });
    expect(second.calls.filter((c) => c.endsWith('/2010-04-01/Accounts.json'))).toEqual([]);   // subaccount already stored → not even looked up
    r = await row(T);
    expect(r).toMatchObject({ status: 'configured', account_mode: 'platform_managed', messaging_service_sid: MG, from_number: NUMBER, provisioning_step: 'done', provisioning_error: null });
    expect(r.provisioned_at).not.toBeNull();
    const num = (await sql`select tenant_id, provider_phone_number_sid, status from tenant_messaging_numbers where phone_number = ${NUMBER}`.execute(db)).rows[0] as any;
    expect(num).toMatchObject({ tenant_id: T, provider_phone_number_sid: PN, status: 'active' });
    expect(second.calls).toContain(`POST https://messaging.twilio.com/v1/Services/${MG}/PhoneNumbers`);
    // audited with the reason, never the token
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T }), expect.objectContaining({ action: 'messaging.platform_provisioned', metadata: expect.objectContaining({ reason: 'onboarding', accountSid: SUB_SID, number: NUMBER }) }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(SUB_TOKEN);
  });
  it('the live salon sends through ITS subaccount and Messaging Service', async () => {
    const sender: any = await new KyselyTenantSmsSenderResolver(db, testProviderSecrets).resolveSender(T);
    expect(sender).not.toBeNull();
    expect(JSON.stringify(sender)).toContain(SUB_SID);
    expect(JSON.stringify(sender)).toContain(MG);
  });
  it('Super Admin sees it as platform-managed and live — SIDs and the step only, never the token', async () => {
    const v = await new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets).getMasked(T);
    // SIDs are masked in every read (Phone & Messaging guide: SID masking) — first two letters + last four
    const mask = (x: string) => `${x.slice(0, 2)}…${x.slice(-4)}`;
    expect(v).toMatchObject({ status: 'configured', accountMode: 'platform_managed', accountSid: mask(SUB_SID), fromNumber: NUMBER, provisioning: { step: 'done', error: null, messagingServiceSid: mask(MG) } });
    expect(JSON.stringify(v)).not.toContain(SUB_SID);
    expect(v.provisioning?.provisionedAt).toEqual(expect.any(String));
    expect(JSON.stringify(v)).not.toContain(SUB_TOKEN);
  });
  it('provisioning again is a no-op that reports the live setup (no Twilio call)', async () => {
    const tw = twilio();
    expect(await prov(tw.http).provision(U, T, { reason: 'again' })).toMatchObject({ ok: true, alreadyProvisioned: true, number: NUMBER });
    expect(tw.calls).toEqual([]);
  });
  it('a salon that brought its OWN Twilio account is refused (409) — nothing of theirs is touched', async () => {
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, account_mode) values (${T_OWN}, 'twilio', ${'AC' + '9'.repeat(32)}, ${testProviderSecrets.encrypt('theirs')}, '+18565550199', 'configured', 'tenant_owned')`.execute(db);
    const tw = twilio();
    await expect(prov(tw.http).provision(U, T_OWN, { reason: 'x' })).rejects.toMatchObject({ status: 409, code: 'TENANT_OWNED_ACCOUNT' });
    expect(tw.calls).toEqual([]);
  });
  it('a run already in progress for the salon is refused (409); a stale claim (> 5 min) may be taken over', async () => {
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, status, account_mode, provisioning_claimed_at) values (${T_OTHER}, 'twilio', 'not_configured', 'platform_managed', now())`.execute(db);
    await expect(prov(twilio().http).provision(U, T_OTHER, { reason: 'x' })).rejects.toMatchObject({ status: 409, code: 'PROVISIONING_IN_PROGRESS' });
    await sql`update tenant_messaging_credentials set provisioning_claimed_at = now() - interval '6 minutes' where tenant_id = ${T_OTHER}`.execute(db);
    expect(await prov(twilio({ number: '+18565550177' }).http).provision(U, T_OTHER, { reason: 'x' })).toMatchObject({ ok: true, number: '+18565550177' });
  });
  it('a number already registered to ANOTHER salon is never taken over', async () => {
    const T4 = 'd1600000-0000-4000-8000-000000000004';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'PM4', 'Salon PM4', 'pm4', 'PM4', 'active')`.execute(db);
    const tw = twilio();
    const r = await prov(tw.http).provision(U, T4, { reason: 'x', phoneNumber: NUMBER });   // NUMBER belongs to T
    expect(r).toMatchObject({ ok: false, step: null, error: expect.stringMatching(/another salon/) });
    expect(tw.calls).toEqual([]);                                                          // refused before ANY Twilio call
    expect(await row(T4)).toBeUndefined();
    expect(((await sql`select tenant_id from tenant_messaging_numbers where phone_number = ${NUMBER}`.execute(db)).rows[0] as any).tenant_id).toBe(T);
  });
});

describe('§149 (Oct 28 2026): a cancelled salon\'s platform texting is shut down — number released, subaccount closed', () => {
  function offTwilio(opts: { failRelease?: boolean } = {}) {
    const calls: string[] = []; let failed = false;
    const http = (async (url: string, init: any = {}) => {
      const m = init.method || 'GET'; const key = `${m} ${url.replace(/\?.*$/, '')}`; calls.push(key);
      const say = (status: number, body: any) => ({ ok: status < 300, status, json: async () => body } as any);
      if (m === 'DELETE' && key.includes(`/IncomingPhoneNumbers/${PN}.json`)) { if (opts.failRelease && !failed) { failed = true; return say(500, { message: 'release exploded' }); } return say(204, {}); }
      if (m === 'POST' && key.endsWith(`/Accounts/${SUB_SID}.json`)) return say(200, { sid: SUB_SID, status: 'closed' });
      return say(404, { message: 'no route ' + key });
    }) as typeof fetch;
    return { http, calls };
  }
  it('an ACTIVE salon is refused — nothing is released', async () => {
    const tw = offTwilio();
    expect(await prov(tw.http).offboard(U, T, { reason: 'test' })).toMatchObject({ ok: false, reason: 'salon_not_cancelled' });
    expect(tw.calls).toEqual([]);
  });
  it('the sweep leaves a salon cancelled less than the grace period alone; past it, releases the number and closes the subaccount — resuming after a failure', async () => {
    await sql`update tenants set status = 'cancelled' where id = ${T}`.execute(db);
    await sql`update tenants set closed_at = now() - interval '2 days' where id = ${T}`.execute(db);
    const early = offTwilio();
    expect(await prov(early.http).offboardClosedSalons(new Date())).toMatchObject({ checked: 0 });
    await sql`update tenants set closed_at = now() - interval '40 days' where id = ${T}`.execute(db);
    const first = offTwilio({ failRelease: true });
    expect(await prov(first.http).offboardClosedSalons(new Date())).toMatchObject({ checked: 1, failed: 1 });
    expect((await row(T)).offboarding_error).toMatch(/release exploded/);
    const again = offTwilio();
    expect(await prov(again.http).offboardClosedSalons(new Date())).toMatchObject({ checked: 1, offboarded: 1 });
    const r = await row(T);
    expect(r).toMatchObject({ provisioning_step: 'offboarded', status: 'not_configured', auth_token_enc: null, from_number: null, offboarding_error: null });
    expect(r.offboarded_at).toBeTruthy();
    const n = (await sql`select status, released_at from tenant_messaging_numbers where phone_number = ${NUMBER}`.execute(db)).rows[0] as any;
    expect(n.status).toBe('released'); expect(n.released_at).toBeTruthy();
    expect(again.calls).toEqual([`DELETE https://api.twilio.com/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers/${PN}.json`, `POST https://api.twilio.com/2010-04-01/Accounts/${SUB_SID}.json`]);
    // a second run does nothing (no Twilio call)
    const third = offTwilio();
    expect(await prov(third.http).offboard(U, T, { reason: 'again' })).toMatchObject({ ok: true, alreadyOffboarded: true });
    expect(third.calls).toEqual([]);
  });
  it('a cancelled salon on its OWN Twilio account is never touched', async () => {
    await sql`update tenants set status = 'cancelled', closed_at = now() - interval '40 days' where id = ${T_OWN}`.execute(db);
    const tw = offTwilio();
    const r = await prov(tw.http).offboard(U, T_OWN, { reason: 'test' });
    expect(r.ok).toBe(false);
    expect(['not_platform_managed', 'nothing_to_offboard']).toContain((r as any).reason);
    expect(tw.calls).toEqual([]);
  });
});

