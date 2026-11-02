// synthetic-probes.ts — Constitution 11 §92–96, §240–241, §281, §328: synthetic checks of real customer paths.
//
// THE SAFETY RULES COME FIRST (§93–95):
//   • never a real tenant — the one tenant-scoped probe runs ONLY against the test salon a Super Admin DESIGNATES
//     (synthetic_monitoring_settings, migration 563 — step-up + reason + audit; BUILD_PLAN Phase 14 C). Default: none, and
//     the probe reports "not configured". It reads that salon's kiosk config — never writes, never another salon;
//   • no production charges (§94): the payment probe runs ONLY against a processor SANDBOX — CardPointe UAT
//     (`*-uat.cardconnect.com`, https) with SYNTHETIC_PAYMENT_SANDBOX_* credentials — and only calls inquireMerchant, a
//     read of the merchant's own setup: no authorization, no capture, no money, not even sandbox money. Any other host is
//     REFUSED (reported "not configured: refused_non_sandbox_host"), so a production URL pasted by mistake is never called;
//   • no SMS costs (§95): the SMS probe uses Twilio TEST credentials (TWILIO_TEST_ACCOUNT_SID / _AUTH_TOKEN — Twilio never
//     delivers or bills a message sent with them) and Twilio's magic number +15005550006 as both sender and destination, so
//     even live credentials pasted there by mistake could not text a person (the live account does not own that sender).
//     The live TWILIO_ACCOUNT_SID is refused outright;
//   • every probe is read-only except the database probe, which writes only to its own table (migration 446).
//   • unconfigured probes are SKIPPED with a reason ("not_configured", …) — never a pass, never a fake result.
//
// WHAT THEY PROVE, beyond the aggregator's internal signals (§328 — independent signals):
//   api_ready        GET {SYNTHETIC_BASE_URL}/health/ready. Pointed at the PUBLIC edge URL, it crosses DNS, TLS, the
//                    load balancer and a real instance — failures internal metrics cannot see (§96).
//   kiosk_config     GET {SYNTHETIC_BASE_URL}/go-check-in/{test salon's kiosk slug}/config — tenant resolution on a real
//                    public path.
//   db_write         upsert + read-back on synthetic_probe_heartbeats — the write path, not just `select 1`.
//   payment_sandbox  GET {sandbox}/cardconnect/rest/inquireMerchant/{merchid} — processor reachable, credentials accepted.
//   sms_test         POST Twilio Messages with test credentials — the provider accepts a send (201).
// The two provider probes run every SANDBOX_EVERY_TICKS ticks (15 min), not every minute.
//
// RESULTS go to the in-process history (the `synthetic` health component, with hysteresis — a probe must fail repeatedly
// before anything alerts, §281) AND to synthetic_probe_results (latest per probe), so the Super Admin screen and an
// aggregator in another process see the same thing.
import { registry, runTick } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DATABASE } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';

export type ProbeOutcome = 'pass' | 'fail' | 'skipped';
export interface ProbeResult { probe: string; outcome: ProbeOutcome; durationMs: number; detail: string; at: number }
export const PROBE_EVERY_MS = 60_000;
export const PROBE_TIMEOUT_MS = 10_000;
export const SANDBOX_EVERY_TICKS = 15;
/** CardPointe's UAT (sandbox) gateway hosts. Nothing else is ever called by the payment probe. */
export const CARDPOINTE_UAT_HOST = /^[a-z0-9-]+-uat\.cardconnect\.com$/i;
/** Twilio's magic test number: valid as a sender with test credentials, owned by no live account, reaches nobody. */
export const TWILIO_MAGIC_NUMBER = '+15005550006';

