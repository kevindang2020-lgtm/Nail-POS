// technician-invite.pgtest.vitest.spec.ts — the invitation reaches her, or says plainly that it did not.
//
// This path used to return `{ created: false, reason: 'no_email' }` for the exact person the feature exists for.
// `user_invitations.email` was NOT NULL — built for platform staff, who all have one — and a nail technician
// frequently does not. She has a mobile number. The account got created, the membership got created, and the
// person they belonged to was never told.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BR = 'a1111111-1111-1111-1111-111111111111';
const MGR = 'a2222222-2222-2222-2222-222222222222';
const ctx = { tenantId: T, branchId: BR, userId: MGR, role: 'MANAGER', permissions: [] };

let pg: PGlite;
let svc: GlobalTechIdentityService;
let platform: KyselySuperAdminPlatformRepo;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

/** A technicians row, as the manager's create flow writes it — before the identity is attached. */
async function roster(name: string) {
  const r: any = (await q(
    `insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active)
     values ($1,$2,$3,'X',$3,true) returning id`, [T, BR, name]))[0];
  return String(r.id);
}

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    if (f.startsWith('379')) await pg.exec(s);          // the new migration is NOT tolerant
    else try { await pg.exec(s); } catch { /* pg_trgm / btree_gist */ }
  }
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  svc = new GlobalTechIdentityService(db, new GlobalTechDirectory(db));
  platform = new KyselySuperAdminPlatformRepo(db as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
           values ($1,'Luxe','Luxe Nails','luxe','LUXE','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BR, T]);
}, 180000);

afterEach(() => {
  delete process.env.INVITE_NOTIFIER_URL;
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
  vi.unstubAllGlobals();
});

describe('the invitation reaches the technician', () => {
  it('SMS when she has a phone and no email — which is most nail technicians', async () => {
    const id = await roster('Olivia');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'Olivia Brown', phone: '856-555-1234', email: null });

    expect(r.invite.created).toBe(true);
    expect(r.invite.channel).toBe('sms');

    const [inv]: any = await q(`select email, normalized_phone, delivery_channel, role, status from user_invitations where tenant_id = $1 and normalized_phone = $2`, [T, '+18565551234']);
    expect(inv.email).toBeNull();                    // impossible before migration 379 — the column was NOT NULL
    expect(inv.normalized_phone).toBe('+18565551234');
    expect(inv.delivery_channel).toBe('sms');
    expect(inv.role).toBe('TECHNICIAN');
    expect(inv.status).toBe('pending');
  });

  it('email when she has one', async () => {
    const id = await roster('Ana');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'Ana Lee', phone: '856-555-2222', email: 'ana@example.com' });
    expect(r.invite.channel).toBe('email');
    const [inv]: any = await q(`select delivery_channel, email from user_invitations where lower(email) = 'ana@example.com'`);
    expect(inv.delivery_channel).toBe('email');
  });

  it('with NO notifier configured it says not_connected and hands back the token — it never says "sent"', async () => {
    // The difference between these two is the difference between a technician who got a text and a technician
    // sitting there waiting for one that was never sent, while the salon's screen says she was invited.
    const id = await roster('Mia');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'Mia Ruiz', phone: '856-555-3333', email: null });

    expect(r.invite.deliveryStatus).toBe('not_connected');
    expect(r.invite.manualToken).toBeTruthy();       // so a human can hand the link over

    const [inv]: any = await q(`select delivery_status, delivery_error from user_invitations where normalized_phone = '+18565553333'`);
    expect(inv.delivery_status).toBe('not_connected');
    expect(inv.delivery_error).toMatch(/notifier/i);
  });

  it('a technician with NEITHER a phone nor an email gets no invitation — and is told so', async () => {
    const id = await roster('Ghost');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'No Contact', phone: null, email: null });
    expect(r.invite).toMatchObject({ created: false, reason: 'no_contact' });
    // and the account still exists — she was hired; she just cannot be reached yet
    expect(r.techCode).toMatch(/^TECH-\d{6}$/);
  });

  it('the database itself refuses an invitation that could never reach anybody', async () => {
    // Migration 379's CHECK. An invitation with no email and no phone is not an invitation — it is a row that
    // sits there looking sent.
    await expect(pg.query(
      `insert into user_invitations (tenant_id, role, token_hash, token_prefix, expires_at)
       values ($1,'TECHNICIAN','h','p', now() + interval '7 days')`, [T],
    )).rejects.toThrow();
  });

  it('WITH TWILIO CONFIGURED THE TEXT ACTUALLY GOES OUT — and the row says delivered', async () => {
    // The transports were there the whole time. SendGrid and Twilio are wired for password resets and customer
    // OTPs and read the same env vars — and the invitation path used NEITHER. Its only route out was a generic
    // `INVITE_NOTIFIER_URL` webhook most operators will never stand up, so an invite reported `not_connected` on
    // a platform perfectly capable of sending it.
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15550000000';

    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return { ok: true, status: 201, json: async () => ({ sid: 'SM-REAL' }), headers: new Map() } as any;
    });

    const id = await roster('Lena');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'Lena Moore', phone: '856-555-4444', email: null });

    expect(r.invite.deliveryStatus).toBe('delivered');
    expect(r.invite.manualToken).toBeNull();          // nothing to hand over by hand — it was sent

    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('api.twilio.com');
    expect(decodeURIComponent(calls[0].body)).toContain('/accept-invite?token=');   // the real link, in the real text
    expect(decodeURIComponent(calls[0].body)).toContain('+18565554444');            // to her actual number

    const [inv]: any = await q(`select delivery_status from user_invitations where normalized_phone = '+18565554444'`);
    expect(inv.delivery_status).toBe('delivered');
  });

  it('a transport that FAILS is recorded as failed and hands the token back — never as sent', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15550000000';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, json: async () => ({ message: 'bad number' }), headers: new Map() } as any));

    const id = await roster('Bad');
    const r = await svc.attachToTechnician(ctx as any, id, { fullName: 'Bad Number', phone: '856-555-5555', email: null });

    expect(r.invite.deliveryStatus).not.toBe('delivered');
    expect(r.invite.manualToken).toBeTruthy();        // so a human can still get her onboarded
    const [inv]: any = await q(`select delivery_status from user_invitations where normalized_phone = '+18565555555'`);
    expect(inv.delivery_status).toBe('not_connected');   // transport failed → fell through to the notifier, which is unset
  });

  it('a second create for the same technician does not mint a second pending invite', async () => {
    const r = await svc.attachToTechnician(ctx as any, await roster('Olivia'), { fullName: 'Olivia Brown', phone: '856-555-1234', email: null });
    expect(r.invite).toMatchObject({ created: false, reason: 'already_pending' });
    expect(r.linkedExistingProfile).toBe(true);      // and it linked her existing account rather than duplicating it
    const [{ n }]: any = await q(`select count(*)::int n from user_invitations where normalized_phone = '+18565551234'`);
    expect(n).toBe(1);
  });
});

