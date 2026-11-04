// terminals-screen.repository.ts — Payment Terminals mandate (Oct 29 2026): the READ side of POS Devices → Payment Terminals
// (/tenant/devices/payment-terminals). One source of truth per number:
//   • Physical terminals = pos_payment_terminals of this salon, this location's rows AND the rows with no location (the
//     terminal-capture path charges those too — they used to be invisible in the list while counted nowhere). The status is
//     the ONE normalized status of @aipowersalon/api-contracts (terminalOperationalStatus: ping / last seen / live lease, a
//     15-minute freshness window) — never a raw provider state, never "Online" for a terminal that was never heard from.
//     The KPI counts and the list are computed from the SAME rows by the SAME function, so they cannot disagree.
//   • Tap to Pay iPhones = mobile_pay_devices (every state; revoked rows stay visible for the audit trail). Kept apart from
//     the physical counts. An Active registration is not "online" (last seen within 2 minutes is a separate fact).
//   • Payment Activity = card payments (payments → tickets → customers) with the capture device actually recorded on the
//     payment (payment_surface + device_id). A payment whose processor gave no device says "Not linked" — never a guess.
//   • Capture routing = tenant_settings 'payments-checkout'.customerDisplayCaptureMode (front_desk | terminal), the
//     register → terminal association, and the last change from settings_audit_logs.
// Every statement names tenant_id; the location comes from the session. Inventory lists are small (a salon has a handful
// of terminals and phones), so they are filtered / sorted / paged on the server over the WHOLE inventory; the activity list
// pages in SQL. Nothing here writes: the mutations stay on their audited, step-up routes (settings terminals, mobile-checkout
// devices, settings payments-checkout).
import { sql, type Kysely } from 'kysely';
import { terminalOperationalStatus, TERMINAL_FRESH_MS, type TerminalOperationalStatus } from '@aipowersalon/api-contracts';
import { hasPermission } from '@aipowersalon/permissions';
import { SURFACE_TAP_TO_PAY_IPHONE, TERMINAL_SURFACES, DEVICE_SURFACES, isTerminalSurface } from '../payments/payment-surfaces';
import {
  FinanceError, N, iso, isUuid, clampPage, resolvePeriod, salonTimeZone, tsInPeriod, digitsOf, likeOf, moneyToCents,
  type FinanceCtx, type PageReq, type Paged, type Period,
} from './finance-scope';

const INVENTORY_CAP = 2000;
const DEVICE_ONLINE_WINDOW_MS = 2 * 60_000;   // the mobile-checkout service's own window (a phone "online" = seen in 2 minutes)

export type AttentionReason = 'offline' | 'stale' | 'never_tested' | 'pairing_incomplete' | 'no_serial' | 'register_retired';
export type PhysicalGroup = 'online' | 'attention' | 'disabled' | 'in_use';

export interface PhysicalRow {
  id: string; label: string; model: string | null; provider: string | null; hsn: string | null; serialNumber: string | null; connectionType: string | null;
  branchId: string | null; branchName: string | null; stationId: string | null; registerName: string | null; paired: boolean; pairedAt: string | null;
  status: TerminalOperationalStatus; group: PhysicalGroup; attention: AttentionReason[]; lastSeenAt: string | null; lastPingAt: string | null; lastPingOk: boolean | null;
  lastTransactionAt: string | null; disabledAt: string | null; disabledReason: string | null; merchantAccountId: string | null; updatedAt: string | null;
}
export interface PhoneRow {
  deviceId: string; deviceRef: string; label: string | null; platform: string; osVersion: string | null; appVersion: string | null; status: string;
  staffId: string | null; staffName: string | null; staffPhone: string | null; branchId: string | null; branchName: string | null; allowedBranchIds: string[]; shared: boolean;
  tapToPayCapable: boolean; attestationStatus: string | null; pairedVia: string | null; online: boolean;
  createdAt: string | null; approvedAt: string | null; lastSeenAt: string | null; lastPaymentAt: string | null; lastErrorAt: string | null; lastErrorCode: string | null;
  revokedAt: string | null; revokeReason: string | null; payments: number;
}

const PHYSICAL_SORTS = ['created_desc', 'created_asc', 'name_asc', 'status', 'last_seen_desc'] as const;
const PHONE_SORTS = ['created_desc', 'created_asc', 'name_asc', 'status', 'last_seen_desc', 'last_payment_desc'] as const;
const ACTIVITY_SORTS = ['time_desc', 'time_asc', 'amount_desc', 'amount_asc'] as const;
export const PHYSICAL_GROUPS = ['online', 'attention', 'disabled', 'in_use'] as const;
export const PHONE_STATUSES = ['active', 'pending', 'disabled', 'revoked', 'compromised'] as const;
export const ACTIVITY_STATUSES = ['approved', 'declined', 'failed', 'pending', 'refunded', 'voided'] as const;
export const ACTIVITY_DEVICE_KINDS = ['terminal', 'iphone', 'unlinked'] as const;

