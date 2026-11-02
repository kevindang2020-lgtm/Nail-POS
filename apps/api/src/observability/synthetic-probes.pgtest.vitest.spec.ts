// synthetic-probes.pgtest — Constitution 11 §92–96, §281: safe probes and how their results become health.
// BUILD_PLAN Phase 14 C: the kiosk probe reads ONLY the test salon a Super Admin designates (migration 563); the payment
// probe only a CardPointe UAT sandbox; the SMS probe only Twilio test credentials + the magic number.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SyntheticProbes, httpProbe, syntheticResults, resetSyntheticResults, persistedSyntheticResults, TWILIO_MAGIC_NUMBER } from './synthetic-probes';
import { evaluateSynthetic } from './health-core';
import { desiredAlerts } from './alert-rules';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { resetSyntheticResults(); await pg.exec(`DELETE FROM synthetic_monitoring_settings; DELETE FROM synthetic_probe_results;`); });
const TEST_SALON = '5e000000-0000-4000-8000-0000000000c1', REAL_SALON = '5e000000-0000-4000-8000-0000000000c2';
async function salons() {
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
      ('${TEST_SALON}', 'Synthetic LLC', 'Synthetic Test Salon', 'syn-test', 'SYNT1', 'active'), ('${REAL_SALON}', 'Real LLC', 'Real Salon', 'real-s', 'REAL1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO go_checkin_devices (tenant_id, device_name, checkin_slug, status) VALUES ('${REAL_SALON}', 'Front', 'real-front', 'active') ON CONFLICT DO NOTHING;`);
}
async function designate(tenantId: string | null) { await pg.query(`INSERT INTO synthetic_monitoring_settings (id, test_tenant_id, reason) VALUES (true, $1, 'test') ON CONFLICT (id) DO UPDATE SET test_tenant_id = excluded.test_tenant_id`, [tenantId]); }

function probes(env: Record<string, string>, fetchImpl: any, withDb = true) {
  const p = new SyntheticProbes(withDb ? db : undefined); p.env = env; p.fetchImpl = fetchImpl; return p;
}
const calls: string[] = [];
const ok = async (u: string) => { calls.push(u); return { status: 200, ok: true }; };

describe('§93–95 safety: nothing runs unless it was set up to', () => {
  it('with nothing configured, every HTTP probe is SKIPPED — not failed', async () => {
    calls.length = 0;
    const r = await probes({}, ok).runAll();
    expect(r.filter((x) => x.probe !== 'db_write').map((x) => x.outcome)).toEqual(['skipped', 'skipped']);
    expect(calls).toEqual([]);                                             // not a single request was made
  });
  it('§93 the tenant-scoped probe needs a DESIGNATED test salon — a base URL (or a slug in the environment) never makes it guess one', async () => {
    await salons(); calls.length = 0;
    const r = await probes({ SYNTHETIC_BASE_URL: 'https://api.example.com', SYNTHETIC_KIOSK_SLUG: 'real-front' }, ok).runAll();
    expect(calls).toEqual(['https://api.example.com/health/ready']);
    expect(r.find((x) => x.probe === 'kiosk_config')).toMatchObject({ outcome: 'skipped', detail: 'not_configured' });
  });
  it('with a designated test salon, it reads THAT salon\'s kiosk config — and only that', async () => {
    await salons();
    await pg.exec(`INSERT INTO go_checkin_devices (tenant_id, device_name, checkin_slug, status) VALUES ('${TEST_SALON}', 'Probe', 'syn-kiosk', 'active') ON CONFLICT DO NOTHING`);
    await designate(TEST_SALON); calls.length = 0;
    await probes({ SYNTHETIC_BASE_URL: 'https://api.example.com/' }, ok).runAll();
    expect(calls.sort()).toEqual(['https://api.example.com/go-check-in/syn-kiosk/config', 'https://api.example.com/health/ready']);
    await pg.exec(`DELETE FROM go_checkin_devices WHERE tenant_id = '${TEST_SALON}'`);
  });
  it('a designated salon with no active kiosk is reported as such — skipped, not failed, and no other salon\'s kiosk is used', async () => {
    await salons(); await designate(TEST_SALON); calls.length = 0;
    const r = await probes({ SYNTHETIC_BASE_URL: 'https://api.example.com' }, ok).runAll();
    expect(r.find((x) => x.probe === 'kiosk_config')).toMatchObject({ outcome: 'skipped', detail: 'test_salon_has_no_active_kiosk' });
    expect(calls.some((u) => u.includes('real-front'))).toBe(false);
  });
  it('a base URL that is not http(s) is treated as unconfigured, never fetched', async () => {
    calls.length = 0;
    await probes({ SYNTHETIC_BASE_URL: 'file:///etc/passwd' }, ok).runAll();
    expect(calls).toEqual([]);
  });
  it('§94–95 the every-minute probes touch no payment, verification or messaging path', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./synthetic-probes.ts', import.meta.url), 'utf8').split('async runAll()')[1].split('async runSandbox()')[0];
    expect(src).not.toMatch(/checkout|pay\/|verification|sms|twilio|refund|payment/i);
  });
});

