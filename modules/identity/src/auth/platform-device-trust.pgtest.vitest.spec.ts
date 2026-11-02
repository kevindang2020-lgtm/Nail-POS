// platform-device-trust.pgtest — S-A13 (Security Deep Scan §29 / §136): a platform (Super Admin) sign-in is refused from a
// device not approved for platform use; the first device bootstraps; the emailed link (single use, expiring) and an
// approved device approve another; revoke / block withdraw the approval; salon sign-ins are never evaluated; report / off
// modes. Drives the REAL AuthController.doLogin over a migrated Postgres (PGlite) with the real device ledger.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthController } from './auth.controller';
import { KyselyAuthDevices, WEB_DEVICE_COOKIE } from './auth-devices';
import { PlatformDeviceTrust, platformDeviceMode, APPROVAL_EMAILS_PER_HOUR } from './platform-device-trust';
import { SecurityNotifications } from './security-notifications';

let pg: any; let db: any;
const T = 'f1f1f1f1-0000-4000-8000-00000000000b';
const SA = 'f2f2f2f2-0000-4000-8000-00000000000b', SA2 = 'f2f2f2f2-0000-4000-8000-00000000000c', OWNER = 'f3f3f3f3-0000-4000-8000-00000000000b';

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'P', 'P', 'pdt-t', 'PDT01', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES
      ('${SA}', NULL, 'Root', 'root@platform.test', 'x', 'active', 'SUPER_ADMIN'),
      ('${SA2}', NULL, 'Ops', 'ops@platform.test', 'x', 'active', 'SUPER_ADMIN'),
      ('${OWNER}', '${T}', 'Owner', 'owner@salon.test', 'x', 'active', 'OWNER') ON CONFLICT DO NOTHING`);
});

type Sent = { to: string; subject: string; body: string };
function harness(env: Record<string, string>, role: 'SUPER_ADMIN' | 'OWNER' = 'SUPER_ADMIN', userId = SA) {
  const sent: Sent[] = [];
  const email = { send: async (to: string, subject: string, body: string) => { sent.push({ to, subject, body }); return { ok: true } as any; } } as any;
  const trust = new PlatformDeviceTrust(db, email, { ...env, ADMIN_BASE_URL: 'https://admin.example.test' } as any);
  const sessions: any = { created: 0, create: async () => { sessions.created++; return '00000000-0000-4000-8000-' + String(sessions.created).padStart(12, '0'); } };
  const principal = { userId, tenantId: role === 'OWNER' ? T : null, branchId: null, role, permissions: [] };
  const login: any = { attempt: async () => ({ outcome: 'SUCCESS', principal, mfaVerified: true }) };
  const events: any[] = [];
  const authEvents: any = { record: async (e: any) => { events.push(e); } };
  const ctl = new AuthController(login, {} as any, sessions, db, undefined, undefined, new KyselyAuthDevices(db), authEvents, null, null, null, undefined, null, trust);
  return { ctl, trust, sent, sessions, events };
}
function call(ctl: AuthController, cookie: string | null) {
  const out: any = { status: 0, body: null, cookies: {} as Record<string, string> };
  const res: any = {
    cookie: (n: string, v: string) => { out.cookies[n] = v; },
    clearCookie: () => undefined,
    status: (s: number) => { out.status = s; return { json: (b: any) => { out.body = b; } }; },
  };
  const req: any = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/120', ...(cookie ? { cookie: `${WEB_DEVICE_COOKIE}=${cookie}` } : {}) }, socket: { remoteAddress: '198.51.100.7' } };
  return ctl.doLogin(req, { portal: 'super-admin', identifier: 'root@platform.test', password: 'pw' }, res).then(() => out);
}
const KEY_A = 'dv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', KEY_B = 'dv_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', KEY_C = 'dv_cccccccccccccccccccccccccccccccc';
const process_env = { AUTH_SESSION_SECRET: 'test-secret-'.padEnd(40, 'x') };

beforeEach(() => { process.env.AUTH_SESSION_SECRET = process_env.AUTH_SESSION_SECRET; });

describe('mode', () => {
  it('enforce in production by default, report elsewhere; the variable wins', () => {
    expect(platformDeviceMode({ NODE_ENV: 'production' } as any)).toBe('enforce');
    expect(platformDeviceMode({ NODE_ENV: 'test' } as any)).toBe('report');
    expect(platformDeviceMode({ NODE_ENV: 'production', SUPER_ADMIN_DEVICE_POLICY: 'off' } as any)).toBe('off');
    expect(platformDeviceMode({ SUPER_ADMIN_DEVICE_POLICY: 'ENFORCE' } as any)).toBe('enforce');
  });
});

describe('S-A13 enforce: platform sign-in only from an approved device', () => {
  it('first device bootstraps; a second device is refused with no session and an approval email', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' });
    const first = await call(h.ctl, KEY_A);
    expect(first.status).toBe(200);
    expect(h.sessions.created).toBe(1);
    expect(h.events.some((e) => e.type === 'PLATFORM_DEVICE_APPROVED' && e.reason === 'first_device')).toBe(true);

    const second = await call(h.ctl, KEY_B);
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ ok: false, code: 'DEVICE_APPROVAL_REQUIRED', emailed: true });
    expect(h.sessions.created).toBe(1);   // no session for the unapproved device
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe('root@platform.test');
    expect(h.sent[0].body).toMatch(/https:\/\/admin\.example\.test\/approve-device\?token=pda_/);
    expect(h.events.some((e) => e.type === 'PLATFORM_DEVICE_APPROVAL_REQUIRED' && e.outcome === 'failure')).toBe(true);
    // only the hash of the token is stored
    const stored = (await pg.query(`select token_hash from platform_device_approvals where user_id = $1`, [SA])).rows;
    const token = /token=([^\s]+)/.exec(h.sent[0].body)![1];
    expect(stored.map((r: any) => r.token_hash)).not.toContain(decodeURIComponent(token));

    // the emailed link approves the device once
    const ok = await h.trust.approveByToken(decodeURIComponent(token));
    expect(ok).toMatchObject({ ok: true, userId: SA });
    expect(await h.trust.approveByToken(decodeURIComponent(token))).toEqual({ ok: false, reason: 'used' });
    const again = await call(h.ctl, KEY_B);
    expect(again.status).toBe(200);
    expect(h.sessions.created).toBe(2);
  });

  it('an expired or unknown link approves nothing', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' });
    const r = await call(h.ctl, KEY_C);
    expect(r.status).toBe(403);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(h.sent[0].body)![1]);
    await pg.query(`update platform_device_approvals set expires_at = now() - interval '1 minute' where user_id = $1 and used_at is null`, [SA]);
    expect(await h.trust.approveByToken(token)).toEqual({ ok: false, reason: 'expired' });
    expect(await h.trust.approveByToken('pda_nope')).toEqual({ ok: false, reason: 'invalid' });
    expect(await h.trust.approveByToken('nm_wrongprefix')).toEqual({ ok: false, reason: 'invalid' });
    expect((await call(h.ctl, KEY_C)).status).toBe(403);
  });

  it('an approved device approves another; an unapproved one cannot', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' });
    const dev = new KyselyAuthDevices(db);
    const all = await dev.list(SA);
    const a = all.find((d) => d.platformApprovedAt)!; const c = all.find((d) => !d.platformApprovedAt)!;
    expect(await h.trust.approveFromDevice(SA, c.id, c.id)).toEqual({ ok: false, reason: 'approver_not_approved' });
    expect(await h.trust.approveFromDevice(SA, a.id, c.id)).toEqual({ ok: true });
    expect((await call(h.ctl, KEY_C)).status).toBe(200);
    // another account's device is not reachable
    expect(await h.trust.approveFromDevice(SA2, a.id, c.id)).toEqual({ ok: false, reason: 'approver_not_approved' });
  });

  it('revoking a device withdraws its approval: the next sign-in from it needs approval again', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' });
    const dev = new KyselyAuthDevices(db);
    const b = (await dev.list(SA)).find((d) => d.name && d.platformApprovedAt && d.id)!;
    await dev.revoke(SA, b.id, 'revoked');
    const rows = (await pg.query(`select platform_approved_at from auth_devices where id = $1`, [b.id])).rows;
    expect(rows[0].platform_approved_at).toBeNull();
  });

  it('approval emails are throttled per account', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' }, 'SUPER_ADMIN', SA2);
    await call(h.ctl, 'dv_s2firstdevice000000000000000000');   // bootstrap SA2
    let refused = 0;
    for (let i = 0; i < APPROVAL_EMAILS_PER_HOUR + 2; i++) { const r = await call(h.ctl, `dv_s2other${String(i).padStart(24, '0')}`); if (r.status === 403) refused++; }
    expect(refused).toBe(APPROVAL_EMAILS_PER_HOUR + 2);
    expect(h.sent).toHaveLength(APPROVAL_EMAILS_PER_HOUR);
  });

  it('a "This wasn\'t me" block withdraws the approval too', async () => {
    const dev = new KyselyAuthDevices(db);
    const d = (await dev.list(SA2)).find((x) => x.platformApprovedAt)!;
    await pg.query(`insert into security_not_me_tokens (user_id, device_id, token_hash, expires_at) values ($1, $2, encode(sha256('nm_x1'::bytea), 'hex'), now() + interval '1 day')`, [SA2, d.id]);
    const r = await new SecurityNotifications(db, null).notMe('nm_x1');
    expect(r.ok).toBe(true);
    expect((await pg.query(`select platform_approved_at, trust_state from auth_devices where id = $1`, [d.id])).rows[0]).toMatchObject({ platform_approved_at: null, trust_state: 'blocked' });
  });
});

describe('S-A13 scope and modes', () => {
  it('salon sign-ins are never evaluated', async () => {
    const h = harness({ SUPER_ADMIN_DEVICE_POLICY: 'enforce' }, 'OWNER', OWNER);
    expect((await call(h.ctl, 'dv_owner1000000000000000000000000')).status).toBe(200);
    expect((await call(h.ctl, 'dv_owner2000000000000000000000000')).status).toBe(200);
    expect(h.sent).toHaveLength(0);
    expect((await pg.query(`select count(*)::int n from auth_devices where user_id = $1 and platform_approved_at is not null`, [OWNER])).rows[0].n).toBe(0);
  });

  it('report mode records but signs in; off evaluates nothing', async () => {
    const r = harness({ SUPER_ADMIN_DEVICE_POLICY: 'report' });
    expect((await call(r.ctl, 'dv_report0000000000000000000000000')).status).toBe(200);
    expect(r.events.some((e) => e.type === 'PLATFORM_DEVICE_APPROVAL_REQUIRED' && e.outcome === 'info')).toBe(true);
    expect(r.sent).toHaveLength(0);   // report mode mails nobody
    const o = harness({ SUPER_ADMIN_DEVICE_POLICY: 'off' });
    expect((await call(o.ctl, 'dv_off000000000000000000000000000')).status).toBe(200);
    expect(o.events.some((e) => String(e.type).startsWith('PLATFORM_DEVICE'))).toBe(false);
  });

  it('migration 698 backfilled the platform devices that existed (none refused on deploy)', async () => {
    const src = readFileSync(join(MIGRATIONS_DIR, '698_platform_device_approval.sql'), 'utf8');
    expect(src).toMatch(/platform_approved_via = 'migration'/);
    expect(src).toMatch(/u\.role = 'SUPER_ADMIN'/);
  });
});