const groupOf = (s: TerminalOperationalStatus): PhysicalGroup => (s === 'DISABLED' ? 'disabled' : s === 'ONLINE' ? 'online' : s === 'BUSY' || s === 'PROCESSING' ? 'in_use' : 'attention');
const STATUS_RANK: Record<TerminalOperationalStatus, number> = { OFFLINE: 0, DEGRADED: 1, UNKNOWN: 2, PROCESSING: 3, BUSY: 4, ONLINE: 5, DISABLED: 6 };
/** Payment rows map to one of six plain states (the processor's own word stays on the row as rawStatus). */
const ACTIVITY_STATUS_SQL = sql`case
  when p.status in ('approved', 'captured', 'settled', 'succeeded', 'paid', 'partial') then 'approved'
  when p.status in ('declined') then 'declined'
  when p.status in ('refunded', 'partially_refunded') then 'refunded'
  when p.status in ('voided', 'void', 'reversed') then 'voided'
  when p.status in ('processing', 'pending', 'authorized', 'needs_review') then 'pending'
  else 'failed' end`;
const sameText = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const has = (h: string | null | undefined, needle: string) => !!h && h.toLowerCase().includes(needle.toLowerCase());
/** A non-secret, shortened registration id for display (the full value is shown in the detail panel to authorized users). */
export const shortRef = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
/** a stored E.164 number as staff read it — (856) 555-1234 */
const showPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? null); };
const maskPhone = (p: string | null | undefined) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : null; };

export class TerminalsScreenRepository {
  constructor(private readonly db: Kysely<any>) {}

  async period(ctx: FinanceCtx, q: { preset?: unknown; from?: unknown; to?: unknown }): Promise<Period> {
    return resolvePeriod(q, await salonTimeZone(this.db, ctx.tenantId), { defaultPreset: 'month' });
  }

  // ── physical terminals ────────────────────────────────────────────────────────────────────────────────────────────
  /** Every terminal this location can see or charge (its own rows + rows with no location), with the normalized status. */
  async physicalInventory(ctx: FinanceCtx, now = new Date()): Promise<PhysicalRow[]> {
    const T = String(ctx.tenantId), B = ctx.branchId ? String(ctx.branchId) : null;
    const rows = (await sql<any>`select t.id, t.label, t.station_id, t.status, t.paired_at, t.hsn, t.provider, t.terminal_type, t.serial_number, t.connection_type, t.merchant_account_id,
          t.disabled_at, t.disabled_reason, t.last_seen_at, t.last_ping_at, t.last_ping_ok, t.last_transaction_at, t.updated_at, t.branch_id,
          (select l.holder from payment_terminal_leases l where l.tenant_id::text = t.tenant_id and l.terminal_id::text = t.id and l.expires_at > now() limit 1) as lease_holder,
          (select s.name from pos_stations s where s.tenant_id::text = t.tenant_id and s.id::text = t.station_id and s.retired_at is null limit 1) as register_name,
          (select b.name from branches b where b.tenant_id::text = t.tenant_id and b.id::text = t.branch_id limit 1) as branch_name
        from pos_payment_terminals t
        where t.tenant_id = ${T} ${B ? sql`and (t.branch_id = ${B} or t.branch_id is null)` : sql``}
        order by coalesce(t.paired_at, t.updated_at) desc nulls last, t.id desc limit ${INVENTORY_CAP}`.execute(this.db)).rows;
    return rows.map((r: any) => {
      const paired = String(r.status) === 'paired';
      const status = terminalOperationalStatus({ paired, disabledAt: r.disabled_at, lastSeenAt: r.last_seen_at, lastPingAt: r.last_ping_at, lastPingOk: r.last_ping_ok, leaseHolder: r.lease_holder ?? null }, now);
      const attention: AttentionReason[] = [];
      if (status !== 'DISABLED') {
        if (!paired) attention.push('pairing_incomplete');
        else if (status === 'OFFLINE') attention.push('offline');
        else if (status === 'DEGRADED') attention.push('stale');
        else if (status === 'UNKNOWN') attention.push('never_tested');
        if (paired && !r.hsn) attention.push('no_serial');
        if (r.station_id && !r.register_name) attention.push('register_retired');
      }
      const group = status === 'DISABLED' ? 'disabled' : attention.length ? 'attention' : groupOf(status);
      return {
        id: String(r.id), label: String(r.label ?? ''), model: r.terminal_type ?? null, provider: r.provider ?? null, hsn: r.hsn ?? null, serialNumber: r.serial_number ?? null, connectionType: r.connection_type ?? null,
        branchId: r.branch_id ?? null, branchName: r.branch_name ?? null, stationId: r.station_id ?? null, registerName: r.register_name ?? null, paired, pairedAt: iso(r.paired_at),
        status, group, attention, lastSeenAt: iso(r.last_seen_at), lastPingAt: iso(r.last_ping_at), lastPingOk: r.last_ping_ok == null ? null : !!r.last_ping_ok,
        lastTransactionAt: iso(r.last_transaction_at), disabledAt: iso(r.disabled_at), disabledReason: r.disabled_reason ?? null, merchantAccountId: r.merchant_account_id ?? null, updatedAt: iso(r.updated_at),
      } as PhysicalRow;
    });
  }

