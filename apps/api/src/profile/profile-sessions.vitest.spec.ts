import { describe, it, expect } from 'vitest';
import { ProfileService } from './profile.service';

// Minimal Kysely-shaped fake: selectFrom(...) for reads, updateTable(...) for revokes.
function fakeDb(rows: any[] = [], numUpdatedRows = 0) {
  const selQb: any = { select: () => selQb, where: () => selQb, orderBy: () => selQb, limit: () => selQb, execute: async () => rows, executeTakeFirst: async () => rows[0] };
  const updQb: any = { set: () => updQb, where: () => updQb, executeTakeFirst: async () => ({ numUpdatedRows: BigInt(numUpdatedRows) }), execute: async () => ({ numUpdatedRows: BigInt(numUpdatedRows) }) };
  return { selectFrom: () => selQb, updateTable: () => updQb } as any;
}

const ctx = { tenantId: 't1', userId: 'u1', role: 'OWNER' };
const now = Date.now();

describe('ProfileService.listSessions', () => {
  it('maps device from user-agent and derives active/expired/revoked + ip + time', async () => {
    const rows = [
      { id: 's1', device_id: null, ip_address: '10.0.0.5', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', status: 'active', created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3_600_000).toISOString(), revoked_at: null },
      { id: 's2', device_id: null, ip_address: '10.0.0.6', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', status: 'active', created_at: new Date(now - 5000).toISOString(), expires_at: new Date(now - 1000).toISOString(), revoked_at: null },
      { id: 's3', device_id: null, ip_address: null, user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', status: 'active', created_at: new Date(now - 9000).toISOString(), expires_at: new Date(now + 3_600_000).toISOString(), revoked_at: new Date(now - 100).toISOString() },
    ];
    const { sessions } = await new ProfileService(fakeDb(rows)).listSessions(ctx);
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({ id: 's1', device: 'Chrome on macOS', ip: '10.0.0.5', status: 'active', active: true });
    expect(sessions[1]).toMatchObject({ device: 'Safari on iOS', status: 'expired', active: false });   // expired by expires_at
    expect(sessions[2]).toMatchObject({ device: 'Firefox on Windows', ip: null, status: 'revoked', active: false }); // revoked_at set
  });

  it('fails soft to an empty list with no db or no active session', async () => {
    expect(await new ProfileService(null as any).listSessions(ctx)).toEqual({ sessions: [] });
    expect(await new ProfileService(fakeDb([])).listSessions({})).toEqual({ sessions: [] });
  });
});

describe('ProfileService.get', () => {
  it('returns real member-since, password-changed, email & name from the users row', async () => {
    // avatar sql read fails soft on the fake db (no executor) → avatarUrl null; users row supplies the rest.
    const userRow = { email: 'sophia@luxenails.com', full_name: 'Sophia Nguyen', created_at: '2024-01-12T00:00:00Z', password_changed_at: '2026-04-18T00:00:00Z', last_login_at: '2026-05-06T14:21:00Z' };
    const me = await new ProfileService(fakeDb([userRow])).get(ctx);
    expect(me).toMatchObject({
      userId: 'u1', role: 'OWNER', avatarUrl: null,
      email: 'sophia@luxenails.com', fullName: 'Sophia Nguyen',
      memberSince: '2024-01-12T00:00:00.000Z', passwordChangedAt: '2026-04-18T00:00:00.000Z', lastLoginAt: '2026-05-06T14:21:00.000Z',
    });
  });

  it('fails soft to base profile with no db', async () => {
    expect(await new ProfileService(null as any).get(ctx)).toMatchObject({ userId: 'u1', avatarUrl: null, email: null, memberSince: null, passwordChangedAt: null });
  });
});

describe('ProfileService.revokeSession / revokeAllSessions', () => {
  it('revokeSession reports revoked=true when a row was updated', async () => {
    expect(await new ProfileService(fakeDb([], 1)).revokeSession(ctx, 's1')).toEqual({ ok: true, revoked: true });
  });
  it('revokeSession reports revoked=false when nothing matched (already revoked / not owned)', async () => {
    expect(await new ProfileService(fakeDb([], 0)).revokeSession(ctx, 's1')).toEqual({ ok: true, revoked: false });
  });
  it('revokeSession is a no-op without a session id or db', async () => {
    expect(await new ProfileService(fakeDb([], 1)).revokeSession(ctx, '')).toEqual({ ok: false, revoked: false });
    expect(await new ProfileService(null as any).revokeSession(ctx, 's1')).toEqual({ ok: false, revoked: false });
  });
  it('revokeAllSessions returns the number revoked', async () => {
    expect(await new ProfileService(fakeDb([], 3)).revokeAllSessions(ctx)).toEqual({ ok: true, count: 3 });
    expect(await new ProfileService(null as any).revokeAllSessions(ctx)).toEqual({ ok: false, count: 0 });
  });
});