describe('what a probe reports', () => {
  it('a non-200 is a failure naming the status', async () => {
    expect(await httpProbe('p', 'https://x', async () => ({ status: 503, ok: false }))).toMatchObject({ outcome: 'fail', detail: 'http_503' });
  });
  it('a network error is named by class, never by message (which can carry an internal hostname)', async () => {
    const r = await httpProbe('p', 'https://x', async () => { throw new Error('getaddrinfo ENOTFOUND internal-db-7.vpc'); });
    expect(r).toMatchObject({ outcome: 'fail', detail: 'network_error' });
    expect(JSON.stringify(r)).not.toMatch(/internal-db/);
  });
  it('the database probe proves the WRITE path: it writes a fresh token and must read that same token back', async () => {
    const r = await probes({}, ok).dbWrite();
    expect(r).toMatchObject({ outcome: 'pass', detail: 'roundtrip_ok' });
    expect((await pg.query(`SELECT count(*)::int c FROM synthetic_probe_heartbeats`)).rows[0].c).toBe(1);
    await probes({}, ok).dbWrite();                                          // same instance: an upsert, still one row
    expect((await pg.query(`SELECT count(*)::int c FROM synthetic_probe_heartbeats`)).rows[0].c).toBe(1);
  });
  it('a write that APPEARS to succeed but does not come back fails the probe — the reason read-back exists', async () => {
    // e.g. a read routed to a lagging replica, or a write silently dropped. A mutation that skipped the token
    // comparison survived every other test here: the pass case matches anyway and the broken case throws earlier.
    const exec = {
      transformQuery: (n: any) => n, adapter: {}, plugins: [],
      compileQuery: (n: any) => ({ sql: String(n?.kind ?? ''), parameters: [], query: n }),
      executeQuery: async (_c: any) => ({ rows: [{ token: 'a-stale-token-from-before' }] }),
    };
    const lagging = new SyntheticProbes({ getExecutor: () => exec } as never);
    expect((await lagging.dbWrite())).toMatchObject({ outcome: 'fail', detail: 'readback_mismatch' });
  });
  it('a broken write path fails the probe', async () => {
    const broken = new SyntheticProbes({ getExecutor: () => ({ transformQuery: (n: any) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => { throw new Error('read-only'); }, adapter: {}, plugins: [] }) } as never);
    expect((await broken.dbWrite()).detail).toBe('write_failed');
  });
});

describe('§281 results become health only when failures REPEAT', () => {
  it('one failure is not yet counted; two in a row are', async () => {
    const failing = async () => ({ status: 503, ok: false });
    const p = probes({ SYNTHETIC_BASE_URL: 'https://api.example.com' }, failing, false);
    await p.runAll();
    expect(evaluateSynthetic(syntheticResults()).status).not.toBe('OUTAGE');
    await p.runAll();
    expect(evaluateSynthetic(syntheticResults())).toMatchObject({ status: 'OUTAGE', reason: 'failing:api_ready(http_503)' });
  });
  it('a pass resets the streak', async () => {
    let status = 503;
    const p = probes({ SYNTHETIC_BASE_URL: 'https://api.example.com' }, async () => ({ status, ok: status === 200 }), false);
    await p.runAll(); await p.runAll(); status = 200; await p.runAll();
    expect(syntheticResults().find((r) => r.probe === 'api_ready')!.consecutiveFailures).toBe(0);
  });
  it('nothing configured is UNKNOWN — and UNKNOWN synthetic raises no alert', () => {
    const e = evaluateSynthetic([{ probe: 'api_ready', outcome: 'skipped', consecutiveFailures: 0, detail: 'not_configured' }]);
    expect(e.status).toBe('UNKNOWN');
    expect(desiredAlerts([{ key: 'synthetic', name: 'S', status: 'UNKNOWN', reason: e.reason, criticality: 'IMPORTANT', owner: 'o', runbook: 'r' }])).toEqual([]);
  });
  it('§104 a failing probe is suppressed as a symptom while the API is down', () => {
    const out = desiredAlerts([
      { key: 'api', name: 'API', status: 'OUTAGE', reason: 'x', criticality: 'CRITICAL', owner: 'o', runbook: 'r' },
      { key: 'synthetic', name: 'Synthetic', status: 'OUTAGE', reason: 'failing:api_ready', criticality: 'IMPORTANT', owner: 'o', runbook: 'r' },
    ]);
    expect(out.map((a) => a.component)).toEqual(['api']);
  });
});

