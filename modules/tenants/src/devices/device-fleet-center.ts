// device-fleet-center.ts — SUNMI batch 8 (Nov 9 2026): one READ model over the salon's REAL device registries, for the
// Devices & Integrations sub-pages (Reception POS · Check-In Kiosks · iPads & Tablets · Receipt Devices · Device
// Assignments · Device Health). It owns no device data and writes nothing — it reads the systems of record:
//
//   reception_pos  pos_stations (the salon's registers; a station is "online" when the display dedicated to it reports)
//   kiosk          go_checkin_devices (Go Check-In kiosks, created by AIPowerSalon support; heartbeat = last_seen_at)
//   display        customer_display_devices (paired displays — iPad / Android / web; heartbeat every 30 s)
//   terminal       pos_payment_terminals (Clover Compact; the PAYI normalized status — a terminal that never answered is
//                  UNKNOWN, never "connected")
//   receipt        NO printer registry exists in AI PowerSalon: receipts are digital (Email / SMS / No receipt, chosen
//                  on the customer display). The page says NOT CONFIGURED and shows the real digital-receipt history.
//
// ROOT CAUSE this fixes: the old sub-pages filtered customer_display_devices by device types that registry never stores
// ('reception_pos', 'check_in_kiosk', 'printer') — so Reception POS / Kiosks / Receipt Devices always said "0 connected"
// even with stations and kiosks on file.
//
// Statuses (one vocabulary): online · offline · attention · pending · disabled · revoked · retired · maintenance · unknown.
// Counts are exact over the scoped rows (a salon's fleet is tens of rows; each registry read is capped at 2000 and the
// cap is reported). Scope: tenant + the session branch (rows of that branch, or with no branch), exactly as the
// Devices Overview reads. History is the canonical audit_logs + go_checkin_logs — never a second log store.
import { sql } from 'kysely';
import { DISPLAY_ONLINE_WINDOW_MS, terminalOperationalStatus } from '@aipowersalon/api-contracts';
import type { DfClass, DfDevice, DfStatus, DfSummary, DfListResponse, DfHistoryResponse, DfCheckResponse, DfReceiptEvent } from '@aipowersalon/api-contracts/tenant';

export interface DfCtx { tenantId: string; branchId: string; userId?: string | null; role?: string; permissions?: string[] }
export class DeviceFleetError extends Error { constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = 'DeviceFleetError'; } }

export const DF_CLASSES = ['all', 'reception_pos', 'kiosk', 'tablet', 'display', 'terminal', 'receipt'] as const;
export const DF_STATUSES = ['all', 'online', 'offline', 'attention', 'pending', 'disabled', 'revoked', 'retired', 'maintenance', 'unknown', 'unassigned'] as const;
export const DF_SORTS = ['newest', 'last_seen', 'name', 'status'] as const;
export const DF_PAGE_SIZES = [10, 25, 50, 100] as const;
/** a kiosk reports when a guest uses it and on its keep-alive; heard from in 5 minutes = connected */
export const KIOSK_ONLINE_WINDOW_MS = 5 * 60_000;
const CAP = 2000;
const TABLET_DISPLAY_TYPES = ['ipad', 'ipad_mini', 'android', 'android_tablet', 'tablet'];
const TABLET_KIOSK_TYPES = ['ipad', 'tablet', 'tablet_kiosk', 'ipad_display'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ms = (v: unknown): number | null => { if (v == null) return null; const n = v instanceof Date ? v.getTime() : Date.parse(String(v)); return Number.isNaN(n) ? null : n; };
const iso = (v: unknown): string | null => { const n = ms(v); return n == null ? null : new Date(n).toISOString(); };
const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** the salon's own calendar day start (as an instant) — "today" counts follow the branch's clock, not the server's UTC day */
const SCOPE_COLS: Record<string, { tenant: ReturnType<typeof sql.ref>; branch: ReturnType<typeof sql.ref> }> = {
  d: { tenant: sql.ref('d.tenant_id'), branch: sql.ref('d.branch_id') }, k: { tenant: sql.ref('k.tenant_id'), branch: sql.ref('k.branch_id') },
  s: { tenant: sql.ref('s.tenant_id'), branch: sql.ref('s.branch_id') }, t: { tenant: sql.ref('t.tenant_id'), branch: sql.ref('t.branch_id') },
};

export function zonedDayStart(tz: string, now: Date): Date {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
    const secs = (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
    return new Date(Math.floor(now.getTime() / 1000) * 1000 - secs * 1000);
  } catch { return new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000); }
}

