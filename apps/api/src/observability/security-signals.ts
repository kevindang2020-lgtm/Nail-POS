// security-signals.ts — BUILD_PLAN Phase 14 C (Constitution 11 D8, §118–121, §262): observability emits into the
// security domain.
//
// The security domain (security_incidents, migration 265) is where a human investigates. Until now the only observability
// signal that reached it was repeated cross-tenant attempts (cross-tenant-signal.ts). This adds the rest of D8:
//   auth_failures               401 responses from one client address           ≥ 100 in 5 min  (credential stuffing)
//   forbidden                   403 responses for one salon / one address       ≥ 100 in 5 min  (authorization probing)
//   rate_limit_storm            429 responses to one client address             ≥ 300 in 5 min  (abuse / runaway client)
//   webhook_signature_failures  rejected provider webhooks, per provider         ≥ 20 in 10 min  (forged deliveries)
//   break_glass                 MAINTENANCE_BREAK_GLASS changed (any direction)  every change
// Security Deep Scan §153 (Oct 26 2026) — the events the audit found recorded but never RAISED:
//   platform_admin_change       a platform account invited / promoted / its role changed (2xx on those routes)  every event
//   merchant_config_change      merchant account / payment gateway / salon payment settings changed (2xx)       every event
//   payment_retry_unknown       ≥ 3 card payments left unresolved ('processing') on ONE ticket within 30 min       per ticket (tick)
//   upload_malware              an upload refused by the malware scan (MALWARE)                                  every event
//   upload_scan_unavailable     uploads refused because no scanner answered (SCAN_UNAVAILABLE)                   ≥ 5 in 15 min
//
// DE-DUPLICATION — one attack must not open hundreds of incidents:
//   • a counter key escalates ONCE per window (the count crossing the threshold), never on every request after it;
//   • the incident reference is per KIND per UTC HOUR (SEC-OBS-<KIND>-<yyyymmddhh>), not per address — a distributed attack
//     from 500 addresses is one incident whose description lists the sources (bounded at 4000 characters); `on conflict
//     (incident_ref)` makes that true across API instances too;
//   • each incident gets at most one platform alert (dedupe_key = the reference), which pages through AlertNotifier and
//     the on-call chain when it is high (webhook forgery, break-glass) and stays on the screen when medium;
//   • break-glass: each PROCESS reports only a change in what IT sees, and the database row only flips once — so a rolling
//     deploy where an old instance still runs the previous mode cannot flip-flop it into a stream of incidents.
//
// NEVER IN THE REQUEST PATH. Counting is synchronous and in memory (bounded maps); writes are fire-and-forget; every
// failure is logged and swallowed. Counts are per process — with N instances an attack is seen by each; the threshold
// is per instance on purpose (no shared counter on the hot path).
import type { CATEGORIES } from '@aipowersalon/super-admin';
import { log as rootLog, registry, runJob, webhookEvents } from '@aipowersalon/observability';
import { DATABASE } from '@aipowersalon/database';
import { Inject, Injectable, NestMiddleware, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { breakGlassMode } from '../common/maintenance-break-glass';
import { onUploadRefused } from '@aipowersalon/media';

const log = rootLog.withContext({ component: 'security-signal' });
export const SIGNAL_TICK_MS = 60_000;
export const MAX_KEYS = 10_000;

/** security_incidents.category — the platform's listed incident vocabulary (incident-core CATEGORIES; incident-vocabulary spec). */
type IncidentCategory = (typeof CATEGORIES)[number];
export type SignalKind = 'auth_failures' | 'forbidden' | 'rate_limit_storm' | 'webhook_signature_failures' | 'break_glass'
  | 'platform_admin_change' | 'merchant_config_change' | 'payment_retry_unknown' | 'upload_malware' | 'upload_scan_unavailable';
/** Kinds raised on EVERY occurrence (one incident per kind per hour, extended; one alert per incident). */
export type EventSignalKind = 'platform_admin_change' | 'merchant_config_change' | 'payment_retry_unknown' | 'upload_malware';
type ThresholdKind = 'auth_failures' | 'forbidden' | 'rate_limit_storm' | 'webhook_signature_failures' | 'upload_scan_unavailable';
interface Rule { threshold: number; windowMs: number; severity: 'high' | 'medium'; category: IncidentCategory; title: string; what: string }
export const RULES: Readonly<Record<ThresholdKind, Rule>> = {
  auth_failures: { threshold: 100, windowMs: 5 * 60_000, severity: 'medium', category: 'authentication', title: 'Spike of failed sign-ins / unauthenticated calls (401)', what: '401 responses' },
  forbidden: { threshold: 100, windowMs: 5 * 60_000, severity: 'medium', category: 'privilege', title: 'Spike of refused requests (403)', what: '403 responses' },
  rate_limit_storm: { threshold: 300, windowMs: 5 * 60_000, severity: 'medium', category: 'network', title: 'Rate-limit storm (429)', what: '429 responses' },
  webhook_signature_failures: { threshold: 20, windowMs: 10 * 60_000, severity: 'high', category: 'fraud', title: 'Provider webhooks failing verification', what: 'rejected webhook deliveries' },
  upload_scan_unavailable: { threshold: 5, windowMs: 15 * 60_000, severity: 'medium', category: 'data', title: 'Uploads refused: malware scanner unavailable', what: 'uploads refused with SCAN_UNAVAILABLE' },
};
/** §153: per-occurrence signals. */
export const EVENT_RULES: Readonly<Record<EventSignalKind, Omit<Rule, 'threshold' | 'windowMs' | 'what'>>> = {
  platform_admin_change: { severity: 'high', category: 'privilege', title: 'Platform account invited / promoted / role changed' },
  merchant_config_change: { severity: 'high', category: 'fraud', title: 'Merchant / payment gateway configuration changed' },
  payment_retry_unknown: { severity: 'high', category: 'fraud', title: 'Repeated card payments in an unknown state on one ticket' },
  upload_malware: { severity: 'high', category: 'data', title: 'Upload refused by the malware scan' },
};
/** Successful MUTATING requests on these paths are raised (concrete paths: ids are any non-slash segment). */
export const ROUTE_SIGNALS: ReadonlyArray<{ kind: 'platform_admin_change' | 'merchant_config_change'; re: RegExp }> = [
  { kind: 'platform_admin_change', re: /^\/super-admin\/platform\/(invitations|users\/invite|users\/[^/]+\/role|access-requests\/[^/]+\/approve)$/ },
  { kind: 'platform_admin_change', re: /^\/super-admin\/platform-staff\/[^/]+\/role$/ },
  { kind: 'merchant_config_change', re: /^\/super-admin\/merchant-accounts\/[^/]+\/(rates|activation|deactivation|suspension|funding-update|mid-assignment|terminals)$/ },
  { kind: 'merchant_config_change', re: /^\/super-admin\/tenants\/[^/]+\/payment-gateway(\/branches\/[^/]+(\/status)?|\/(pause|resume|disable)|\/webhooks\/rotate-secret)?$/ },
  { kind: 'merchant_config_change', re: /^\/pos\/settings\/payments-checkout(\/terminals\/[^/]+(\/[^/]+)?)?$/ },
];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Path → the route signal it raises on success (the /api/v1 prefix and query are ignored). */
export function routeSignalFor(method: string, rawPath: string): 'platform_admin_change' | 'merchant_config_change' | null {
  if (!MUTATING.has(String(method || '').toUpperCase())) return null;
  const path = String(rawPath || '').split('?')[0].replace(/^\/api\/v\d+(?=\/)/, '').replace(/\/+$/, '');
  return ROUTE_SIGNALS.find((r) => r.re.test(path))?.kind ?? null;
}
export const PAYMENT_RETRY_THRESHOLD = 3;
export const PAYMENT_RETRY_WINDOW_MS = 30 * 60_000;

export const securitySignals = registry.counter('aipowersalon_security_signal_escalations_total', 'Observability security signals that crossed a threshold', ['kind']);
export const securityIncidentsOpened = registry.counter('aipowersalon_security_signal_incidents_total', 'Security incidents opened (or extended) from observability signals', ['kind', 'result']);

const KIND_CODE: Record<SignalKind, string> = { auth_failures: '401', forbidden: '403', rate_limit_storm: '429', webhook_signature_failures: 'WHK', break_glass: 'BG',
  platform_admin_change: 'ADM', merchant_config_change: 'MCH', payment_retry_unknown: 'PAY', upload_malware: 'MAL', upload_scan_unavailable: 'SCN' };
/** Per KIND per UTC hour: every source, every instance, one incident. */
export function incidentRef(kind: SignalKind, at: Date): string {
  return `SEC-OBS-${KIND_CODE[kind]}-${at.toISOString().slice(0, 13).replace(/[-T]/g, '')}`;
}

/** Fixed-window counters, bounded. Returns true exactly once per key per window: when the count reaches the threshold. */
export class WindowCounter {
  private readonly m = new Map<string, { start: number; count: number }>();
  constructor(readonly maxKeys = MAX_KEYS) {}
  add(key: string, n: number, threshold: number, windowMs: number, now: number): { crossed: boolean; count: number } {
    let w = this.m.get(key);
    if (!w || now - w.start >= windowMs) {
      if (!w && this.m.size >= this.maxKeys) this.m.clear();      // bounded under a distributed flood
      w = { start: now, count: 0 }; this.m.set(key, w);
    }
    const before = w.count; w.count += n;
    return { crossed: before < threshold && w.count >= threshold, count: w.count };
  }
  size(): number { return this.m.size; }
}

@Injectable()
export class SecuritySignals implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly counter = new WindowCounter();
  private lastWebhookRejected = new Map<string, number>();
  private lastBreakGlass: string | undefined;
  private readonly paymentRetryRaised = new Map<string, number>();
  now: () => number = Date.now;
  env: Record<string, string | undefined> = process.env;
  /** Writes in flight — tests await them; production never does. */
  readonly pending = new Set<Promise<unknown>>();
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  private offUpload: (() => void) | null = null;
  onModuleInit(): void {
    // §153: every MALWARE / SCAN_UNAVAILABLE refusal from the ONE upload policy (@aipowersalon/media acceptUpload)
    this.offUpload = onUploadRefused((r) => this.observeUploadRefusal({ reason: r.reason, kind: `${r.policy}/${r.kind}`, tenantId: r.tenantId }));
    if (this.env.NODE_ENV === 'test') return;
    // Process-local on purpose (like the metrics flush): each process watches its OWN webhook counters and its OWN view of
    // the break-glass switch, so this is runJob in every process — not a single-owner runTick (another process's tick
    // could not see this one's counters).
    this.timer = setInterval(() => { void runJob({ jobType: 'security.signals', jobClass: 'critical' }, () => this.tick()).catch(() => undefined); }, SIGNAL_TICK_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.offUpload?.(); this.offUpload = null; }

  /** Called on every finished response (middleware below). Synchronous, never throws. */
  observeResponse(r: { status: number; ip?: string | null; tenantId?: string | null; path?: string; method?: string; userId?: string | null }): void {
    try {
      const path = String(r.path ?? '');
      if (/^\/(health|readyz|livez|metrics)(\/|$|\?)/.test(path)) return;
      if (r.status >= 200 && r.status < 300 && r.method) {
        const kind = routeSignalFor(r.method, path);
        if (kind) this.raise(kind, `${String(r.method).toUpperCase()} ${path.split('?')[0].slice(0, 200)} by ${r.userId ? `user ${String(r.userId).slice(0, 64)}` : 'unknown user'}${r.tenantId ? ` (salon ${String(r.tenantId).slice(0, 64)})` : ''} from ${String(r.ip ?? 'unknown').slice(0, 64)}`);
      }
      const ip = String(r.ip ?? '').slice(0, 64) || 'unknown';
      if (r.status === 401) this.bump('auth_failures', `ip ${ip}`);
      else if (r.status === 403) { this.bump('forbidden', `ip ${ip}`); if (r.tenantId) this.bump('forbidden', `salon ${String(r.tenantId).slice(0, 64)}`); }
      else if (r.status === 429) this.bump('rate_limit_storm', `ip ${ip}`);
    } catch { /* §286 */ }
  }

  /** §153: raise ONE occurrence of a per-event signal (fire-and-forget; never throws). Returns the write for tests. */
  raise(kind: EventSignalKind, line: string): Promise<unknown> {
    const rule = EVENT_RULES[kind]; const at = new Date(this.now());
    securitySignals.inc({ kind });
    log.warn('security.signal_event', { kind });
    const p = this.open(kind, rule.severity, rule.category, rule.title, `${at.toISOString()}: ${line}`, at);   // open() never rejects
    this.track(p); return p;
  }

  /** §153: an upload refused by the malware scan (every one) or because no scanner answered (≥ 5 in 15 min). */
  observeUploadRefusal(r: { reason: string; kind?: string | null; tenantId?: string | null; userId?: string | null }): void {
    // (the media package calls listeners inside its own try — a throw here can never break the refusal)
    const who = `${r.kind ? `${String(r.kind).slice(0, 40)} upload` : 'upload'}${r.tenantId ? ` (salon ${String(r.tenantId).slice(0, 64)})` : ''}${r.userId ? ` by user ${String(r.userId).slice(0, 64)}` : ''}`;
    if (r.reason === 'MALWARE') void this.raise('upload_malware', `${who} refused: MALWARE`);
    else if (r.reason === 'SCAN_UNAVAILABLE') this.bump('upload_scan_unavailable', 'platform');
  }

  /** §153: card payments left unresolved ('processing' — the processor outcome unknown) on one ticket, 3+ within 30 min.
   *  Each ticket is raised once per window (the counter key is per ticket + window start). */
  async checkPaymentRetries(): Promise<number> {
    if (!this.db) return 0;
    try {
      const since = new Date(this.now() - PAYMENT_RETRY_WINDOW_MS);
      const rows = (await sql<{ tenant_id: string; ticket_id: string; n: number }>`select tenant_id::text tenant_id, ticket_id::text ticket_id, count(*)::int n from payments
          where status = 'processing' and created_at >= ${since} and ticket_id is not null
          group by tenant_id, ticket_id having count(*) >= ${PAYMENT_RETRY_THRESHOLD} limit 50`.execute(this.db)).rows;
      let raised = 0;
      for (const r of rows) {
        const key = `${r.tenant_id}|${r.ticket_id}`;
        const last = this.paymentRetryRaised.get(key);
        if (last !== undefined && this.now() - last < PAYMENT_RETRY_WINDOW_MS) continue;
        if (this.paymentRetryRaised.size >= MAX_KEYS) this.paymentRetryRaised.clear();
        this.paymentRetryRaised.set(key, this.now());
        await this.raise('payment_retry_unknown', `ticket ${r.ticket_id} (salon ${r.tenant_id}): ${r.n} card payments unresolved within ${PAYMENT_RETRY_WINDOW_MS / 60_000} minutes — risk of a double charge; reconcile with the processor before another attempt`);
        raised++;
      }
      return raised;
    } catch (e) { log.error('security.payment_retry_signal_failed', { error: (e as Error).message }); return 0; }
  }

  bump(kind: ThresholdKind, source: string, n = 1): boolean {
    const rule = RULES[kind];
    const r = this.counter.add(`${kind}|${source}`, n, rule.threshold, rule.windowMs, this.now());
    if (!r.crossed) return false;
    securitySignals.inc({ kind });
    log.warn('security.signal_threshold', { kind, source, count: r.count, windowMinutes: rule.windowMs / 60_000 });
    this.track(this.open(kind, rule.severity, rule.category, rule.title,
      `${source}: ${r.count} ${rule.what} within ${rule.windowMs / 60_000} minutes (threshold ${rule.threshold}).`, new Date(this.now())));
    return true;
  }

  private track(p: Promise<unknown>) { this.pending.add(p); void p.finally(() => this.pending.delete(p)); }

  /** One incident per kind per hour; a new source appends a line to it. One alert per incident. */
  async open(kind: SignalKind, severity: 'high' | 'medium', category: IncidentCategory, title: string, line: string, at: Date): Promise<'opened' | 'extended' | 'skipped'> {
    if (!this.db) return 'skipped';
    const ref = incidentRef(kind, at);
    const head = `Detected by platform observability (Constitution 11 D8). Runbook: SECURITY_RUNBOOKS.md. Sources:`;
    try {
      const ins = await sql<{ id: string }>`insert into security_incidents (incident_ref, title, description, category, severity, status, detection_source, detected_at)
          values (${ref}, ${title}, ${`${head}\n${line}`}, ${category}, ${severity}, 'detected', 'observability', ${at})
          on conflict (incident_ref) do nothing returning id`.execute(this.db);
      let result: 'opened' | 'extended' = 'opened';
      if (!ins.rows.length) {
        result = 'extended';
        await sql`update security_incidents set description = left(coalesce(description, '') || ${'\n' + line}, 4000), updated_at = ${at}
                  where incident_ref = ${ref} and tenant_id is null and length(coalesce(description, '')) < 4000`.execute(this.db);
      } else {
        await sql`insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
                  values (gen_random_uuid(), null, 'Platform', ${title}, ${`${line} Security incident ${ref}. Runbook: SECURITY_RUNBOOKS.md`}, 'security', ${severity}, 'unread', 'security_signal', ${ref}, ${ref})
                  on conflict (dedupe_key) do nothing`.execute(this.db);
      }
      securityIncidentsOpened.inc({ kind, result });
      return result;
    } catch (e) {
      log.error('security.signal_incident_failed', { kind, ref, error: (e as Error).message });
      return 'skipped';
    }
  }

  /** Webhook rejections (from the Phase 11 counters) and the break-glass switch. */
  async tick(): Promise<void> {
    try {
      for (const s of webhookEvents.snapshot()) {
        if (s.labels.outcome !== 'rejected') continue;
        const p = s.labels.provider; const v = s.value as number;
        const delta = Math.max(0, v - (this.lastWebhookRejected.get(p) ?? 0));
        this.lastWebhookRejected.set(p, v);
        if (delta > 0) this.bump('webhook_signature_failures', `provider ${p}`, delta);
      }
    } catch (e) { log.error('security.webhook_signal_failed', { error: (e as Error).message }); }
    await this.checkBreakGlass();
    await this.checkPaymentRetries();
    await Promise.allSettled([...this.pending]);
  }

  /** A change in what THIS process sees, written once fleet-wide (conditional upsert). */
  async checkBreakGlass(): Promise<'changed' | 'unchanged' | 'skipped'> {
    const mode = breakGlassMode(this.env as NodeJS.ProcessEnv);
    if (mode === this.lastBreakGlass) return 'unchanged';
    this.lastBreakGlass = mode;
    if (!this.db) return 'skipped';
    try {
      const prev = (await sql<{ value: string }>`select value from observability_signal_state where key = 'break_glass_mode'`.execute(this.db)).rows[0]?.value ?? null;
      const flipped = (await sql<{ value: string }>`insert into observability_signal_state (key, value, updated_at) values ('break_glass_mode', ${mode}, ${new Date(this.now())})
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
          where observability_signal_state.value is distinct from (excluded.value) returning value`.execute(this.db)).rows.length > 0;
      if (!flipped || (prev === null && mode === 'off')) return 'unchanged';     // first ever observation of "off": a baseline, not a toggle
      securitySignals.inc({ kind: 'break_glass' });
      const at = new Date(this.now());
      const title = mode === 'off' ? 'Break-glass maintenance switched OFF' : `Break-glass maintenance switched ON (${mode})`;
      const line = `${at.toISOString()}: MAINTENANCE_BREAK_GLASS ${prev ?? 'unset'} → ${mode}. ${mode === 'full' ? 'Every salon is locked out until it is cleared.' : mode === 'read_only' ? 'Every write is refused until it is cleared.' : 'The platform is open again.'}`;
      log.warn('security.break_glass_changed', { from: prev, to: mode });
      await this.open('break_glass', 'high', 'privilege', title, line, at);
      return 'changed';
    } catch (e) { log.error('security.break_glass_signal_failed', { error: (e as Error).message }); return 'skipped'; }
  }
}

/** Sees every finished response — including 401 / 403 / 429 thrown by guards, which interceptors never see. */
@Injectable()
export class SecuritySignalsMiddleware implements NestMiddleware {
  constructor(private readonly signals: SecuritySignals) {}
  use(req: any, res: any, next: () => void): void {
    try {
      res.on('finish', () => this.signals.observeResponse({ status: Number(res.statusCode), ip: req.ip ?? req.socket?.remoteAddress, tenantId: req.ctx?.tenantId ?? null, path: req.originalUrl ?? req.url, method: req.method, userId: req.ctx?.userId ?? null }));
    } catch { /* never block a request */ }
    next();
  }
}