describe('on Railway the readiness probe turns on by itself', () => {
  it('with only RAILWAY_PUBLIC_DOMAIN set, api_ready probes https://{domain}/health/ready', async () => {
    calls.length = 0;
    await probes({ RAILWAY_PUBLIC_DOMAIN: 'aipowersalon-api.up.railway.app' }, ok).runAll();
    expect(calls).toEqual(['https://aipowersalon-api.up.railway.app/health/ready']);
  });
  it('the kiosk probe still stays OFF — Railway\'s domain is not a synthetic tenant, and it never guesses one (§93)', async () => {
    calls.length = 0;
    await probes({ RAILWAY_PUBLIC_DOMAIN: 'aipowersalon-api.up.railway.app' }, ok).runAll();
    expect(calls.some((u) => u.includes('go-check-in'))).toBe(false);
  });
  it('an explicit SYNTHETIC_BASE_URL wins over Railway\'s domain', async () => {
    calls.length = 0;
    await probes({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app', SYNTHETIC_BASE_URL: 'https://api.aipowersalon.com' }, ok).runAll();
    expect(calls).toEqual(['https://api.aipowersalon.com/health/ready']);
  });
  it('a value that is not a hostname is ignored, not fetched', async () => {
    // (An earlier version of this test asserted "every call starts with X, or there were no calls" — true whatever
    // the code did. Replaced with one that can fail.)
    calls.length = 0;
    await probes({ RAILWAY_PUBLIC_DOMAIN: 'not a domain!' }, ok).runAll();
    expect(calls).toEqual([]);
  });
});

describe('§94 the payment probe: a processor SANDBOX or nothing', () => {
  const SANDBOX = { SYNTHETIC_PAYMENT_SANDBOX_URL: 'https://fts-uat.cardconnect.com', SYNTHETIC_PAYMENT_SANDBOX_MERCHID: '496160873888', SYNTHETIC_PAYMENT_SANDBOX_USER: 'testing', SYNTHETIC_PAYMENT_SANDBOX_PASSWORD: 'testing123' };
  it('unconfigured → skipped "not_configured", no request', async () => {
    calls.length = 0;
    expect(await probes({}, ok, false).paymentSandbox()).toMatchObject({ outcome: 'skipped', detail: 'not_configured' });
    expect(calls).toEqual([]);
  });
  it('a production gateway host is REFUSED and never called', async () => {
    for (const url of ['https://fts.cardconnect.com', 'https://boltgw.cardconnect.com', 'http://fts-uat.cardconnect.com', 'https://fts-uat.cardconnect.com.evil.com']) {
      calls.length = 0;
      expect(await probes({ ...SANDBOX, SYNTHETIC_PAYMENT_SANDBOX_URL: url }, ok, false).paymentSandbox(), url).toMatchObject({ outcome: 'skipped', detail: 'refused_non_sandbox_host' });
      expect(calls, url).toEqual([]);
    }
  });
  it('the UAT host: a read-only inquireMerchant (no authorization, no capture), basic auth, pass on 200', async () => {
    const seen: any[] = [];
    const r = await probes(SANDBOX, async (u: string, i: any) => { seen.push({ u, i }); return { status: 200, ok: true }; }, false).paymentSandbox();
    expect(r).toMatchObject({ probe: 'payment_sandbox', outcome: 'pass' });
    expect(seen).toHaveLength(1);
    expect(seen[0].u).toBe('https://fts-uat.cardconnect.com/cardconnect/rest/inquireMerchant/496160873888');
    expect(seen[0].i.method).toBe('GET');
    expect(seen[0].i.body).toBeUndefined();
    expect(seen[0].i.headers.authorization).toBe('Basic ' + Buffer.from('testing:testing123').toString('base64'));
  });
  it('rejected credentials fail the probe with the status, never the body', async () => {
    expect(await probes(SANDBOX, async () => ({ status: 401, ok: false }), false).paymentSandbox()).toMatchObject({ outcome: 'fail', detail: 'http_401' });
  });
});

describe('§95 the SMS probe: Twilio TEST credentials and the magic number only', () => {
  const SID = 'AC' + 'a'.repeat(32), LIVE = 'AC' + 'b'.repeat(32);
  it('unconfigured → skipped, no request', async () => {
    calls.length = 0;
    expect(await probes({}, ok, false).smsTest()).toMatchObject({ outcome: 'skipped', detail: 'not_configured' });
    expect(calls).toEqual([]);
  });
  it('the LIVE account SID in the test slot is refused and never called', async () => {
    calls.length = 0;
    expect(await probes({ TWILIO_TEST_ACCOUNT_SID: LIVE, TWILIO_TEST_AUTH_TOKEN: 't', TWILIO_ACCOUNT_SID: LIVE }, ok, false).smsTest()).toMatchObject({ outcome: 'skipped', detail: 'refused_live_credentials' });
    expect(calls).toEqual([]);
  });
  it('sends from AND to the magic number (reaches nobody), passes only on 201', async () => {
    const seen: any[] = [];
    const p = probes({ TWILIO_TEST_ACCOUNT_SID: SID, TWILIO_TEST_AUTH_TOKEN: 'tok', TWILIO_ACCOUNT_SID: LIVE }, async (u: string, i: any) => { seen.push({ u, i }); return { status: 201, ok: true }; }, false);
    expect(await p.smsTest()).toMatchObject({ outcome: 'pass', detail: 'http_201' });
    expect(seen[0].u).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    const form = new URLSearchParams(seen[0].i.body);
    expect(form.get('From')).toBe(TWILIO_MAGIC_NUMBER);
    expect(form.get('To')).toBe(TWILIO_MAGIC_NUMBER);
    expect(seen[0].i.method).toBe('POST');
    expect(await probes({ TWILIO_TEST_ACCOUNT_SID: SID, TWILIO_TEST_AUTH_TOKEN: 'tok' }, async () => ({ status: 200, ok: true }), false).smsTest()).toMatchObject({ outcome: 'fail', detail: 'http_200' });
  });
});

describe('results reach every process', () => {
  it('each run is persisted (latest per probe) with its streak; stale results are not read back', async () => {
    const p = probes({ SYNTHETIC_BASE_URL: 'https://api.example.com' }, async () => ({ status: 503, ok: false }));
    await p.runAll(); await p.runAll();
    const rows = (await pg.query(`SELECT probe, outcome, detail, consecutive_failures FROM synthetic_probe_results ORDER BY probe`)).rows;
    expect(rows.find((r: any) => r.probe === 'api_ready')).toMatchObject({ outcome: 'fail', detail: 'http_503', consecutive_failures: 2 });
    expect(rows.find((r: any) => r.probe === 'kiosk_config')).toMatchObject({ outcome: 'skipped', detail: 'not_configured' });
    const fresh = await persistedSyntheticResults(db, Date.now());
    expect(fresh.find((r) => r.probe === 'api_ready')).toMatchObject({ consecutiveFailures: 2 });
    expect(await persistedSyntheticResults(db, Date.now() + 3_600_000)).toEqual([]);     // an hour later: the prober stopped
  });
  it('the provider probes run on the first tick and then every 15th, not every minute', async () => {
    const seen: string[] = [];
    const p = probes({ TWILIO_TEST_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_TEST_AUTH_TOKEN: 't' }, async (u: string) => { seen.push(u); return { status: 201, ok: true }; }, false);
    for (let i = 0; i < 16; i++) await p.tick();
    expect(seen.filter((u) => u.includes('twilio'))).toHaveLength(2);
  });
});
