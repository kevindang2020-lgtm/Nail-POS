// device-alert-routing.ts — Device Integration Logs backlog · 05 (Nov 12 2026): automated alert routing for device offline,
// terminal unavailable, repeated integration (sync) failures and critical provider errors.
//
// It owns NO alert store and NO device data. It reads:
//   devices   DeviceFleetCenter.alertRows (the fleet read model's own statuses — displays, kiosks, terminals), passed in
//   errors    tenant_event_logs (the Device & Integration log store), the last 60 minutes
// and writes the salon's EXISTING alert feed: owner_alerts, category 'device_integration' (owner + managers, the Owner app's
// alert list; acknowledged / resolved through the existing /owner/alerts/:id lifecycle).
//
// Fatigue rules (server-side, never in a browser): ONE open alert per dedupe key (partial unique index, migration 874) — a
// repeat detection only updates its count / last seen / detections; after an alert is resolved or dismissed the same key is
// not reopened for 30 minutes (critical provider errors excepted); devices are grouped per class (one alert for "2 displays
// offline", not one per device); a device silent for more than 24 hours is not re-alerted (it is a known outage, not news).
// A rule is never switched off by the system. Counts and device names only — never customer data, payloads or secrets.
import { sql, type Kysely } from 'kysely';
import type { DfDevice, DfAlertRule, DfAlert, DfAlertsResponse } from '@aipowersalon/api-contracts/tenant';

export const DEVICE_ALERT_CATEGORY = 'device_integration';
export const DEVICE_ALERT_COOLDOWN_MS = 30 * 60_000;
export const DEVICE_ALERT_WINDOW_MIN = 60;          // integration errors are counted over the last hour
export const SYNC_FAILURE_THRESHOLD = 3;            // ≥ 3 errors from one source in the window = repeated sync failure
export const OFFLINE_RECENT_MS = 24 * 3_600_000;   // a device silent longer than this is a known outage, not re-alerted

export interface LogErrorGroup { source: string; severity: 'error' | 'critical'; count: number; first: string | null; last: string | null }
export interface DeviceAlertDetection {
  rule: DfAlertRule; dedupeKey: string; severity: 'warning' | 'high' | 'critical'; deviceClass: string | null; source: string | null;
  count: number; names: string[]; action: string; first: string | null; last: string | null; title: string; body: string;
}