describe('SHE CAN ACTUALLY ACCEPT IT — the end of the chain', () => {
  it('an SMS-invited technician accepts, and the row that activates is HER row — not a second one', async () => {
    // == THE BUG THIS PROVES CLOSED ========================================================================
    //
    // acceptInvitation used to resolve the account with `lower(email) = lower(${inv.email})`. EMAIL ONLY.
    //
    // For an SMS invitation email is NULL, so it matched nothing and dropped through to INSERTING A SECOND
    // `users` ROW — one with no global_tech_profile_id, and not the row `technicians.user_id` points at. She
    // would set a password, be told she was all set, and the Tech App still would not open.
    //
    // Everything in this test is the chain that failure ran through.
    const technicianId = await roster('Sofia');
    const r = await svc.attachToTechnician(ctx as any, technicianId, { fullName: 'Sofia Cruz', phone: '856-555-7777', email: null });
    expect(r.invite.created).toBe(true);
    expect(r.invite.channel).toBe('sms');

    // the invitation NAMES the row it is for
    const [inv]: any = await q(`select id, user_id, email, normalized_phone from user_invitations where normalized_phone = '+18565557777'`);
    expect(inv.email).toBeNull();
    expect(String(inv.user_id)).toBe(r.userId);

    // she accepts with the real token
    const token = r.invite.manualToken!;      // no notifier configured in the test → handed back for manual delivery
    expect(token).toBeTruthy();
    const out: any = await platform.acceptInvitation({ token, password: 'a-good-password-123', fullName: 'Sofia Cruz' });
    expect(out.ok).toBe(true);

    // ── ONE users row at this salon. Not two.
    const [{ n }]: any = await q(`select count(*)::int n from users where tenant_id = $1 and normalized_phone = $2`, [T, '+18565557777']);
    expect(n).toBe(1);

    // ── and it is HER row: active, with a password, still linked to her global account
    const [u]: any = await q(`select id, status, password_hash, global_tech_profile_id from users where id = $1`, [r.userId]);
    expect(u.status).toBe('active');
    expect(u.password_hash).toBeTruthy();
    expect(String(u.global_tech_profile_id)).toBe(r.profileId);

    // ── THE TECH APP OPENS. This is the query it makes, and it is the one that used to return nothing.
    const [t]: any = await q(
      `select id from technicians where tenant_id = $1 and user_id = $2 and is_active = true`, [T, r.userId]);
    expect(String(t.id)).toBe(technicianId);
  });
});