export const syntheticRuns = registry.counter('aipowersalon_synthetic_probe_runs_total', 'Synthetic probe runs', ['probe', 'outcome']);
export const syntheticDuration = registry.histogram('aipowersalon_synthetic_probe_duration_seconds', 'Synthetic probe duration', ['probe'], [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);

const latest = new Map<string, ProbeResult & { consecutiveFailures: number }>();
export function syntheticResults(): Array<ProbeResult & { consecutiveFailures: number }> { return [...latest.values()].sort((a, b) => a.probe.localeCompare(b.probe)); }
export function resetSyntheticResults(): void { latest.clear(); }

function record(r: ProbeResult): void {
  const prev = latest.get(r.probe);
  const consecutiveFailures = r.outcome === 'fail' ? (prev?.consecutiveFailures ?? 0) + 1 : 0;
  latest.set(r.probe, { ...r, consecutiveFailures });
  syntheticRuns.inc({ probe: r.probe, outcome: r.outcome });
  if (r.outcome !== 'skipped') syntheticDuration.observe(r.durationMs / 1000, { probe: r.probe });
}

/**
 * The latest persisted result per probe, written by whichever process runs the probes (the 'standard' job class) — for
 * an aggregator in another process (the 'critical' class), whose in-memory history is empty. Results older than
 * maxAgeMs are ignored: a stopped prober must read as "not measured", never as its last pass.
 */
export async function persistedSyntheticResults(db: any, now = Date.now(), maxAgeMs = 5 * PROBE_EVERY_MS): Promise<Array<ProbeResult & { consecutiveFailures: number }>> {
  if (!db) return [];
  try {
    const r = await sql<any>`select probe, outcome, detail, duration_ms, consecutive_failures, ran_at from synthetic_probe_results where ran_at >= ${new Date(now - maxAgeMs)} order by probe`.execute(db);
    return r.rows.map((x: any) => ({ probe: x.probe, outcome: x.outcome, detail: x.detail, durationMs: Number(x.duration_ms), at: new Date(x.ran_at).getTime(), consecutiveFailures: Number(x.consecutive_failures) }));
  } catch { return []; }
}

type FetchLike = (url: string, init?: any) => Promise<{ status: number; ok: boolean }>;
const skipped = (probe: string, detail: string, at = Date.now()): ProbeResult => ({ probe, outcome: 'skipped', durationMs: 0, detail, at });

/** An HTTP probe: expected status within the timeout. The detail names the status or the error CLASS, never a body. */
export async function httpProbe(name: string, url: string | null, fetchImpl: FetchLike, now: () => number = Date.now,
  req: { method?: string; headers?: Record<string, string>; body?: string; expect?: number } = {}): Promise<ProbeResult> {
  const at = now();
  if (!url) return { probe: name, outcome: 'skipped', durationMs: 0, detail: 'not_configured', at };
  const expect = req.expect ?? 200;
  const t0 = performance.now();
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { method: req.method ?? 'GET', signal: ctl.signal, headers: { 'user-agent': 'aipowersalon-synthetic/1', 'x-synthetic': '1', ...(req.headers ?? {}) }, ...(req.body !== undefined ? { body: req.body } : {}) });
      const ms = performance.now() - t0;
      return res.status === expect ? { probe: name, outcome: 'pass', durationMs: ms, detail: `http_${expect}`, at } : { probe: name, outcome: 'fail', durationMs: ms, detail: `http_${res.status}`, at };
    } finally { clearTimeout(timer); }
  } catch (e) {
    const n = String((e as { name?: string })?.name ?? '');
    return { probe: name, outcome: 'fail', durationMs: performance.now() - t0, detail: n === 'AbortError' ? 'timeout' : 'network_error', at };
  }
}

