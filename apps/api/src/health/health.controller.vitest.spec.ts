// health.controller.vitest.spec — Constitution 11 §84–87, §279: liveness, readiness, and what readiness must ignore.
import { describe, it, expect } from 'vitest';
import { HealthController, READY_PROBE_TIMEOUT_MS } from './health.controller';

const res = () => { const r: any = { code: 200, status(c: number) { r.code = c; return r; } }; return r; };

// kysely's sql`…`.execute(db) calls db.getExecutor(); a minimal Kysely-shaped double:
function fakeDb(behaviour: 'ok' | 'fail' | 'hang') {
  const executor = {
    transformQuery: (n: any) => n, compileQuery: (n: any) => ({ sql: 'select 1', parameters: [], query: n }),
    executeQuery: async () => {
      if (behaviour === 'fail') throw new Error('ECONNREFUSED');
      if (behaviour === 'hang') await new Promise(() => undefined);
      return { rows: [{}] };
    },
    adapter: {}, plugins: [],
  };
  return { getExecutor: () => executor } as any;
}

describe('§85 liveness touches nothing external', () => {
  it('answers alive even with no database at all', () => expect(new HealthController(undefined).live()).toEqual({ status: 'alive' }));
  it('the original /health is unchanged — existing load-balancer checks keep working', async () => {
    expect((await new HealthController(undefined).health()).status).toBe('ok');
  });
});

describe('§86 readiness checks the critical dependency', () => {
  it('ready when the database answers', async () => {
    const r = res();
    expect(await new HealthController(fakeDb('ok')).ready(r)).toEqual({ status: 'ready' });
    expect(r.code).toBe(200);
  });
  it('§279 DB down → 503 not_ready naming the database — and nothing about the connection', async () => {
    const r = res();
    const out = await new HealthController(fakeDb('fail')).ready(r);
    expect(r.code).toBe(503);
    expect(out).toEqual({ status: 'not_ready', failed: ['database'] });
    expect(JSON.stringify(out)).not.toMatch(/ECONNREFUSED|postgres|password/i);
  });
  it('a HANGING database fails readiness within the timeout — a probe that hangs keeps a dead instance in rotation', async () => {
    const r = res(); const t0 = Date.now();
    await new HealthController(fakeDb('hang')).ready(r);
    expect(r.code).toBe(503);
    expect(Date.now() - t0).toBeLessThan(READY_PROBE_TIMEOUT_MS + 1000);
  });
  it('no database configured is not ready', async () => {
    const r = res();
    expect((await new HealthController(undefined).ready(r)).status).toBe('not_ready');
  });
});

describe('§87 readiness must NOT depend on optional providers', () => {
  it('the readiness check references no provider — AI, Twilio, email or push being down cannot take an instance out of rotation', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./health.controller.ts', import.meta.url), 'utf8').split('async ready(')[1].split('\n  }\n')[0];
    expect(src).not.toMatch(/providerHealth|allProviderHealth|breakers|twilio|sendgrid|fcm|apns|openai|anthropic/i);
  });
});