export interface DfQuery { class?: string; q?: string; status?: string; branchId?: string; from?: string; to?: string; dateField?: string; sort?: string; page?: number; pageSize?: number }

/** How many live devices share their (branch, normalised name) with at least one other device. Exported for tests. */
export function duplicateNameCount(rows: Pick<DfDevice, 'name' | 'branchId'>[]): number {
  const groups = new Map<string, number>();
  for (const r of rows) { const n = String(r.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); if (!n) continue; const k = `${r.branchId ?? ''}|${n}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
  let dup = 0; for (const c of groups.values()) if (c > 1) dup += c;
  return dup;
}

export class DeviceFleetCenter {
  constructor(readonly db: any, private readonly now: () => Date = () => new Date()) {}

  private scope(alias: string, ctx: DfCtx, textTenant = false) {
    // the alias is always one of the code's own table aliases — mapped to literal column refs (never request data)
    const cols = SCOPE_COLS[alias]; if (!cols) throw new Error(`unknown scope alias ${alias}`);
    const t = textTenant ? sql`${cols.tenant}::text = ${ctx.tenantId}` : sql`${cols.tenant} = ${ctx.tenantId}`;
    return ctx.branchId ? sql`${t} AND (${cols.branch}::text = ${ctx.branchId} OR ${cols.branch} IS NULL)` : t;
  }
  private async todayStart(ctx: DfCtx): Promise<Date> {
    const r = await sql<{ tz: string | null }>`SELECT timezone AS tz FROM branches WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL
      ORDER BY (id::text = ${ctx.branchId || ''}) DESC, created_at LIMIT 1`.execute(this.db);
    return zonedDayStart(r.rows[0]?.tz || 'UTC', this.now());
  }

  // ── the registries ────────────────────────────────────────────────────────────────────────────────────────────
  private async stations(ctx: DfCtx, nowMs: number): Promise<DfDevice[]> {
    const r = await sql<any>`
      SELECT s.id, s.name, s.branch_id, b.name AS branch_name, s.created_at, s.updated_at, s.retired_at,
             (SELECT count(*)::int FROM customer_display_devices d WHERE d.tenant_id = s.tenant_id AND d.pos_station_id = s.id AND d.revoked_at IS NULL) AS displays,
             (SELECT max(d.last_seen_at) FROM customer_display_devices d WHERE d.tenant_id = s.tenant_id AND d.pos_station_id = s.id AND d.revoked_at IS NULL) AS display_seen,
             (SELECT count(*)::int FROM pos_payment_terminals t WHERE t.tenant_id = s.tenant_id::text AND t.station_id = s.id::text AND t.disabled_at IS NULL) AS terminals
        FROM pos_stations s LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
       WHERE ${this.scope('s', ctx)} ORDER BY s.created_at DESC LIMIT ${CAP}`.execute(this.db);
    return r.rows.map((s: any) => {
      const seen = ms(s.display_seen);
      const status: DfStatus = s.retired_at ? 'retired' : !Number(s.displays) ? 'unassigned' : seen != null && nowMs - seen <= DISPLAY_ONLINE_WINDOW_MS ? 'online' : 'attention';
      return { id: String(s.id), source: 'station', class: 'reception_pos', name: String(s.name ?? ''), type: 'reception_pos', branchId: s.branch_id ? String(s.branch_id) : null, branch: s.branch_name ?? null,
        station: String(s.name ?? ''), status, reason: status === 'unassigned' ? 'NO_DEDICATED_DISPLAY' : status === 'attention' ? 'REGISTER_DISPLAY_NOT_REPORTING' : null,
        lastSeenAt: iso(s.display_seen), createdAt: iso(s.created_at), updatedAt: iso(s.updated_at),
        facts: { displays: Number(s.displays ?? 0), terminals: Number(s.terminals ?? 0) } } as DfDevice;
    });
  }

  private async kiosks(ctx: DfCtx, nowMs: number, types?: string[]): Promise<DfDevice[]> {
    const r = await sql<any>`
      SELECT k.id, k.device_name, k.device_type, k.branch_id, b.name AS branch_name, k.status, k.last_seen_at, k.created_at, k.updated_at, k.disabled_at, k.token_expires_at
        FROM go_checkin_devices k LEFT JOIN branches b ON b.id = k.branch_id AND b.tenant_id = k.tenant_id
       WHERE ${this.scope('k', ctx)} ${types ? sql`AND k.device_type = ANY(${types}::text[])` : sql``}
       ORDER BY k.created_at DESC LIMIT ${CAP}`.execute(this.db);
    return r.rows.map((k: any) => {
      const seen = ms(k.last_seen_at); const st = String(k.status ?? '');
      const expired = st === 'expired' || (k.token_expires_at && (ms(k.token_expires_at) ?? Infinity) < nowMs);
      const status: DfStatus = k.disabled_at || st === 'disabled' || st === 'inactive' ? 'disabled' : st === 'revoked' ? 'revoked' : expired ? 'attention'
        : seen == null ? 'pending' : nowMs - seen <= KIOSK_ONLINE_WINDOW_MS ? 'online' : 'offline';
      return { id: String(k.id), source: 'kiosk', class: types ? 'tablet' : 'kiosk', name: String(k.device_name ?? ''), type: String(k.device_type ?? 'kiosk'),
        branchId: k.branch_id ? String(k.branch_id) : null, branch: k.branch_name ?? null, station: null, status,
        reason: expired ? 'KIOSK_LINK_EXPIRED' : status === 'pending' ? 'NEVER_CONNECTED' : status === 'offline' ? 'NOT_HEARD_FROM' : !k.branch_id ? 'NO_BRANCH' : null,
        lastSeenAt: iso(k.last_seen_at), createdAt: iso(k.created_at), updatedAt: iso(k.updated_at), facts: { role: 'kiosk' } } as DfDevice;
    });
  }

  private async displays(ctx: DfCtx, nowMs: number, types?: string[]): Promise<DfDevice[]> {
    const r = await sql<any>`
      SELECT d.id, d.device_name, d.device_type, d.branch_id, b.name AS branch_name, st.name AS station_name, d.pos_station_id, d.pairing_status,
             d.last_seen_at, d.revoked_at, d.maintenance_at, d.created_at, d.updated_at, d.app_version, d.reported_mode, d.screen_width, d.screen_height
        FROM customer_display_devices d
        LEFT JOIN branches b ON b.id = d.branch_id AND b.tenant_id = d.tenant_id
        LEFT JOIN pos_stations st ON st.tenant_id = d.tenant_id AND st.id = d.pos_station_id
       WHERE ${this.scope('d', ctx)} ${types ? sql`AND d.device_type = ANY(${types}::text[])` : sql``}
       ORDER BY d.created_at DESC LIMIT ${CAP}`.execute(this.db);
    return r.rows.map((d: any) => {
      const seen = ms(d.last_seen_at); const ps = String(d.pairing_status ?? '').toLowerCase();
      const status: DfStatus = d.revoked_at ? 'revoked' : d.maintenance_at ? 'maintenance' : ps === 'pending' && seen == null ? 'pending'
        : seen == null ? 'unknown' : nowMs - seen <= DISPLAY_ONLINE_WINDOW_MS ? 'online' : 'offline';
      return { id: String(d.id), source: 'display', class: types ? 'tablet' : 'display', name: String(d.device_name ?? ''), type: String(d.device_type ?? 'customer_display'),
        branchId: d.branch_id ? String(d.branch_id) : null, branch: d.branch_name ?? null, station: d.station_name ?? null, status,
        reason: status === 'offline' ? 'NOT_HEARD_FROM' : status === 'pending' ? 'PAIRING_NOT_FINISHED' : !d.pos_station_id && status !== 'revoked' ? 'NO_REGISTER' : null,
        lastSeenAt: iso(d.last_seen_at), createdAt: iso(d.created_at), updatedAt: iso(d.updated_at),
        facts: { role: 'customer_display', appVersion: d.app_version ?? null, mode: d.reported_mode ?? null, screen: d.screen_width && d.screen_height ? `${d.screen_width}×${d.screen_height}` : null } } as DfDevice;
    });
  }

  private async terminals(ctx: DfCtx): Promise<DfDevice[]> {
    const r = await sql<any>`
      SELECT t.id, t.label, t.status, t.branch_id, b.name AS branch_name, COALESCE(st.name, t.station_id) AS station_name, t.station_id, t.paired_at, t.disabled_at, t.last_seen_at,
             t.last_ping_at, t.last_ping_ok, t.last_transaction_at, t.hsn, t.terminal_type,
             (SELECT l.holder FROM payment_terminal_leases l WHERE l.tenant_id::text = t.tenant_id AND l.terminal_id = t.id AND l.expires_at > now() LIMIT 1) AS lease_holder,
             (SELECT l.expires_at FROM payment_terminal_leases l WHERE l.tenant_id::text = t.tenant_id AND l.terminal_id = t.id AND l.expires_at > now() LIMIT 1) AS lease_until,
             st.id AS register_id,
             -- the processor this terminal's checkout would route through: the branch's own merchant account, else the salon default
             COALESCE((SELECT ma.processor FROM payment_merchant_accounts ma WHERE ma.tenant_id::text = t.tenant_id AND ma.branch_id::text = t.branch_id LIMIT 1),
                      (SELECT pc.processor FROM tenant_payment_config pc WHERE pc.tenant_id::text = t.tenant_id LIMIT 1)) AS route_processor,
             COALESCE((SELECT ma.environment FROM payment_merchant_accounts ma WHERE ma.tenant_id::text = t.tenant_id AND ma.branch_id::text = t.branch_id LIMIT 1),
                      (SELECT pc.environment FROM tenant_payment_config pc WHERE pc.tenant_id::text = t.tenant_id LIMIT 1)) AS route_environment
        FROM pos_payment_terminals t
        LEFT JOIN branches b ON b.id::text = t.branch_id AND b.tenant_id::text = t.tenant_id
        LEFT JOIN pos_stations st ON st.tenant_id::text = t.tenant_id AND st.id::text = t.station_id AND st.retired_at IS NULL
       WHERE ${this.scope('t', ctx, true)} ORDER BY t.label LIMIT ${CAP}`.execute(this.db);
    return r.rows.map((t: any) => {
      const op = terminalOperationalStatus({ paired: ['paired', 'online', 'connected'].includes(String(t.status ?? '').toLowerCase()), disabledAt: t.disabled_at ? String(t.disabled_at) : null,
        lastSeenAt: iso(t.last_seen_at), lastPingAt: iso(t.last_ping_at), lastPingOk: t.last_ping_ok ?? null, leaseHolder: t.lease_holder ?? null }, this.now());
      const status: DfStatus = op === 'DISABLED' ? 'disabled' : op === 'ONLINE' || op === 'BUSY' || op === 'PROCESSING' ? 'online' : op === 'UNKNOWN' ? 'unknown' : op === 'DEGRADED' ? 'attention' : 'offline';
      const hsn = String(t.hsn ?? '');
      return { id: String(t.id), source: 'terminal', class: 'terminal', name: String(t.label ?? ''), type: String(t.terminal_type ?? 'payment_terminal'),
        branchId: t.branch_id ? String(t.branch_id) : null, branch: t.branch_name ?? null, station: t.station_name ?? null, status,
        reason: op === 'UNKNOWN' ? 'TERMINAL_NOT_TESTED' : op === 'DEGRADED' ? 'NOT_HEARD_FROM' : op === 'OFFLINE' ? 'TERMINAL_OFFLINE' : !t.station_id ? 'NO_REGISTER' : null,
        lastSeenAt: iso(t.last_seen_at ?? t.last_ping_at), createdAt: iso(t.paired_at), updatedAt: iso(t.last_transaction_at),
        facts: { operational: op, hsnMasked: hsn ? '••••' + hsn.slice(-4) : null, routing: terminalRouting({ op, registerPaired: !!t.register_id, leaseHolder: t.lease_holder ?? null,
          leaseUntil: iso(t.lease_until), processor: t.route_processor ?? null, environment: t.route_environment ?? null, lastPingOk: t.last_ping_ok ?? null, lastPingAt: iso(t.last_ping_at) }) } } as DfDevice;
    });
  }

  private async rows(ctx: DfCtx, cls: DfClass): Promise<DfDevice[]> {
    const nowMs = this.now().getTime();
    const safe = async (p: Promise<DfDevice[]>) => p;   // a registry error surfaces (never a silently empty fleet)
    switch (cls) {
      case 'reception_pos': return safe(this.stations(ctx, nowMs));
      case 'kiosk': return safe(this.kiosks(ctx, nowMs));
      case 'display': return safe(this.displays(ctx, nowMs));
      case 'terminal': return safe(this.terminals(ctx));
      case 'tablet': return [...await this.displays(ctx, nowMs, TABLET_DISPLAY_TYPES), ...await this.kiosks(ctx, nowMs, TABLET_KIOSK_TYPES)];
      case 'receipt': return [];   // no printer registry exists (digital-first receipts)
      default: return [...await this.displays(ctx, nowMs), ...await this.kiosks(ctx, nowMs), ...await this.terminals(ctx)];
    }
  }

  private cls(v?: string): DfClass {
    const c = String(v ?? 'all');
    if (!(DF_CLASSES as readonly string[]).includes(c)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_CLASS', 'Unknown device class.');
    return c as DfClass;
  }

  async summary(ctx: DfCtx, clsIn?: string): Promise<DfSummary> {
    const cls = this.cls(clsIn);
    const rows = await this.rows(ctx, cls);
    const live = rows.filter((r) => !['revoked', 'retired'].includes(r.status));
    const attention = live.filter((r) => ['offline', 'attention', 'unknown', 'pending', 'maintenance'].includes(r.status) && !(cls === 'reception_pos' && r.status === 'unassigned'));
    const unassigned = live.filter((r) => r.status === 'unassigned' || (r.source === 'display' && !r.station) || (r.source === 'kiosk' && !r.branchId) || (r.source === 'terminal' && !r.station));
    const out: DfSummary = { class: cls, checkedAt: this.now().toISOString(), registered: live.length, online: live.filter((r) => r.status === 'online').length,
      attention: attention.length, unassigned: unassigned.length, disabled: live.filter((r) => r.status === 'disabled').length,
      retired: rows.length - live.length, extra: {} };
    if (cls === 'kiosk' || cls === 'all') {
      const t = await sql<{ n: number }>`SELECT count(*)::int AS n FROM go_checkin_sessions s
          WHERE s.tenant_id = ${ctx.tenantId} ${ctx.branchId ? sql`AND (s.branch_id = ${ctx.branchId} OR s.branch_id IS NULL)` : sql``}
            AND s.device_id IS NOT NULL AND s.completed_at IS NOT NULL AND s.completed_at >= ${await this.todayStart(ctx)}`.execute(this.db);
      out.extra.checkedInToday = Number(t.rows[0]?.n ?? 0);
    }
    if (cls === 'receipt') {
      const r = await sql<{ email: number; sms: number; none: number; failed: number; last: unknown }>`SELECT
          count(*) FILTER (WHERE receipt_choice = 'email')::int AS email, count(*) FILTER (WHERE receipt_choice = 'sms')::int AS sms,
          count(*) FILTER (WHERE receipt_choice = 'none')::int AS none, count(*) FILTER (WHERE receipt_status = 'failed')::int AS failed, max(receipt_at) AS last
        FROM customer_display_sessions WHERE tenant_id = ${ctx.tenantId} ${ctx.branchId ? sql`AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)` : sql``}
          AND receipt_at >= ${await this.todayStart(ctx)}`.execute(this.db);
      const x: Partial<{ email: number; sms: number; none: number; failed: number; last: unknown }> = r.rows[0] ?? {};
      out.extra = { printerRegistry: 'not_configured', emailToday: Number(x.email ?? 0), smsToday: Number(x.sms ?? 0), noReceiptToday: Number(x.none ?? 0), failedToday: Number(x.failed ?? 0), lastReceiptAt: iso(x.last) };
    }
    return out;
  }

  async list(ctx: DfCtx, q: DfQuery): Promise<DfListResponse> {
    const cls = this.cls(q.class);
    const status = String(q.status ?? 'all');
    if (!(DF_STATUSES as readonly string[]).includes(status)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_STATUS', 'Unknown status filter.');
    const sort = String(q.sort ?? 'newest');
    if (!(DF_SORTS as readonly string[]).includes(sort)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_SORT', 'Unknown sort.');
    const pageSize = Number(q.pageSize ?? 25);
    if (!(DF_PAGE_SIZES as readonly number[]).includes(pageSize)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_PAGE_SIZE', 'Page size must be 10, 25, 50 or 100.');
    if ((q.from && !YMD.test(q.from)) || (q.to && !YMD.test(q.to)) || (q.from && q.to && q.from > q.to)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_PERIOD', 'Pick a start date on or before the end date.');
    if (q.branchId && !UUID.test(q.branchId)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_BRANCH', 'Unknown branch.');
    const term = String(q.q ?? '').trim();
    if (term && term.length < 2) throw new DeviceFleetError('DEVICE_FLEET_SEARCH_TOO_SHORT', 'Type at least 2 characters.');
    let rows = await this.rows(ctx, cls);
    if (term) { const f = fold(term); rows = rows.filter((r) => [r.name, r.branch, r.station, r.type, r.id, r.facts?.hsnMasked].some((v) => fold(v).includes(f))); }
    if (status === 'unassigned') rows = rows.filter((r) => r.status === 'unassigned' || (r.source === 'display' && !r.station) || (r.source === 'kiosk' && !r.branchId) || (r.source === 'terminal' && !r.station));
    else if (status !== 'all') rows = rows.filter((r) => r.status === status);
    if (q.branchId) rows = rows.filter((r) => r.branchId === q.branchId);
    const df = q.dateField === 'last_seen' ? 'lastSeenAt' : q.dateField === 'updated' ? 'updatedAt' : 'createdAt';
    if (q.from || q.to) {
      const lo = q.from ? Date.parse(`${q.from}T00:00:00Z`) : -Infinity; const hi = q.to ? Date.parse(`${q.to}T23:59:59.999Z`) : Infinity;
      rows = rows.filter((r) => { const v = ms(r[df]); return v != null && v >= lo && v <= hi; });
    }
    const by = { newest: (r: DfDevice) => -(ms(r.createdAt) ?? 0), last_seen: (r: DfDevice) => -(ms(r.lastSeenAt) ?? -Infinity), status: (r: DfDevice) => ['attention', 'offline', 'unknown', 'pending', 'unassigned', 'maintenance', 'online', 'disabled', 'revoked', 'retired'].indexOf(r.status) };
    rows.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (by[sort as keyof typeof by](a) - by[sort as keyof typeof by](b))) || a.id.localeCompare(b.id));
    const total = rows.length; const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(Math.max(1, Math.trunc(Number(q.page ?? 1)) || 1), totalPages);
    return { class: cls, items: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages,
      applied: { q: term || null, status, branchId: q.branchId ?? null, from: q.from ?? null, to: q.to ?? null, dateField: q.dateField ?? 'created', sort }, checkedAt: this.now().toISOString() };
  }

  /** the canonical history — audit_logs for displays / registers / terminals, go_checkin_logs for kiosks — newest first */
  async history(ctx: DfCtx, q: { class?: string; deviceId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number }): Promise<DfHistoryResponse> {
    const cls = this.cls(q.class);
    const pageSize = Number(q.pageSize ?? 25);
    if (!(DF_PAGE_SIZES as readonly number[]).includes(pageSize)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_PAGE_SIZE', 'Page size must be 10, 25, 50 or 100.');
    if ((q.from && !YMD.test(q.from)) || (q.to && !YMD.test(q.to)) || (q.from && q.to && q.from > q.to)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_PERIOD', 'Pick a start date on or before the end date.');
    if (q.deviceId && !UUID.test(q.deviceId) && !/^[A-Za-z0-9_.:-]{1,80}$/.test(q.deviceId)) throw new DeviceFleetError('DEVICE_FLEET_INVALID_DEVICE', 'Unknown device.');
    const page = Math.max(1, Math.trunc(Number(q.page ?? 1)) || 1);
    const lo = q.from ? `${q.from}T00:00:00Z` : null; const hi = q.to ? `${q.to}T23:59:59.999Z` : null;
    const term = String(q.q ?? '').trim();
    if (term && term.length < 2) throw new DeviceFleetError('DEVICE_FLEET_SEARCH_TOO_SHORT', 'Type at least 2 characters.');
    const like = term ? `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%` : null;
    const entities = cls === 'reception_pos' ? ['pos_station'] : cls === 'display' || cls === 'tablet' ? ['customer_display'] : cls === 'terminal' ? ['payment_terminal', 'pos_payment_terminal'] : cls === 'kiosk' ? [] : cls === 'receipt' ? [] : ['customer_display', 'pos_station', 'payment_terminal', 'pos_payment_terminal'];
    const withKiosk = cls === 'kiosk' || cls === 'tablet' || cls === 'all';
    if (cls === 'receipt') return this.receiptHistory(ctx, { lo, hi, like, page, pageSize });
    const audit = entities.length ? sql`SELECT a.id::text AS id, a.created_at, a.action_type AS event, a.entity_type AS entity, a.entity_id::text AS device_id, a.role AS actor_role,
          u.full_name AS actor, 'audit' AS source FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.tenant_id = ${ctx.tenantId} AND a.entity_type = ANY(${entities}::text[])
           ${ctx.branchId ? sql`AND (a.branch_id = ${ctx.branchId} OR a.branch_id IS NULL)` : sql``}
           ${q.deviceId ? sql`AND a.entity_id::text = ${q.deviceId}` : sql``} ${lo ? sql`AND a.created_at >= ${lo}` : sql``} ${hi ? sql`AND a.created_at <= ${hi}` : sql``}
           ${like ? sql`AND (a.action_type ILIKE ${like} OR u.full_name ILIKE ${like})` : sql``}` : null;
    const kiosk = withKiosk ? sql`SELECT l.id::text AS id, l.created_at, l.event_type AS event, 'kiosk' AS entity, l.device_id::text AS device_id, NULL::text AS actor_role, NULL::text AS actor, 'kiosk_log' AS source
          FROM go_checkin_logs l WHERE l.tenant_id = ${ctx.tenantId} AND l.device_id IS NOT NULL
           ${ctx.branchId ? sql`AND (l.branch_id = ${ctx.branchId} OR l.branch_id IS NULL)` : sql``}
           ${q.deviceId ? sql`AND l.device_id::text = ${q.deviceId}` : sql``} ${lo ? sql`AND l.created_at >= ${lo}` : sql``} ${hi ? sql`AND l.created_at <= ${hi}` : sql``}
           ${like ? sql`AND (l.event_type ILIKE ${like} OR l.safe_message ILIKE ${like})` : sql``}` : null;
    const union = audit && kiosk ? sql`${audit} UNION ALL ${kiosk}` : (audit ?? kiosk)!;
    const r = await sql<any>`SELECT *, count(*) OVER()::int AS total FROM (${union}) h ORDER BY h.created_at DESC, h.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db);
    const total = Number(r.rows[0]?.total ?? 0);
    return { class: cls, items: r.rows.map((x: any) => ({ id: String(x.id), at: iso(x.created_at)!, event: String(x.event), entity: String(x.entity ?? ''), deviceId: x.device_id ?? null, actor: x.actor ?? null, actorRole: x.actor_role ?? null, source: x.source })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  private async receiptHistory(ctx: DfCtx, p: { lo: string | null; hi: string | null; like: string | null; page: number; pageSize: number }): Promise<DfHistoryResponse> {
    const r = await sql<any>`SELECT s.id::text AS id, s.receipt_at, s.receipt_choice, s.receipt_status, t.ticket_number, st.name AS station, count(*) OVER()::int AS total
        FROM customer_display_sessions s LEFT JOIN tickets t ON t.id = s.ticket_id AND t.tenant_id = s.tenant_id LEFT JOIN pos_stations st ON st.id = s.pos_station_id AND st.tenant_id = s.tenant_id
       WHERE s.tenant_id = ${ctx.tenantId} AND s.receipt_at IS NOT NULL ${ctx.branchId ? sql`AND (s.branch_id = ${ctx.branchId} OR s.branch_id IS NULL)` : sql``}
         ${p.lo ? sql`AND s.receipt_at >= ${p.lo}` : sql``} ${p.hi ? sql`AND s.receipt_at <= ${p.hi}` : sql``}
         ${p.like ? sql`AND (t.ticket_number::text ILIKE ${p.like} OR s.receipt_choice ILIKE ${p.like} OR st.name ILIKE ${p.like})` : sql``}
       ORDER BY s.receipt_at DESC, s.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`.execute(this.db);
    const total = Number(r.rows[0]?.total ?? 0);
    const receipts: DfReceiptEvent[] = r.rows.map((x: any) => ({ id: String(x.id), at: iso(x.receipt_at)!, choice: String(x.receipt_choice ?? ''), status: x.receipt_status ?? null, ticket: x.ticket_number != null ? String(x.ticket_number) : null, station: x.station ?? null }));
    return { class: 'receipt', items: [], receipts, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
  }

  /** read-only diagnostics over the same registries — nothing is paired, pinged, revoked or changed */
  async check(ctx: DfCtx, clsIn?: string): Promise<DfCheckResponse> {
    const cls = this.cls(clsIn);
    const checks: DfCheckResponse['checks'] = [];
    const add = (key: string, state: DfCheckResponse['checks'][number]['state'], count?: number) => checks.push({ key, state, ...(count != null ? { count } : {}) });
    let rows: DfDevice[] = [];
    try { rows = await this.rows(ctx, cls); add('registry_readable', 'READY'); } catch { add('registry_readable', 'FAILED'); }
    const live = rows.filter((r) => !['revoked', 'retired'].includes(r.status));
    if (cls === 'receipt') add('printer_registry', 'NOT_CONFIGURED');
    else add('devices_registered', live.length ? 'READY' : 'NOT_CONFIGURED', live.length);
    const silent = live.filter((r) => ['offline', 'attention', 'unknown'].includes(r.status)).length;
    if (cls !== 'receipt') add('devices_reporting', silent ? 'WARNING' : 'READY', silent);
    const pending = live.filter((r) => r.status === 'pending').length;
    if (cls !== 'receipt') add('pairing_finished', pending ? 'WARNING' : 'READY', pending);
    const noPlace = live.filter((r) => r.status === 'unassigned' || (r.source === 'display' && !r.station) || (r.source === 'kiosk' && !r.branchId)).length;
    if (cls !== 'receipt' && cls !== 'terminal') add('assignments_complete', noPlace ? 'WARNING' : 'READY', noPlace);
    // Device Assignments extras #06 (duplicate identity inspector): two live devices in one branch with the same name (case
    // and spacing ignored) are easy to confuse at the front desk. Flagged as a WARNING with how many devices share a name —
    // never merged, renamed or unregistered here (the check stays read-only).
    if (cls !== 'receipt') add('duplicate_names', duplicateNameCount(live) ? 'WARNING' : 'READY', duplicateNameCount(live));
    if (cls === 'receipt') {
      const s = await this.summary(ctx, 'receipt');
      add('digital_receipts', 'READY', Number(s.extra.emailToday ?? 0) + Number(s.extra.smsToday ?? 0));
      add('receipt_failures_today', Number(s.extra.failedToday ?? 0) ? 'WARNING' : 'READY', Number(s.extra.failedToday ?? 0));
    }
    add('history_readable', await this.history(ctx, { class: cls, pageSize: 10 }).then(() => 'READY' as const, () => 'FAILED' as const));
    add('no_side_effects', 'READY');
    const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : checks.some((c) => c.state === 'NOT_CONFIGURED') ? 'NOT_CONFIGURED' : 'READY';
    return { class: cls, overall, checkedAt: this.now().toISOString(), checks };
  }
}

/** extras Device Assignments 09 — Payment Terminal Routing Guard (read-only). Whether a checkout could route a payment to this
 *  terminal right now, from the facts the payment path itself uses: its operational status (terminalOperationalStatus), the
 *  register it is paired with, an open reservation (payment_terminal_leases — a second POS gets TERMINAL_BUSY) and the
 *  processor its branch routes through. Nothing here talks to the device or moves money. The holder's id never leaves —
 *  only what kind of thing holds it. */
export type TerminalRouteVerdict = 'ready' | 'busy' | 'no_register' | 'no_processor' | 'not_ready';
export function terminalRouting(i: { op: string; registerPaired: boolean; leaseHolder: string | null; leaseUntil: string | null; processor: string | null; environment: string | null; lastPingOk: boolean | null; lastPingAt: string | null }) {
  const processor = i.processor && i.processor !== 'none' ? i.processor : null;   // 'none' = no processor chosen
  const reservedFor = i.leaseHolder ? (i.leaseHolder.startsWith('ticket:') ? 'ticket' : i.leaseHolder.startsWith('display:') ? 'display' : 'other') : null;
  const verdict: TerminalRouteVerdict = i.op === 'DISABLED' || i.op === 'OFFLINE' || i.op === 'UNKNOWN' || i.op === 'DEGRADED' ? 'not_ready'
    : !i.registerPaired ? 'no_register' : !processor ? 'no_processor' : reservedFor || i.op === 'BUSY' || i.op === 'PROCESSING' ? 'busy' : 'ready';
  return { verdict, operational: i.op, registerPaired: i.registerPaired, reservedFor, reservedUntil: reservedFor ? i.leaseUntil : null,
    processor, environment: processor ? i.environment : null, lastPingOk: i.lastPingOk, lastPingAt: i.lastPingAt, movesMoney: false as const };
}
