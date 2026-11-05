// tenant-number-isolation.pgtest — Payments/Twilio mandate §5 / §59 / §60 (wave 3), on the real schema:
//   • a phone number belongs to ONE salon — registering another salon's number is refused (before: the upsert silently
//     re-assigned it, taking over its inbound routing and sender);
//   • the registry row carries the provider SID, purpose and status (migration 639);
//   • the sender resolver names the salon's Messaging Service (MG…) once its A2P campaign is verified, else its ACTIVE
//     number, never a released one, never another salon's.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { TenantNumberService } from './tenant-number.service';
import { KyselySenderNumberResolver } from '../notifications/notifications.sender-numbers';
import { KyselyTenantSmsSenderResolver } from '../notifications/notifications.tenant-sender';

const A = 'a1a1a1a1-1111-4111-8111-111111111111', B = 'b2b2b2b2-2222-4222-8222-222222222222';
let db: any;
const audit = { record: vi.fn(async () => ({})) };
const svc = () => new TenantNumberService(db, audit as any, testProviderSecrets);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values (${A}, 'A LLC', 'A', 'num-a', 'NUMA'), (${B}, 'B LLC', 'B', 'num-b', 'NUMB')`.execute(db);
}, 180_000);

describe('tenant phone numbers (§59) — one salon per number', () => {
  it('salon A registers its number: active, general_sms', async () => {
    expect(await svc().registerExisting('u1', A, '+18565550101')).toMatchObject({ ok: true, number: '+18565550101' });
    const r = (await sql`select tenant_id::text as tenant_id, purpose, status from tenant_messaging_numbers where phone_number = '+18565550101'`.execute(db)).rows[0] as any;
    expect(r).toMatchObject({ tenant_id: A, purpose: 'general_sms', status: 'active' });
    // §137: a phone-number change is audited (action + tenant, never a credential)
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: A }), expect.objectContaining({ module: 'messaging', action: 'number.registered' }));
  });
  it('§5: salon B registering salon A\'s number is REFUSED and A keeps it', async () => {
    const out = await svc().registerExisting('u2', B, '+18565550101');
    expect(out.ok).toBe(false); expect(out.error).toMatch(/another salon/);
    const r = (await sql`select tenant_id::text as tenant_id from tenant_messaging_numbers where phone_number = '+18565550101'`.execute(db)).rows[0] as any;
    expect(r.tenant_id).toBe(A);
  });
  it('re-registering your own number is idempotent (stays active, one row)', async () => {
    expect((await svc().registerExisting('u1', A, '+18565550101')).ok).toBe(true);
    expect(Number((await sql`select count(*)::int c from tenant_messaging_numbers where phone_number = '+18565550101'`.execute(db)).rows[0].c)).toBe(1);
  });
});

describe('sender routing (§60)', () => {
  it('the ACTIVE number is the sender; a released number is not; another salon\'s number never is', async () => {
    const r = new KyselySenderNumberResolver(db);
    expect(await r.resolveFrom(A)).toBe('+18565550101');
    expect(await r.resolveFrom(B)).toBeNull();
    await sql`update tenant_messaging_numbers set status = 'released', released_at = now() where phone_number = '+18565550101'`.execute(db);
    expect(await r.resolveFrom(A)).toBeNull();
    await sql`update tenant_messaging_numbers set status = 'active', released_at = null where phone_number = '+18565550101'`.execute(db);
  });
  it('a verified A2P campaign on a Messaging Service makes the service (MG…) the sender', async () => {
    const MG = 'MG' + 'a'.repeat(32);
    await sql`insert into tenant_a2p_registrations (tenant_id, messaging_service_sid, campaign_status) values (${A}, ${MG}, 'PENDING')`.execute(db);
    expect(await new KyselySenderNumberResolver(db).resolveFrom(A)).toBe('+18565550101');   // pending → still the number
    await sql`update tenant_a2p_registrations set campaign_status = 'VERIFIED' where tenant_id = ${A}`.execute(db);
    expect(await new KyselySenderNumberResolver(db).resolveFrom(A)).toBe(MG);
    expect(await new KyselySenderNumberResolver(db).resolveFrom(B)).toBeNull();
  });
  it('a salon\'s OWN Twilio account with a Messaging Service sends through it (MessagingServiceSid, no From)', async () => {
    const AC = 'AC' + '1'.repeat(32), MG = 'MG' + 'b'.repeat(32);
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, messaging_service_sid, status, account_mode)
              values (${B}, 'twilio', ${AC}, ${testProviderSecrets.encrypt('tok-b')}, '+18565550202', ${MG}, 'configured', 'tenant_owned')`.execute(db);
    let seen: any;
    const http = (async (_u: string, init: any) => { seen = String(init.body); return new Response(JSON.stringify({ sid: 'SMb' }), { status: 201 }); }) as any;
    const sender = await new KyselyTenantSmsSenderResolver(db, testProviderSecrets, http).resolveSender(B);
    expect(sender).toBeTruthy();
    await sender!.send('+15551230000', 'hi');
    expect(seen).toContain('MessagingServiceSid=' + MG);
    expect(seen).not.toContain('From=');
    expect(await new KyselyTenantSmsSenderResolver(db, testProviderSecrets, http).resolveSender(A)).toBeNull();   // A has no own account
  });
});
