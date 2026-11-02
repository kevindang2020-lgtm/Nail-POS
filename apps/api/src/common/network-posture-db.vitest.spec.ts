// Security Deep Scan D9: superuser / BYPASSRLS database logins are reported; every *DATABASE_URL gets the TLS check.
import { describe, it, expect } from 'vitest';
import { databaseRolePosture, networkPosture } from './network-posture';

describe('database posture', () => {
  it('reports a superuser and a BYPASSRLS login; a normal login is clean', async () => {
    expect((await databaseRolePosture(async () => [{ u: 'postgres', su: true, bypass: true }]))[0].problem).toMatch(/SUPERUSER/);
    expect((await databaseRolePosture(async () => [{ u: 'x', su: false, bypass: true }]))[0].problem).toMatch(/BYPASSRLS/);
    expect(await databaseRolePosture(async () => [{ u: 'aps_api', su: false, bypass: false }])).toEqual([]);
  });
  it('the TLS check covers the worker and migrator URLs too', () => {
    const f = networkPosture({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u@db.railway.internal/x', PG_WORKER_DATABASE_URL: 'postgres://u@db.example.com/x', MIGRATE_DATABASE_URL: 'postgres://u@db.example.com/x?sslmode=require' } as any);
    expect(f.map((x) => x.variable).filter((v) => /DATABASE/.test(v))).toEqual(['PG_WORKER_DATABASE_URL']);
  });
});