const SAFE_SOURCE = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 48) || 'unknown';
const CLASS_WORD: Record<string, string> = { display: 'customer display', kiosk: 'check-in kiosk', tablet: 'tablet' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Pure: what to alert about, from the fleet rows and the hour's error groups. Exported for tests. */
export function detectDeviceAlerts(devices: DfDevice[], errors: LogErrorGroup[], nowMs: number): DeviceAlertDetection[] {
  const out: DeviceAlertDetection[] = [];
  const recent = (d: DfDevice) => { const s = d.lastSeenAt ? Date.parse(d.lastSeenAt) : NaN; return !Number.isNaN(s) && nowMs - s <= OFFLINE_RECENT_MS; };
  for (const cls of ['display', 'kiosk'] as const) {
    const off = devices.filter((d) => d.class === cls && d.status === 'offline' && recent(d));
    if (!off.length) continue;
    const seen = off.map((d) => d.lastSeenAt).filter((x): x is string => !!x).sort();
    out.push({ rule: 'device_offline', dedupeKey: `device_offline:${cls}`, severity: 'warning', deviceClass: cls, source: null, count: off.length,
      names: off.map((d) => d.name).slice(0, 5), action: 'check_power_network', first: seen[0] ?? null, last: seen[seen.length - 1] ?? null,
      title: `${plural(off.length, CLASS_WORD[cls])} offline`, body: `${plural(off.length, CLASS_WORD[cls])} stopped reporting (${off.map((d) => d.name).slice(0, 3).join(', ')}${off.length > 3 ? ', …' : ''}). Check power and network, then open Device Health.` });
  }
  const terms = devices.filter((d) => d.class === 'terminal' && (d.status === 'offline' || d.status === 'attention'));
  if (terms.length) {
    out.push({ rule: 'terminal_unavailable', dedupeKey: 'terminal_unavailable', severity: 'high', deviceClass: 'terminal', source: null, count: terms.length,
      names: terms.map((d) => d.name).slice(0, 5), action: 'test_terminal', first: null, last: terms.map((d) => d.lastSeenAt).filter((x): x is string => !!x).sort().pop() ?? null,
      title: `${plural(terms.length, 'card terminal')} unavailable`, body: `${plural(terms.length, 'card terminal')} cannot take payments right now (${terms.map((d) => d.name).slice(0, 3).join(', ')}). Test the terminal from Payment Terminals; take payment on another terminal meanwhile.` });
  }
  for (const g of errors) {
    const src = SAFE_SOURCE(g.source);
    if (g.severity === 'critical' && g.count > 0) {
      out.push({ rule: 'provider_critical', dedupeKey: `provider_critical:${src}`, severity: 'critical', deviceClass: null, source: src, count: g.count, names: [], action: 'contact_support',
        first: g.first, last: g.last, title: `Critical error from ${src}`, body: `${plural(g.count, 'critical error')} from ${src} in the last hour. Open Device & Integration Logs and report it to support.` });
    } else if (g.severity === 'error' && g.count >= SYNC_FAILURE_THRESHOLD) {
      out.push({ rule: 'sync_failures', dedupeKey: `sync_failures:${src}`, severity: 'warning', deviceClass: null, source: src, count: g.count, names: [], action: 'review_integration',
        first: g.first, last: g.last, title: `Repeated failures from ${src}`, body: `${plural(g.count, 'failure')} from ${src} in the last hour. Check the integration's connection in Devices & Integrations.` });
    }
  }
  return out;
}

const iso = (v: unknown): string | null => { if (v == null) return null; const n = v instanceof Date ? v.getTime() : Date.parse(String(v)); return Number.isNaN(n) ? null : new Date(n).toISOString(); };

/** Evaluate one salon: detect, then open / update / suppress (cooldown). Never throws for one bad rule — a write that loses
 *  the race with another evaluator (the open-alert index) counts as an update. */
export type FleetRowsFn = (tenantId: string) => Promise<DfDevice[]>;
export async function evaluateDeviceAlerts(db: Kysely<any>, tenantId: string, fleetRows: FleetRowsFn, o: { now?: number } = {}): Promise<{ opened: number; updated: number; suppressed: number; detections: DeviceAlertDetection[] }> {
  const now = o.now ?? Date.now();
  const devices = await fleetRows(tenantId);
  const since = new Date(now - DEVICE_ALERT_WINDOW_MIN * 60_000).toISOString();
  const errs = (await sql<{ source: string; severity: string; n: number; first: unknown; last: unknown }>`
    select lower(source) as source, severity, count(*)::int as n, min(created_at) as first, max(created_at) as last
      from tenant_event_logs where tenant_id = ${tenantId} and severity in ('error', 'critical')
       and created_at >= ${since}::timestamptz and created_at <= ${new Date(now).toISOString()}::timestamptz
     group by lower(source), severity order by lower(source) limit 200`.execute(db)).rows;
  const detections = detectDeviceAlerts(devices, errs.map((r) => ({ source: String(r.source ?? ''), severity: r.severity === 'critical' ? 'critical' : 'error', count: Number(r.n ?? 0), first: iso(r.first), last: iso(r.last) })), now);
  let opened = 0, updated = 0, suppressed = 0;
  for (const d of detections) {
    const open = (await sql<{ id: string; metadata: any }>`select id, metadata from owner_alerts where tenant_id = ${tenantId} and category = ${DEVICE_ALERT_CATEGORY}
      and metadata->>'dedupeKey' = ${d.dedupeKey} and status in ('new', 'acknowledged', 'in_progress') limit 1`.execute(db)).rows[0];
    if (open) {
      const m = open.metadata ?? {};
      const meta = { ...m, count: d.count, names: d.names, lastEventAt: d.last ?? m.lastEventAt ?? null, detections: Number(m.detections ?? 1) + 1, lastDetectedAt: new Date(now).toISOString() };
      await sql`update owner_alerts set metadata = ${JSON.stringify(meta)}::jsonb, title = ${d.title}, body = ${d.body}, updated_at = now() where id = ${open.id} and tenant_id = ${tenantId}`.execute(db);
      updated++; continue;
    }
    const recent = (await sql<{ id: string; at: unknown }>`select id, coalesce(resolved_at, updated_at) as at from owner_alerts where tenant_id = ${tenantId} and category = ${DEVICE_ALERT_CATEGORY}
      and metadata->>'dedupeKey' = ${d.dedupeKey} and status in ('resolved', 'dismissed') order by coalesce(resolved_at, updated_at) desc limit 1`.execute(db)).rows[0];
    const closedAt = recent ? Date.parse(String(iso(recent.at))) : NaN;
    if (recent && !Number.isNaN(closedAt) && now - closedAt < DEVICE_ALERT_COOLDOWN_MS && d.severity !== 'critical') { suppressed++; continue; }   // cooldown after a resolve
    const meta = { dedupeKey: d.dedupeKey, rule: d.rule, deviceClass: d.deviceClass, source: d.source, count: d.count, names: d.names, action: d.action,
      firstEventAt: d.first, lastEventAt: d.last, detections: 1, lastDetectedAt: new Date(now).toISOString(), previousAlertId: recent?.id ?? null, origin: 'device_alert_routing' };
    const ins = await sql<{ id: string }>`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      values (${tenantId}, null, ${DEVICE_ALERT_CATEGORY}, ${d.severity}, 'new', ${d.title}, ${d.body}, ${JSON.stringify(meta)}::jsonb, 'all')
      on conflict (tenant_id, (metadata->>'dedupeKey')) where category = 'device_integration' and status in ('new', 'acknowledged', 'in_progress') do nothing returning id`.execute(db);
    if (ins.rows.length) opened++; else updated++;
  }
  return { opened, updated, suppressed, detections };
}

/** The salons worth evaluating: any registered display / kiosk / terminal, or an integration error in the last hour. */
export async function evaluateAllDeviceAlerts(db: Kysely<any>, fleetRows: FleetRowsFn, onError: (e: unknown) => void): Promise<{ tenants: number; opened: number }> {
  const tenants = (await sql<{ tenant_id: string }>`
    select distinct x.tenant_id::text as tenant_id from (
      select tenant_id::text from customer_display_devices where revoked_at is null
      union select tenant_id::text from go_checkin_devices where disabled_at is null
      union select tenant_id::text from pos_payment_terminals where disabled_at is null
      union select tenant_id::text from tenant_event_logs where severity in ('error', 'critical') and created_at >= now() - interval '1 hour'
    ) x where x.tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 5000`.execute(db)).rows;
  let opened = 0;
  for (const t of tenants) {
    try { opened += (await evaluateDeviceAlerts(db, String(t.tenant_id), fleetRows)).opened; }
    catch (e) { onError(e); }
  }
  return { tenants: tenants.length, opened };
}

export interface DeviceAlertListCtx { tenantId: string; branchId?: string | null; permissions?: string[] }
const ALERT_STATUS = ['open', 'closed', 'all'] as const;
const PAGE_SIZES = [10, 25, 50];

/** The routed alerts for the logs page: open first (newest change first), then closed. Scope is the salon (alerts are
 *  salon-wide). `canResolve` = the viewer may resolve through the existing owner-alert lifecycle. */
export async function listDeviceAlerts(db: Kysely<any>, ctx: DeviceAlertListCtx, q: { status?: string; page?: unknown; pageSize?: unknown }, canResolve: boolean, evaluatedAt: string | null): Promise<DfAlertsResponse> {
  const st = (ALERT_STATUS as readonly string[]).includes(String(q.status)) ? String(q.status) : 'open';
  const pageSize = PAGE_SIZES.includes(Number(q.pageSize)) ? Number(q.pageSize) : 10;
  const want = Math.max(1, Math.min(10_000, Math.trunc(Number(q.page)) || 1));
  const cond = st === 'closed' ? sql`a.status in ('resolved', 'dismissed')` : st === 'all' ? sql`true` : sql`a.status in ('new', 'acknowledged', 'in_progress')`;
  const total = Number((await sql<{ n: number }>`select count(*)::int as n from owner_alerts a where a.tenant_id = ${ctx.tenantId} and a.category = ${DEVICE_ALERT_CATEGORY} and ${cond}`.execute(db)).rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(want, totalPages);
  const rows = (await sql<{ id: string; severity: string; status: string; metadata: any; created_at: unknown; updated_at: unknown; resolved_at: unknown; resolved_by: string | null }>`
    select a.id, a.severity, a.status, a.metadata, a.created_at, a.updated_at, a.resolved_at, u.full_name as resolved_by
      from owner_alerts a left join users u on u.id = a.resolved_by_user_id
     where a.tenant_id = ${ctx.tenantId} and a.category = ${DEVICE_ALERT_CATEGORY} and ${cond}
     order by (a.status in ('new', 'acknowledged', 'in_progress')) desc, a.updated_at desc, a.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(db)).rows;
  const items: DfAlert[] = rows.map((r) => { const m = r.metadata ?? {}; return {
    id: String(r.id), rule: m.rule, severity: r.severity, status: r.status, dedupeKey: String(m.dedupeKey ?? ''), deviceClass: m.deviceClass ?? null, source: m.source ?? null,
    count: Number(m.count ?? 0), names: Array.isArray(m.names) ? m.names.map(String).slice(0, 5) : [], action: String(m.action ?? ''), firstEventAt: m.firstEventAt ?? null,
    lastEventAt: m.lastEventAt ?? null, detections: Number(m.detections ?? 1), openedAt: iso(r.created_at), updatedAt: iso(r.updated_at), resolvedAt: iso(r.resolved_at), resolvedBy: r.resolved_by ?? null }; });
  return { items, page, pageSize, totalItems: total, totalPages, evaluatedAt, cooldownMinutes: DEVICE_ALERT_COOLDOWN_MS / 60_000, canResolve };
}