  async physicalList(ctx: FinanceCtx, f: { q: string; group?: PhysicalGroup; stationId?: string; provider?: string; sort: (typeof PHYSICAL_SORTS)[number] }, pr: PageReq): Promise<Paged<PhysicalRow & { matchedBy: string | null }>> {
    const all = await this.physicalInventory(ctx);
    const q = f.q;
    const scored = all.map((t) => {
      if (!q) return { t, rank: 0, by: null as string | null };
      if (sameText(t.id, q) || sameText(t.hsn, q) || sameText(t.serialNumber, q)) return { t, rank: 3, by: 'identifier' };
      if (sameText(t.label, q)) return { t, rank: 2, by: 'name' };
      if (has(t.label, q)) return { t, rank: 1, by: 'name' };
      if (has(t.id, q) || has(t.hsn, q) || has(t.serialNumber, q)) return { t, rank: 1, by: 'identifier' };
      if (has(t.registerName, q)) return { t, rank: 1, by: 'register' };
      if (has(t.model, q) || has(t.provider, q) || has(t.branchName, q)) return { t, rank: 1, by: 'model' };
      if (has(t.status, q) || has(t.group, q)) return { t, rank: 1, by: 'status' };
      return { t, rank: -1, by: null };
    }).filter((x) => x.rank >= 0)
      .filter((x) => !f.group || x.t.group === f.group)
      .filter((x) => !f.stationId || (f.stationId === 'none' ? !x.t.stationId : x.t.stationId === f.stationId))
      // Payment Terminals guide (Nov 4 2026) §17 "provider" filter: the processor the terminal was paired to ('none' = not linked)
      .filter((x) => !f.provider || (f.provider === 'none' ? !x.t.provider : sameText(x.t.provider, f.provider)));
    const created = (t: PhysicalRow) => Date.parse(t.pairedAt ?? t.updatedAt ?? '') || 0;
    const cmp: Record<string, (a: PhysicalRow, b: PhysicalRow) => number> = {
      created_desc: (a, b) => created(b) - created(a) || b.id.localeCompare(a.id),
      created_asc: (a, b) => created(a) - created(b) || a.id.localeCompare(b.id),
      name_asc: (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
      status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.id.localeCompare(a.id),
      last_seen_desc: (a, b) => (Date.parse(b.lastSeenAt ?? '') || 0) - (Date.parse(a.lastSeenAt ?? '') || 0) || b.id.localeCompare(a.id),
    };
    scored.sort((a, b) => (q ? b.rank - a.rank : 0) || cmp[f.sort](a.t, b.t));
    const pg = clampPage(pr, scored.length);
    return { items: scored.slice(pg.offset, pg.offset + pg.pageSize).map((x) => ({ ...x.t, matchedBy: x.by })), total: scored.length, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  async physicalDetail(ctx: FinanceCtx, id: string) {
    const t = (await this.physicalInventory(ctx)).find((x) => x.id === id);
    if (!t) throw new FinanceError('That terminal could not be found.', 'TERMINAL_NOT_FOUND', 404);
    const T = String(ctx.tenantId);
    const history = (await sql<any>`select a.action_type, a.created_at, a.role, coalesce(u.full_name, u.email) as actor, a.after_json, a.metadata
        from settings_audit_logs a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        where a.tenant_id::text = ${T} and a.entity_id = ${id} order by a.created_at desc limit 25`.execute(this.db)).rows
      .map((r: any) => ({ action: String(r.action_type), at: iso(r.created_at), role: r.role ?? null, actor: r.actor ?? null }));
    const payments = (await sql<any>`select p.id, p.amount_cents, p.status, p.created_at, t.ticket_number from payments p
        join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        where p.tenant_id::text = ${T} and p.payment_surface in (${sql.join(TERMINAL_SURFACES.map((v) => sql`${v}`))}) and p.device_id = ${id} order by p.created_at desc, p.id desc limit 5`.execute(this.db)).rows
      .map((r: any) => ({ paymentId: String(r.id), amountCents: N(r.amount_cents), status: String(r.status), at: iso(r.created_at), ticketNumber: r.ticket_number ?? null }));
    return { terminal: t, history, recentPayments: payments, freshnessMinutes: TERMINAL_FRESH_MS / 60_000,
      source: { status: 'last ping / last transaction recorded by the server', lease: 'payment_terminal_leases', firmware: null as string | null } };
  }

  // ── Tap to Pay iPhones ─────────────────────────────────────────────────────────────────────────────────────────────
  async phoneInventory(ctx: FinanceCtx, now = new Date()): Promise<PhoneRow[]> {
    const T = ctx.tenantId;
    // Nov 4 2026 (live IDOR run): the same rule as the physical terminals — a location sees its own phones, phones allowed at it
    // and phones with no location; a location-2 manager read location 1's phone by its id
    const B = ctx.branchId && /^[0-9a-f-]{36}$/i.test(String(ctx.branchId)) ? String(ctx.branchId) : null;
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.devices.manage');
    const rows = (await sql<any>`select d.device_id, d.label, d.platform, d.os_version, d.app_version, d.status, d.bound_user_id, d.branch_id, d.tap_to_pay_capable, d.attestation_status, d.paired_via, d.shared,
          d.created_at, d.approved_at, d.last_seen_at, d.last_payment_at, d.last_error_at, d.last_error_code, d.revoked_at, d.revoke_reason,
          coalesce(u.full_name, u.email) as staff_name, u.normalized_phone as staff_phone, b.name as branch_name,
          coalesce((select array_agg(x.branch_id::text order by x.branch_id) from mobile_pay_device_branches x where x.tenant_id = d.tenant_id and x.device_id = d.device_id), '{}') as allowed_branch_ids,
          (select count(*)::int from payments p where p.tenant_id = d.tenant_id and p.payment_surface = ${SURFACE_TAP_TO_PAY_IPHONE} and p.device_id = d.device_id) as payments
        from mobile_pay_devices d
        left join users u on u.id = d.bound_user_id and u.tenant_id = d.tenant_id
        left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id
        where d.tenant_id = ${T}
          ${B ? sql`and (d.branch_id is null or d.branch_id = ${B}::uuid or exists (select 1 from mobile_pay_device_branches x where x.tenant_id = d.tenant_id and x.device_id = d.device_id and x.branch_id = ${B}::uuid))` : sql``}
        order by d.created_at desc, d.device_id desc limit ${INVENTORY_CAP}`.execute(this.db)).rows;
    return rows.map((r: any) => ({
      deviceId: String(r.device_id), deviceRef: shortRef(String(r.device_id)), label: r.label ?? null, platform: String(r.platform ?? 'unknown'), osVersion: r.os_version ?? null, appVersion: r.app_version ?? null,
      status: String(r.status), staffId: r.bound_user_id ? String(r.bound_user_id) : null, staffName: r.staff_name ?? null,
      staffPhone: canContact ? showPhone(r.staff_phone) : maskPhone(r.staff_phone), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null,
      allowedBranchIds: Array.isArray(r.allowed_branch_ids) ? r.allowed_branch_ids.map(String) : [], shared: !!r.shared,
      tapToPayCapable: !!r.tap_to_pay_capable, attestationStatus: r.attestation_status ?? null, pairedVia: r.paired_via ?? null,
      online: String(r.status) === 'active' && !!r.last_seen_at && now.getTime() - Date.parse(String(iso(r.last_seen_at))) <= DEVICE_ONLINE_WINDOW_MS,
      createdAt: iso(r.created_at), approvedAt: iso(r.approved_at), lastSeenAt: iso(r.last_seen_at), lastPaymentAt: iso(r.last_payment_at),
      lastErrorAt: iso(r.last_error_at), lastErrorCode: r.last_error_code ?? null, revokedAt: iso(r.revoked_at), revokeReason: r.revoke_reason ?? null, payments: N(r.payments),
    }));
  }

  async phoneList(ctx: FinanceCtx, f: { q: string; status?: (typeof PHONE_STATUSES)[number]; sort: (typeof PHONE_SORTS)[number] }, pr: PageReq): Promise<Paged<PhoneRow & { matchedBy: string | null }>> {
    const all = await this.phoneInventory(ctx);
    const q = f.q, qd = digitsOf(q);
    const scored = all.map((d) => {
      if (!q) return { d, rank: 0, by: null as string | null };
      if (sameText(d.deviceId, q)) return { d, rank: 3, by: 'identifier' };
      if (sameText(d.label, q) || sameText(d.staffName, q)) return { d, rank: 2, by: sameText(d.label, q) ? 'name' : 'staff' };
      if (has(d.label, q)) return { d, rank: 1, by: 'name' };
      if (has(d.deviceId, q)) return { d, rank: 1, by: 'identifier' };
      if (has(d.staffName, q)) return { d, rank: 1, by: 'staff' };
      if (qd.length >= 4 && d.staffPhone && digitsOf(d.staffPhone).replace(/^1(?=\d{10}$)/, '').includes(qd.replace(/^1(?=\d{10}$)/, ''))) return { d, rank: 1, by: 'staff_phone' };
      if (has(d.branchName, q) || has(d.status, q) || has(d.platform, q)) return { d, rank: 1, by: 'status' };
      return { d, rank: -1, by: null };
    }).filter((x) => x.rank >= 0).filter((x) => !f.status || x.d.status === f.status);
    const t = (s: string | null) => Date.parse(s ?? '') || 0;
    const RANK: Record<string, number> = { active: 0, pending: 1, disabled: 2, compromised: 3, revoked: 4 };
    const cmp: Record<string, (a: PhoneRow, b: PhoneRow) => number> = {
      created_desc: (a, b) => t(b.createdAt) - t(a.createdAt) || b.deviceId.localeCompare(a.deviceId),
      created_asc: (a, b) => t(a.createdAt) - t(b.createdAt) || a.deviceId.localeCompare(b.deviceId),
      name_asc: (a, b) => (a.label ?? a.deviceId).localeCompare(b.label ?? b.deviceId) || a.deviceId.localeCompare(b.deviceId),
      status: (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || t(b.createdAt) - t(a.createdAt),
      last_seen_desc: (a, b) => t(b.lastSeenAt) - t(a.lastSeenAt) || b.deviceId.localeCompare(a.deviceId),
      last_payment_desc: (a, b) => t(b.lastPaymentAt) - t(a.lastPaymentAt) || b.deviceId.localeCompare(a.deviceId),
    };
    scored.sort((a, b) => (q ? b.rank - a.rank : 0) || cmp[f.sort](a.d, b.d));
    const pg = clampPage(pr, scored.length);
    return { items: scored.slice(pg.offset, pg.offset + pg.pageSize).map((x) => ({ ...x.d, matchedBy: x.by })), total: scored.length, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount };
  }

  async phoneDetail(ctx: FinanceCtx, deviceId: string) {
    const d = (await this.phoneInventory(ctx)).find((x) => x.deviceId === deviceId);
    if (!d) throw new FinanceError('That device could not be found.', 'DEVICE_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const history = (await sql<any>`select a.action_type, a.created_at, a.role, coalesce(u.full_name, u.email) as actor from audit_logs a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.entity_id = ${deviceId} order by a.created_at desc limit 25`.execute(this.db)).rows
      .map((r: any) => ({ action: String(r.action_type), at: iso(r.created_at), role: r.role ?? null, actor: r.actor ?? null }));
    const payments = (await sql<any>`select p.id, p.amount_cents, p.status, p.created_at, t.ticket_number from payments p join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
        where p.tenant_id = ${T} and p.payment_surface = ${SURFACE_TAP_TO_PAY_IPHONE} and p.device_id = ${deviceId} order by p.created_at desc, p.id desc limit 5`.execute(this.db)).rows
      .map((r: any) => ({ paymentId: String(r.id), amountCents: N(r.amount_cents), status: String(r.status), at: iso(r.created_at), ticketNumber: r.ticket_number ?? null }));
    return { device: { ...d, deviceIdFull: d.deviceId }, history, recentPayments: payments };
  }

  // ── KPIs (live inventory — never redefined by an activity date range) ───────────────────────────────────────────
  async summary(ctx: FinanceCtx) {
    const [phys, phones] = await Promise.all([this.physicalInventory(ctx), this.phoneInventory(ctx)]);
    const reasons: Record<AttentionReason, number> = { offline: 0, stale: 0, never_tested: 0, pairing_incomplete: 0, no_serial: 0, register_retired: 0 };
    for (const t of phys) for (const r of t.attention) reasons[r] += 1;
    const by = (s: string) => phones.filter((p) => p.status === s).length;
    const activeBranch = phones.filter((p) => p.status === 'active' && (!ctx.branchId || !p.branchId || p.branchId === ctx.branchId || p.allowedBranchIds.includes(String(ctx.branchId))));
    return {
      physical: { total: phys.length, online: phys.filter((t) => t.group === 'online' || t.group === 'in_use').length, needsAttention: phys.filter((t) => t.group === 'attention').length,
        disabled: phys.filter((t) => t.group === 'disabled').length, inUse: phys.filter((t) => t.group === 'in_use').length, reasons, freshnessMinutes: TERMINAL_FRESH_MS / 60_000 },
      tapToPay: { total: phones.length, active: by('active'), pending: by('pending'), disabled: by('disabled'), revoked: by('revoked'), compromised: by('compromised'),
        seenRecently: phones.filter((p) => p.online).length, activeHere: activeBranch.length },
      asOf: new Date().toISOString(),
    };
  }

  // ── Payment Activity (payment → ticket → capture device → optional customer) ────────────────────────────────────
  private activityBase(T: string, B: string | null = null) {
    return sql`select p.id, p.ticket_id, p.method, p.amount_cents, p.tip_cents, p.status as raw_status, ${ACTIVITY_STATUS_SQL} as status, p.created_at, p.processor_transaction_id,
        p.payment_surface, p.device_id, p.card_brand, p.card_last4, p.branch_id,
        t.ticket_number, t.customer_id, t.checkout_register_id,
        c.full_name as customer_name, c.normalized_phone as customer_phone, c.email as customer_email,
        s.name as register_name, b.name as branch_name,
        pt.label as terminal_label, md.label as phone_label, coalesce(mu.full_name, mu.email) as phone_staff
      from payments p
      join tickets t on t.id = p.ticket_id and t.tenant_id = p.tenant_id
      left join customers c on c.id = t.customer_id and c.tenant_id = p.tenant_id
      left join pos_stations s on s.id = t.checkout_register_id and s.tenant_id = p.tenant_id
      left join branches b on b.id = p.branch_id and b.tenant_id = p.tenant_id
      left join pos_payment_terminals pt on p.payment_surface in (${sql.join(TERMINAL_SURFACES.map((v) => sql`${v}`))}) and pt.tenant_id = p.tenant_id::text and pt.id = p.device_id
      left join mobile_pay_devices md on p.payment_surface = ${SURFACE_TAP_TO_PAY_IPHONE} and md.tenant_id = p.tenant_id and md.device_id = p.device_id
      left join users mu on mu.id = md.bound_user_id and mu.tenant_id = p.tenant_id
      where p.tenant_id = ${T} and (p.method = 'card' or p.payment_surface in (${sql.join(DEVICE_SURFACES.map((v) => sql`${v}`))}))
        ${B ? sql`and p.branch_id = ${B}::uuid` : sql``}`;   // Payment Terminals guide audit (Nov 4 2026): a location sees its own payments only
  }
  private activitySearch(q: string) {
    const ors: ReturnType<typeof sql>[] = [];
    const lower = q.toLowerCase(), d = digitsOf(q).replace(/^1(?=\d{10}$)/, '');
    ors.push(sql`lower(coalesce(a.processor_transaction_id, '')) = ${lower}`, sql`a.id::text = ${lower}`);
    ors.push(sql`lower(coalesce(a.ticket_number, '')) = ${lower.replace(/^#/, '')}`);
    if (q.length >= 2) ors.push(sql`lower(coalesce(a.customer_name, '')) like ${likeOf(lower)}`, sql`lower(coalesce(a.customer_email, '')) = ${lower}`,
      sql`lower(coalesce(a.terminal_label, a.phone_label, '')) like ${likeOf(lower)}`, sql`lower(coalesce(a.phone_staff, '')) like ${likeOf(lower)}`, sql`lower(coalesce(a.register_name, '')) like ${likeOf(lower)}`);
    if (d.length >= 4) ors.push(sql`right(regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g'), ${Math.min(d.length, 10)}) = ${d.slice(-10)}`);
    if (/^\d{4}$/.test(q)) ors.push(sql`a.card_last4 = ${q}`);
    const cents = moneyToCents(q);
    if (cents != null && /[.$]/.test(q)) ors.push(sql`a.amount_cents = ${cents}`);
    return sql<boolean>`(${sql.join(ors, sql` or `)})`;
  }
  async activityList(ctx: FinanceCtx, f: { period: Period; q: string; status?: string; device?: string; deviceId?: string; sort: (typeof ACTIVITY_SORTS)[number] }, pr: PageReq) {
    const T = ctx.tenantId; const B = ctx.branchId && /^[0-9a-f-]{36}$/i.test(String(ctx.branchId)) ? String(ctx.branchId) : null;
    const parts = [tsInPeriod(sql`a.created_at`, f.period)];
    if (f.q) parts.push(this.activitySearch(f.q));
    if (f.status) parts.push(sql`a.status = ${f.status}`);
    if (f.device === 'terminal') parts.push(sql`a.payment_surface in (${sql.join(TERMINAL_SURFACES.map((v) => sql`${v}`))})`);
    if (f.device === 'iphone') parts.push(sql`a.payment_surface = ${SURFACE_TAP_TO_PAY_IPHONE}`);
    if (f.device === 'unlinked') parts.push(sql`(a.device_id is null or a.payment_surface is null or a.payment_surface not in (${sql.join(DEVICE_SURFACES.map((v) => sql`${v}`))}))`);
    if (f.deviceId) parts.push(sql`a.device_id = ${f.deviceId}`);
    const where = sql.join(parts, sql` and `);
    const order = { time_desc: sql`a.created_at desc, a.id desc`, time_asc: sql`a.created_at asc, a.id asc`, amount_desc: sql`a.amount_cents desc, a.created_at desc, a.id desc`, amount_asc: sql`a.amount_cents asc, a.created_at desc, a.id desc` }[f.sort];
    const total = N((await sql<any>`select count(*)::int as n from (${this.activityBase(T, B)}) a where ${where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`select a.* from (${this.activityBase(T, B)}) a where ${where} order by ${order} limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    const canContact = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    return {
      items: rows.map((r: any) => {
        const kind = r.payment_surface === SURFACE_TAP_TO_PAY_IPHONE ? 'iphone' : isTerminalSurface(r.payment_surface) ? 'terminal' : 'unlinked';
        return {
          paymentId: String(r.id), ticketId: String(r.ticket_id), ticketNumber: r.ticket_number ?? null, processorRef: r.processor_transaction_id ?? null,
          amountCents: N(r.amount_cents), tipCents: N(r.tip_cents), status: String(r.status), rawStatus: String(r.raw_status), at: iso(r.created_at),
          card: r.card_last4 ? `${r.card_brand ?? 'Card'} ••${r.card_last4}` : null,
          device: kind === 'unlinked' || !r.device_id ? { kind: 'unlinked' as const, id: null, label: null, staff: null }
            : { kind, id: String(r.device_id), label: (kind === 'iphone' ? r.phone_label : r.terminal_label) ?? (kind === 'iphone' ? shortRef(String(r.device_id)) : String(r.device_id)), staff: kind === 'iphone' ? r.phone_staff ?? null : null },
          register: r.register_name ?? null, branch: r.branch_name ?? null,
          customer: r.customer_id ? { id: String(r.customer_id), name: r.customer_name ?? null, phone: canContact ? showPhone(r.customer_phone) : maskPhone(r.customer_phone) } : null,
        };
      }),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount,
    };
  }

  // ── Device Audit History (Payment Terminals guide Nov 4 2026 §16 / §17): every pairing, register, test, rename, disable /
  //    enable, unpair of this location's terminals and every Tap to Pay registration / approval / suspension / revocation,
  //    newest first, with its own date range and page — revoked and unpaired devices stay in the history ──
  async auditHistory(ctx: FinanceCtx, f: { period: Period; kind?: 'terminal' | 'iphone'; deviceId?: string; q: string }, pr: PageReq) {
    const T = ctx.tenantId, B = ctx.branchId && isUuid(ctx.branchId) ? ctx.branchId : null;
    const base = sql`
      select a.id::text as id, 'terminal' as kind, a.entity_id as device_id, a.action_type as action, a.created_at, a.role, coalesce(u.full_name, u.email) as actor,
             t.label as device_label, coalesce(a.after_json, '{}'::jsonb) as detail
        from settings_audit_logs a
        left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        left join pos_payment_terminals t on t.tenant_id::text = a.tenant_id::text and t.id = a.entity_id
       where a.tenant_id = ${T} and a.action_type like 'pos_settings_terminal%' ${B ? sql`and (a.branch_id = ${B}::uuid or a.branch_id is null)` : sql``}
      union all
      select a.id::text as id, 'iphone' as kind, a.entity_id as device_id, a.action_type as action, a.created_at, a.role, coalesce(u.full_name, u.email) as actor,
             d.label as device_label, coalesce(a.metadata_json, '{}'::jsonb) as detail
        from audit_logs a
        left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        join mobile_pay_devices d on d.tenant_id = a.tenant_id and d.device_id = a.entity_id
       where a.tenant_id = ${T} and a.action_type like 'mobile_pay_device%'`;
    const parts = [tsInPeriod(sql`h.created_at`, f.period)];
    if (f.kind) parts.push(sql`h.kind = ${f.kind}`);
    if (f.deviceId) parts.push(sql`h.device_id = ${f.deviceId}`);
    if (f.q) parts.push(sql`(coalesce(h.device_label, '') ilike ${likeOf(f.q)} or h.device_id ilike ${likeOf(f.q)} or coalesce(h.actor, '') ilike ${likeOf(f.q)} or h.action ilike ${likeOf(f.q)})`);
    const where = sql.join(parts, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from (${base}) h where ${where}`.execute(this.db)).rows[0]?.n);
    const pg = clampPage(pr, total);
    const rows = (await sql<any>`select h.* from (${base}) h where ${where} order by h.created_at desc, h.id desc limit ${pg.pageSize} offset ${pg.offset}`.execute(this.db)).rows;
    const SAFE = ['reachable', 'stationId', 'reason', 'disabled', 'label', 'provider', 'atPairing', 'status', 'from', 'to'];
    return {
      items: rows.map((r: any) => ({
        id: String(r.id), kind: r.kind as 'terminal' | 'iphone', deviceId: String(r.device_id), deviceLabel: r.device_label ?? (r.kind === 'iphone' ? shortRef(String(r.device_id)) : String(r.device_id)),
        action: String(r.action), at: iso(r.created_at), actor: r.actor ?? null, role: r.role ?? null,
        // only plain, non-secret facts of the change (a key, token or phone never leaves)
        detail: Object.fromEntries(Object.entries(r.detail && typeof r.detail === 'object' ? r.detail : {}).filter(([k, v]) => SAFE.includes(k) && (typeof v !== 'object' || v === null))),
      })),
      total, page: pg.page, pageSize: pg.pageSize, pageCount: pg.pageCount, period: f.period, dateBasis: 'audit_event' as const,
    };
  }

  // ── capture routing ───────────────────────────────────────────────────────────────────────────────────────────────
  async routing(ctx: FinanceCtx) {
    const T = ctx.tenantId, B = ctx.branchId && isUuid(ctx.branchId) ? ctx.branchId : null;
    const rows = (await sql<any>`select branch_id, settings_json, updated_at from tenant_settings where tenant_id = ${T} and category = 'payments-checkout'
        and (branch_id is null ${B ? sql`or branch_id = ${B}::uuid` : sql``})`.execute(this.db)).rows;
    const row = (B ? rows.find((r: any) => r.branch_id && String(r.branch_id) === B) : undefined) ?? rows.find((r: any) => r.branch_id == null);
    const j = row?.settings_json && typeof row.settings_json === 'object' ? row.settings_json : {};
    const mode: 'front_desk' | 'terminal' = j.customerDisplayCaptureMode === 'terminal' ? 'terminal' : 'front_desk';
    const last = (await sql<any>`select a.created_at, a.role, coalesce(u.full_name, u.email) as actor, a.before_json->>'customerDisplayCaptureMode' as before_mode, a.after_json->>'customerDisplayCaptureMode' as after_mode
        from settings_audit_logs a left join users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        where a.tenant_id = ${T} and a.entity_id = 'payments-checkout'
          -- the last change to the setting THIS location follows: its own row, else the salon's (not another location's own row)
          and ${row?.branch_id
            ? sql`a.branch_id = ${row.branch_id}::uuid`
            : sql`(a.branch_id is null or a.branch_id not in (select x.branch_id from tenant_settings x where x.tenant_id = ${T} and x.category = 'payments-checkout' and x.branch_id is not null))`}
          and coalesce(a.before_json->>'customerDisplayCaptureMode', 'front_desk') is distinct from coalesce(a.after_json->>'customerDisplayCaptureMode', 'front_desk')
        order by a.created_at desc limit 1`.execute(this.db)).rows[0];
    const stations = (await sql<any>`select s.id, s.name from pos_stations s where s.tenant_id = ${T} ${B ? sql`and s.branch_id = ${B}::uuid` : sql``} and s.retired_at is null order by s.name`.execute(this.db)).rows;
    const terms = await this.physicalInventory(ctx);
    const active = terms.filter((t) => t.status !== 'DISABLED' && t.paired);
    const registers = stations.map((s: any) => {
      const own = active.filter((t) => t.stationId === String(s.id));
      // the same selection the charge makes (terminal-capture): the register's own terminal, else the location's only one
      const routed = own[0] ?? (active.length === 1 ? active[0] : null);
      return { id: String(s.id), name: String(s.name), terminals: own.map((t) => ({ id: t.id, label: t.label, status: t.status })),
        routedTerminal: routed ? { id: routed.id, label: routed.label, status: routed.status, via: own[0] ? 'assigned' : 'only_terminal' } : null,
        problem: own.length > 1 ? 'several_terminals' : !routed ? (active.length === 0 ? 'no_terminal' : 'not_assigned') : routed.group === 'attention' ? 'terminal_needs_attention' : null };
    });
    const canEdit = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'settings.edit');   // the PATCH route's own permission
    return {
      mode, scope: row?.branch_id ? 'location' : 'salon', updatedAt: iso(row?.updated_at),
      lastChange: last ? { at: iso(last.created_at), actor: last.actor ?? null, role: last.role ?? null, from: last.before_mode ?? 'front_desk', to: last.after_mode ?? 'front_desk' } : null,
      registers, unassignedTerminals: active.filter((t) => !t.stationId).map((t) => ({ id: t.id, label: t.label, status: t.status })),
      canEdit,
    };
  }
}

export const TERMINAL_LIST_SORTS = { physical: PHYSICAL_SORTS, phones: PHONE_SORTS, activity: ACTIVITY_SORTS };