@Injectable()
export class SyntheticProbes implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private ticks = 0;
  readonly instanceId = `${hostname()}:${process.pid}`;
  /** Seams for tests. Fields, not constructor parameters: Nest DI would try to resolve those. */
  env: Record<string, string | undefined> = process.env;
  fetchImpl: FetchLike = (u, i) => (globalThis.fetch as any)(u, i);
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void runTick({ jobType: 'synthetic.probes', jobClass: 'standard', everyMs: PROBE_EVERY_MS }, () => this.tick()).catch(() => undefined); }, PROBE_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /**
   * SYNTHETIC_BASE_URL wins. On Railway it defaults to https://{RAILWAY_PUBLIC_DOMAIN} — the service's own public edge,
   * which Railway injects — so the readiness probe crosses DNS, TLS and Railway's proxy with nothing to configure.
   */
  private base(): string | null {
    const explicit = (this.env.SYNTHETIC_BASE_URL || '').trim();
    const domain = (this.env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const b = (explicit || (domain && /^[a-z0-9.-]+$/i.test(domain) ? `https://${domain}` : '')).replace(/\/$/, '');
    return /^https?:\/\//.test(b) ? b : null;
  }

  async dbWrite(now: () => number = Date.now): Promise<ProbeResult> {
    const at = now();
    if (!this.db) return { probe: 'db_write', outcome: 'skipped', durationMs: 0, detail: 'not_configured', at };
    const t0 = performance.now(); const token = randomUUID();
    try {
      await sql`insert into synthetic_probe_heartbeats (instance_id, token, updated_at) values (${this.instanceId}, ${token}, now())
                on conflict (instance_id) do update set token = excluded.token, updated_at = excluded.updated_at`.execute(this.db);
      const r = await sql<{ token: string }>`select token from synthetic_probe_heartbeats where instance_id = ${this.instanceId}`.execute(this.db);
      const ms = performance.now() - t0;
      // Read-your-write: the token just written must come back. Anything else is a failed write path.
      return r.rows[0]?.token === token ? { probe: 'db_write', outcome: 'pass', durationMs: ms, detail: 'roundtrip_ok', at } : { probe: 'db_write', outcome: 'fail', durationMs: ms, detail: 'readback_mismatch', at };
    } catch { return { probe: 'db_write', outcome: 'fail', durationMs: performance.now() - t0, detail: 'write_failed', at }; }
  }

  /** The designated test salon's active kiosk slug — or why there is none. Never any other salon (§93). */
  async testSalonSlug(): Promise<{ slug: string | null; detail: string }> {
    if (!this.db) return { slug: null, detail: 'not_configured' };
    try {
      const s = (await sql<{ test_tenant_id: string | null }>`select test_tenant_id from synthetic_monitoring_settings where id`.execute(this.db)).rows[0];
      if (!s?.test_tenant_id) return { slug: null, detail: 'not_configured' };
      const d = (await sql<{ checkin_slug: string }>`select checkin_slug from go_checkin_devices where tenant_id = ${s.test_tenant_id} and status = 'active' and checkin_slug is not null
                                                     order by created_at limit 1`.execute(this.db)).rows[0];
      return d ? { slug: d.checkin_slug, detail: 'ok' } : { slug: null, detail: 'test_salon_has_no_active_kiosk' };
    } catch { return { slug: null, detail: 'settings_unreadable' }; }
  }

  /** §94 CardPointe UAT inquireMerchant. Refuses any host that is not a CardPointe sandbox. */
  async paymentSandbox(): Promise<ProbeResult> {
    const base = (this.env.SYNTHETIC_PAYMENT_SANDBOX_URL || '').trim().replace(/\/+$/, '');
    const merchid = (this.env.SYNTHETIC_PAYMENT_SANDBOX_MERCHID || '').trim(), user = (this.env.SYNTHETIC_PAYMENT_SANDBOX_USER || '').trim(), pass = this.env.SYNTHETIC_PAYMENT_SANDBOX_PASSWORD || '';
    if (!base || !merchid || !user || !pass) return skipped('payment_sandbox', 'not_configured');
    let host = ''; let https = false;
    try { const u = new URL(base); host = u.hostname; https = u.protocol === 'https:'; } catch { /* below */ }
    if (!https || !CARDPOINTE_UAT_HOST.test(host)) return skipped('payment_sandbox', 'refused_non_sandbox_host');
    if (!/^[0-9A-Za-z]{1,32}$/.test(merchid)) return skipped('payment_sandbox', 'not_configured');
    return httpProbe('payment_sandbox', `https://${host}/cardconnect/rest/inquireMerchant/${merchid}`, this.fetchImpl, Date.now,
      { headers: { authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), accept: 'application/json' } });
  }

  /** §95 Twilio test credentials + the magic number. Refuses the live account SID. */
  async smsTest(): Promise<ProbeResult> {
    const sid = (this.env.TWILIO_TEST_ACCOUNT_SID || '').trim(), token = this.env.TWILIO_TEST_AUTH_TOKEN || '';
    if (!sid || !token) return skipped('sms_test', 'not_configured');
    if (!/^AC[0-9a-f]{32}$/i.test(sid)) return skipped('sms_test', 'not_configured');
    if (sid === (this.env.TWILIO_ACCOUNT_SID || '').trim()) return skipped('sms_test', 'refused_live_credentials');
    const body = new URLSearchParams({ From: TWILIO_MAGIC_NUMBER, To: TWILIO_MAGIC_NUMBER, Body: 'AIPowerSalon synthetic probe (Twilio test credentials)' }).toString();
    return httpProbe('sms_test', `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, this.fetchImpl, Date.now,
      { method: 'POST', expect: 201, body, headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' } });
  }

  /** The every-minute probes. None touches payments or messaging. */
  async runAll(): Promise<ProbeResult[]> {
    const base = this.base();
    const kiosk = base ? await this.testSalonSlug() : { slug: null, detail: 'not_configured' };
    const results = await Promise.all([
      httpProbe('api_ready', base ? `${base}/health/ready` : null, this.fetchImpl),
      kiosk.slug && base ? httpProbe('kiosk_config', `${base}/go-check-in/${encodeURIComponent(kiosk.slug)}/config`, this.fetchImpl) : Promise.resolve(skipped('kiosk_config', kiosk.detail)),
      this.dbWrite(),
    ]);
    for (const r of results) record(r);
    await this.persist(results);
    return results;
  }

  /** §94–95: the provider-sandbox probes, every SANDBOX_EVERY_TICKS minutes. */
  async runSandbox(): Promise<ProbeResult[]> {
    const results = await Promise.all([this.paymentSandbox(), this.smsTest()]);
    for (const r of results) record(r);
    await this.persist(results);
    return results;
  }

  async tick(): Promise<ProbeResult[]> {
    const out = await this.runAll();
    if (this.ticks++ % SANDBOX_EVERY_TICKS === 0) out.push(...await this.runSandbox());
    return out;
  }

  /** Latest result per probe, for every process and the Super Admin screen. Best-effort. */
  private async persist(results: ProbeResult[]): Promise<void> {
    if (!this.db) return;
    for (const r of results) {
      const streak = latest.get(r.probe)?.consecutiveFailures ?? 0;
      try {
        await sql`insert into synthetic_probe_results (probe, outcome, detail, duration_ms, consecutive_failures, instance_id, ran_at)
                  values (${r.probe}, ${r.outcome}, ${r.detail.slice(0, 120)}, ${Math.round(r.durationMs)}, ${streak}, ${this.instanceId}, ${new Date(r.at)})
                  on conflict (probe) do update set outcome = excluded.outcome, detail = excluded.detail, duration_ms = excluded.duration_ms,
                    consecutive_failures = excluded.consecutive_failures, instance_id = excluded.instance_id, ran_at = excluded.ran_at`.execute(this.db);
      } catch { /* the probe result is still in memory and in the metrics */ }
    }
  }
}
