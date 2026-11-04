// setup-health-checks.ts — Four-Module Completion Guide (Oct 30 2026) §13–§14: the readiness checks behind Setup Health and
// the nightly verifier. Each check reads the AUTHORITATIVE record the owning module writes (never a config field alone) and
// returns a status from the guide's vocabulary with its provenance:
//   ready             verified evidence inside its freshness window
//   warning           works, partially degraded or ageing
//   action_required   the salon must do something (missing setup, failed check, past due)
//   pending_external  waiting on someone outside the salon (carrier review, CI / staging / device evidence)
//   unknown           not verified (no check yet, stale check, provider unreachable)
//   disabled          intentionally off
//   error             a job / system failure that needs an administrator
// A check never turns green because a field is filled in: "configured" is not "verified".
// Detail objects carry codes and counts only — never a credential, phone number, customer or employee.
import { sql, type Kysely } from 'kysely';

export type HealthStatus = 'ready' | 'warning' | 'action_required' | 'pending_external' | 'unknown' | 'disabled' | 'error';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export const AREAS = ['twilio', 'registration', 'sms_transport', 'booking', 'branch_settings', 'ai', 'jobs', 'release'] as const;
export type Area = (typeof AREAS)[number];
export interface CheckResult {
  key: string; area: Area; branchId: string | null; status: HealthStatus; severity: Severity; source: string;
  verifiedAt: string | null; expiresAt: string | null; detail: Record<string, unknown>; action: { code: string; route: string } | null;
}
export interface CheckCtx { tenantId: string; branchId: string | null; branchIds: string[]; now: Date; appVersion: string; env: Record<string, string | undefined> }

const H = 3600 * 1000, D = 24 * H;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());
const age = (v: unknown, now: Date) => (v == null ? Infinity : now.getTime() - new Date(v as string | Date).getTime());
const N = (v: unknown) => Number(v ?? 0) || 0;
export const FRESHNESS = { providerCheck: D, registration: 72 * H,   // PM-03: "Approved" needs a provider confirmation under 72 h old
  webhook: 30 * D, dataAccuracy: 36 * H, snapshot: 36 * H, reconciliation: 36 * H, stalledQueue: H } as const;
const R = (key: string, area: Area, status: HealthStatus, severity: Severity, source: string, o: Partial<CheckResult> = {}): CheckResult =>
  ({ key, area, branchId: o.branchId ?? null, status, severity, source, verifiedAt: o.verifiedAt ?? null, expiresAt: o.expiresAt ?? null, detail: o.detail ?? {}, action: o.action ?? null });
const ROUTES = { setup: '/tenant/communications/messaging-setup', phone: '/tenant/communications/phone', registration: '/tenant/communications/messaging-setup#registration',
  diagnostics: '/tenant/communications/phone#diagnostics', booking: '/tenant/communications/booking-phone-verification', ai: '/tenant/ai/usage', team: '/tenant/team/members',
  retention: '/tenant/customers/retention', health: '/tenant/management/setup-health', billing: '/tenant/account/subscription' } as const;

async function exists(db: Kysely<any>, table: string): Promise<boolean> {
  return !!(await sql<any>`select to_regclass(${'public.' + table}) is not null as ok`.execute(db)).rows[0]?.ok;
}

// ── Twilio account + sender (tenant_messaging_health_checks: the authenticated provider check, migration 721) ────────────
export async function twilioChecks(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const scope = c.branchId;
  const cred = (await sql<any>`select count(*)::int as n from tenant_messaging_credentials where tenant_id = ${c.tenantId} and offboarded_at is null
    and (${scope}::uuid is null and branch_id is null or branch_id = ${scope}::uuid)`.execute(db)).rows[0];
  const chk = (await sql<any>`select account_state, account_reason_code, sender_state, verify_state, checked_at from tenant_messaging_health_checks
    where tenant_id = ${c.tenantId} and (branch_id is not distinct from ${scope}::uuid) order by checked_at desc limit 1`.execute(db)).rows[0];
  const lastGood = (await sql<any>`select max(checked_at) as at from tenant_messaging_health_checks where tenant_id = ${c.tenantId} and (branch_id is not distinct from ${scope}::uuid)
    and account_state = 'connected'`.execute(db)).rows[0]?.at;
  const fresh = chk && age(chk.checked_at, c.now) <= FRESHNESS.providerCheck;
  const exp = chk ? new Date(new Date(chk.checked_at).getTime() + FRESHNESS.providerCheck).toISOString() : null;
  const src = 'tenant_messaging_health_checks';
  const out: CheckResult[] = [];
  if (!N(cred?.n) && !chk) {
    out.push(R('twilio.account', 'twilio', scope ? 'disabled' : 'action_required', scope ? 'info' : 'high', 'tenant_messaging_credentials',
      { branchId: scope, detail: { code: scope ? 'inherits_tenant_default' : 'not_connected' }, action: scope ? null : { code: 'open_messaging_setup', route: ROUTES.setup } }));
    return out;
  }
  if (!chk) out.push(R('twilio.account', 'twilio', 'unknown', 'medium', src, { branchId: scope, detail: { code: 'never_checked' }, action: { code: 'run_health_check', route: ROUTES.phone } }));
  else if (chk.account_state !== 'connected') out.push(R('twilio.account', 'twilio', chk.account_state === 'unreachable' || chk.account_state === 'error' ? 'unknown' : 'action_required', 'high', src,
    { branchId: scope, verifiedAt: iso(chk.checked_at), detail: { code: chk.account_reason_code ?? chk.account_state, lastGoodAt: iso(lastGood) }, action: { code: 'open_messaging_setup', route: ROUTES.setup } }));
  else out.push(R('twilio.account', 'twilio', fresh ? 'ready' : 'unknown', fresh ? 'info' : 'medium', src,
    { branchId: scope, verifiedAt: iso(chk.checked_at), expiresAt: exp, detail: { code: fresh ? 'connected' : 'stale', lastGoodAt: iso(lastGood) }, action: fresh ? null : { code: 'run_health_check', route: ROUTES.phone } }));
  if (chk) out.push(R('twilio.sender', 'twilio', chk.sender_state === 'assigned' ? (fresh ? 'ready' : 'unknown') : 'action_required', chk.sender_state === 'assigned' ? (fresh ? 'info' : 'medium') : 'high', src,
    { branchId: scope, verifiedAt: iso(chk.checked_at), expiresAt: exp, detail: { code: chk.sender_state ?? 'unknown' }, action: chk.sender_state === 'assigned' && fresh ? null : { code: 'open_messaging_setup', route: ROUTES.setup } }));
  return out;
}

// ── carrier registration (10DLC / toll-free). A stored "submitted" is never approval. ─────────────────────────────────────
const APPROVED = new Set(['APPROVED', 'VERIFIED', 'TWILIO_APPROVED', 'approved', 'verified', 'registered']);
const REJECTED = new Set(['FAILED', 'REJECTED', 'SUSPENDED', 'TWILIO_REJECTED', 'failed', 'rejected', 'suspended']);
async function registration(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  // the provider-verified snapshot (PM-03) when that module records one; else the stored Super Admin submission
  // PM-03 / PM-04 (migration 725): one append-only snapshot per item kind per read. Latest per kind; not_applicable kinds
  // (e.g. 10DLC items for a toll-free sender) are ignored. Approved counts only when Twilio confirmed it (verified) recently.
  const snaps = (await exists(db, 'tenant_messaging_registration_snapshots'))
    ? (await sql<any>`select distinct on (s.item_kind) s.item_kind, s.normalized_state, s.verified, s.source, s.error_class, s.checked_at, s.last_success_at
        from tenant_messaging_registration_snapshots s where s.tenant_id = ${c.tenantId} order by s.item_kind, s.checked_at desc`.execute(db)).rows.filter((r: any) => r.normalized_state !== 'not_applicable') : [];
  const reg = (await sql<any>`select brand_status, campaign_status, status, updated_at from tenant_a2p_registrations where tenant_id = ${c.tenantId} order by updated_at desc nulls last limit 1`.execute(db)).rows[0];
  if (snaps.length) {
    const states = snaps.map((r: any) => String(r.normalized_state));
    const ok = (r: any) => r.normalized_state === 'approved' && r.verified && r.source === 'provider' && age(r.last_success_at ?? r.checked_at, c.now) <= FRESHNESS.registration;
    const oldest = snaps.map((r: any) => r.last_success_at).filter(Boolean).map((v: any) => new Date(v).getTime()).sort((a: number, b: number) => a - b)[0];
    const status: HealthStatus = states.some((x: string) => x === 'rejected' || x === 'suspended') ? 'action_required'
      : snaps.every(ok) ? 'ready'
      : states.some((x: string) => x === 'not_started') ? 'action_required'
      : states.some((x: string) => x === 'pending') ? 'pending_external' : 'unknown';
    const code = status === 'ready' ? 'provider_approved' : status === 'action_required' ? (states.includes('not_started') && !states.some((x: string) => x === 'rejected' || x === 'suspended') ? 'not_started' : 'rejected')
      : status === 'pending_external' ? 'in_review' : 'not_provider_verified';
    return [R('registration.carrier', 'registration', status, status === 'action_required' ? 'high' : status === 'ready' ? 'info' : 'medium', 'tenant_messaging_registration_snapshots',
      { verifiedAt: oldest ? new Date(oldest).toISOString() : null, expiresAt: oldest ? new Date(oldest + FRESHNESS.registration).toISOString() : null,
        detail: { code, items: Object.fromEntries(snaps.map((r: any) => [String(r.item_kind), `${r.normalized_state}${r.verified ? '' : ':unverified'}`])) },
        action: status === 'ready' ? null : { code: status === 'unknown' ? 'refresh_registration' : 'open_registration', route: ROUTES.registration } })];
  }
  if (!reg) return [R('registration.carrier', 'registration', 'action_required', 'high', 'tenant_a2p_registrations', { detail: { code: 'not_started' }, action: { code: 'open_registration', route: ROUTES.registration } })];
  const b = String(reg.brand_status ?? ''), cp = String(reg.campaign_status ?? '');
  if (REJECTED.has(b) || REJECTED.has(cp)) return [R('registration.carrier', 'registration', 'action_required', 'high', 'tenant_a2p_registrations', { detail: { code: 'rejected', brand: b, campaign: cp }, action: { code: 'open_registration', route: ROUTES.registration } })];
  // approved in the stored record but not re-verified with the provider → Unknown (never green from a submission record)
  if (APPROVED.has(b) && APPROVED.has(cp)) return [R('registration.carrier', 'registration', 'unknown', 'medium', 'tenant_a2p_registrations', { detail: { code: 'stored_approved_not_provider_verified' }, action: { code: 'refresh_registration', route: ROUTES.registration } })];
  return [R('registration.carrier', 'registration', 'pending_external', 'medium', 'tenant_a2p_registrations', { detail: { code: 'in_review', brand: b || 'none', campaign: cp || 'none', since: iso(reg.updated_at) }, action: { code: 'open_registration', route: ROUTES.registration } })];
}

// ── SMS transport: inbound webhook, status callbacks (with traffic), opt-out list ─────────────────────────────────────────
async function smsTransport(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const act = (await sql<any>`select webhook_kind, last_verified_at, events_verified from tenant_messaging_webhook_activity where tenant_id = ${c.tenantId}`.execute(db)).rows;
  const by = new Map(act.map((r: any) => [String(r.webhook_kind), r]));
  const out: CheckResult[] = [];
  const base = c.env.PUBLIC_API_BASE_URL, cb = c.env.TWILIO_STATUS_CALLBACK_URL;
  const inb = by.get('inbound');
  if (!base || !/^https:\/\//.test(base)) out.push(R('sms.inbound_webhook', 'sms_transport', 'action_required', 'high', 'environment', { detail: { code: 'public_base_url_missing_or_not_https' }, action: { code: 'open_diagnostics', route: ROUTES.diagnostics } }));
  else if (inb && age(inb.last_verified_at, c.now) <= FRESHNESS.webhook) out.push(R('sms.inbound_webhook', 'sms_transport', 'ready', 'info', 'tenant_messaging_webhook_activity', { verifiedAt: iso(inb.last_verified_at), detail: { code: 'signed_event_seen', events: N(inb.events_verified) } }));
  else out.push(R('sms.inbound_webhook', 'sms_transport', 'unknown', 'low', 'tenant_messaging_webhook_activity', { verifiedAt: iso(inb?.last_verified_at), detail: { code: inb ? 'no_recent_signed_event' : 'never_seen' }, action: { code: 'open_diagnostics', route: ROUTES.diagnostics } }));
  const st = by.get('status');
  // traffic: messages this salon handed to the provider in the last 7 days (the notifications ledger)
  const traffic = N((await sql<any>`select count(*)::int as n from notifications where tenant_id = ${c.tenantId} and provider_id is not null and created_at >= ${new Date(c.now.getTime() - 7 * D)}`.execute(db)).rows[0]?.n);
  if (!cb || !/^https:\/\//.test(cb)) out.push(R('sms.status_callback', 'sms_transport', 'action_required', 'high', 'environment', { detail: { code: 'status_callback_url_missing', traffic }, action: { code: 'open_diagnostics', route: ROUTES.diagnostics } }));
  else if (st && age(st.last_verified_at, c.now) <= 7 * D) out.push(R('sms.status_callback', 'sms_transport', 'ready', 'info', 'tenant_messaging_webhook_activity', { verifiedAt: iso(st.last_verified_at), detail: { code: 'callbacks_arriving', traffic } }));
  else if (traffic > 0) out.push(R('sms.status_callback', 'sms_transport', 'warning', 'high', 'tenant_messaging_webhook_activity', { verifiedAt: iso(st?.last_verified_at), detail: { code: 'traffic_without_callbacks', traffic }, action: { code: 'open_diagnostics', route: ROUTES.diagnostics } }));
  else out.push(R('sms.status_callback', 'sms_transport', 'unknown', 'low', 'tenant_messaging_webhook_activity', { verifiedAt: iso(st?.last_verified_at), detail: { code: 'no_recent_traffic' } }));
  const opt = N((await sql<any>`select count(*)::int as n from notification_opt_outs where tenant_id = ${c.tenantId}`.execute(db)).rows[0]?.n);
  out.push(R('sms.opt_outs', 'sms_transport', 'ready', 'info', 'notification_opt_outs', { verifiedAt: c.now.toISOString(), detail: { code: 'opt_out_list_readable', count: opt } }));
  return out;
}

// ── Booking integration: verification prerequisite + the booking route ───────────────────────────────────────────────────
async function booking(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const s = (await sql<any>`select enabled from booking_verification_settings where tenant_id = ${c.tenantId} and branch_id is null limit 1`.execute(db)).rows[0];
  const chk = (await sql<any>`select verify_state, checked_at from tenant_messaging_health_checks where tenant_id = ${c.tenantId} and branch_id is null order by checked_at desc limit 1`.execute(db)).rows[0];
  if (!s?.enabled) return [R('booking.verification', 'booking', 'disabled', 'info', 'booking_verification_settings', { detail: { code: 'verification_off' } })];
  const ok = chk?.verify_state === 'ok';   // messaging-health.ts: ok · failed · not_configured · unknown
  const fresh = chk && age(chk.checked_at, c.now) <= FRESHNESS.providerCheck;
  return [R('booking.verification', 'booking', ok ? (fresh ? 'ready' : 'unknown') : chk ? 'action_required' : 'unknown', ok && fresh ? 'info' : 'high', 'tenant_messaging_health_checks',
    { verifiedAt: iso(chk?.checked_at), detail: { code: chk ? String(chk.verify_state ?? 'unknown') : 'never_checked' }, action: ok && fresh ? null : { code: 'open_booking_verification', route: ROUTES.booking } })];
}

// ── Branch settings: inheritance for messaging (and AI when per-branch settings exist) ───────────────────────────────────
async function branches(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const list = c.branchId ? [c.branchId] : c.branchIds;
  if (!list.length) return out;
  const rows = (await sql<any>`select b.id, b.name,
      exists (select 1 from tenant_messaging_credentials m where m.tenant_id = b.tenant_id and m.branch_id = b.id and m.offboarded_at is null) as override,
      (select h.account_state from tenant_messaging_health_checks h where h.tenant_id = b.tenant_id and h.branch_id = b.id order by h.checked_at desc limit 1) as last_state
    from branches b where b.tenant_id = ${c.tenantId} and b.id = any(${list}::uuid[]) order by b.name`.execute(db)).rows;
  const ai = (await exists(db, 'tenant_ai_branch_settings'))
    ? new Map((await sql<any>`select branch_id, count(*)::int as n from tenant_ai_branch_settings where tenant_id = ${c.tenantId} and override_enabled is not null group by branch_id`.execute(db)).rows.map((r: any) => [String(r.branch_id), N(r.n)])) : null;
  for (const b of rows) {
    const bad = b.override && b.last_state && b.last_state !== 'connected';
    const unchecked = b.override && !b.last_state;
    out.push(R('branch.settings', 'branch_settings', bad ? 'action_required' : unchecked ? 'unknown' : 'ready', bad ? 'high' : unchecked ? 'medium' : 'info', 'tenant_messaging_credentials',
      { branchId: String(b.id), verifiedAt: c.now.toISOString(), detail: { code: b.override ? 'messaging_override' : 'inherits_tenant_default', aiOverrides: ai ? ai.get(String(b.id)) ?? 0 : null }, action: bad || unchecked ? { code: 'open_messaging_setup', route: ROUTES.setup } : null }));
  }
  return out;
}

// ── AI subscriptions: entitlement, quota, billing reconciliation ──────────────────────────────────────────────────────────
async function ai(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const s = (await sql<any>`select count(*) filter (where status in ('past_due', 'unpaid'))::int as past_due,
      count(*) filter (where status = 'trialing' and trial_ends_at < now())::int as lapsed, count(*) filter (where status in ('active', 'trialing'))::int as live
    from tenant_ai_subscriptions where tenant_id = ${c.tenantId}`.execute(db)).rows[0] ?? {};
  out.push(R('ai.entitlement', 'ai', N(s.past_due) ? 'action_required' : N(s.lapsed) ? 'warning' : N(s.live) ? 'ready' : 'disabled', N(s.past_due) ? 'high' : N(s.lapsed) ? 'low' : 'info', 'tenant_ai_subscriptions',
    { verifiedAt: c.now.toISOString(), detail: { code: N(s.past_due) ? 'past_due' : N(s.lapsed) ? 'trial_expired_not_swept' : N(s.live) ? 'entitled' : 'no_ai_packages', pastDue: N(s.past_due), lapsed: N(s.lapsed), live: N(s.live) },
      action: N(s.past_due) ? { code: 'open_billing', route: ROUTES.billing } : N(s.lapsed) ? { code: 'open_ai_usage', route: ROUTES.ai } : null }));
  const q = (await sql<any>`select count(*)::int as n from ai_usage_alerts a join tenant_ai_subscriptions s on s.tenant_id = a.tenant_id and s.package_code = a.package_code
      and a.period_start = s.current_period_starts_at where a.tenant_id = ${c.tenantId} and a.threshold = 100 and a.acknowledged_at is null`.execute(db)).rows[0];
  out.push(R('ai.quota', 'ai', N(q?.n) ? 'warning' : 'ready', N(q?.n) ? 'medium' : 'info', 'ai_usage_alerts', { verifiedAt: c.now.toISOString(), detail: { code: N(q?.n) ? 'limit_reached' : 'within_limits', packages: N(q?.n) }, action: N(q?.n) ? { code: 'open_ai_usage', route: ROUTES.ai } : null }));
  if (await exists(db, 'ai_billing_reconciliation_runs')) {
    const r = (await sql<any>`select r.status, r.error_code, r.started_at, r.finished_at from ai_billing_reconciliation_runs r where r.tenant_id = ${c.tenantId} order by r.started_at desc limit 1`.execute(db)).rows[0];
    // migration 728: status running / succeeded / partial / failed; a run without a connected read-only provider client fails
    // with error_code provider_not_configured — that is an owner setup step (Blocked - External Setup), not a software error
    const ok = r && r.status === 'succeeded';
    const external = r && r.status === 'failed' && r.error_code === 'provider_not_configured';
    const fin = r?.finished_at ?? r?.started_at;
    const st: HealthStatus = !r ? (N(s.live) || N(s.past_due) ? 'unknown' : 'disabled') : external ? 'pending_external' : r.status === 'partial' ? 'warning' : !ok ? 'error' : age(fin, c.now) <= FRESHNESS.reconciliation ? 'ready' : 'warning';
    out.push(R('ai.billing_reconciliation', 'ai', st, !r || external ? 'low' : !ok ? 'high' : 'info', 'ai_billing_reconciliation_runs',
      { verifiedAt: ok ? iso(fin) : null, detail: { code: !r ? 'never_run' : external ? 'provider_not_configured' : String(r.status), errorCode: r?.error_code ?? null }, action: !ok || !r ? { code: 'open_ai_usage', route: ROUTES.ai } : null }));
  } else out.push(R('ai.billing_reconciliation', 'ai', 'unknown', 'low', 'ai_billing_events', { detail: { code: 'reconciliation_not_available' } }));
  return out;
}

// ── Background jobs: queue failures, stalls, the scheduled jobs' freshness ────────────────────────────────────────────────
async function jobs(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const j = (await sql<any>`select count(*) filter (where status = 'dead' and updated_at >= ${new Date(c.now.getTime() - 7 * D)})::int as dead,
      count(*) filter (where status = 'running' and lease_until < now())::int as stalled,
      count(*) filter (where status = 'queued' and run_after < ${new Date(c.now.getTime() - FRESHNESS.stalledQueue)})::int as overdue
    from jobs where tenant_id = ${c.tenantId}`.execute(db)).rows[0] ?? {};
  out.push(R('jobs.queue', 'jobs', N(j.dead) ? 'error' : N(j.stalled) || N(j.overdue) ? 'warning' : 'ready', N(j.dead) ? 'high' : N(j.stalled) || N(j.overdue) ? 'medium' : 'info', 'jobs',
    { verifiedAt: c.now.toISOString(), detail: { code: N(j.dead) ? 'dead_letters' : N(j.stalled) ? 'stalled_workers' : N(j.overdue) ? 'queue_backlog' : 'healthy', dead: N(j.dead), stalled: N(j.stalled), overdue: N(j.overdue) },
      action: N(j.dead) || N(j.stalled) || N(j.overdue) ? { code: 'view_job_health', route: ROUTES.health } : null }));
  // data accuracy (Team): the last finished scan, manual or nightly
  const da = (await sql<any>`select max(finished_at) as at from team_data_alert_runs where tenant_id = ${c.tenantId} and status = 'succeeded'`.execute(db)).rows[0]?.at;
  const hi = N((await sql<any>`select count(*)::int as n from team_data_alerts where tenant_id = ${c.tenantId} and status in ('OPEN', 'ASSIGNED', 'INVESTIGATING') and severity = 'high'`.execute(db)).rows[0]?.n);
  // TM-07 (migration 727): the nightly team scan's own run log — a failed latest night is visible here even if an older scan passed
  const night = (await exists(db, 'team_data_nightly_runs'))
    ? (await sql<any>`select n.status, n.finished_at from team_data_nightly_runs n where n.tenant_id = ${c.tenantId} order by n.run_date desc limit 1`.execute(db)).rows[0] : null;
  const nightFailed = !!night && night.status === 'failed';
  const daStatus: HealthStatus = nightFailed ? 'error' : !da ? 'unknown' : age(da, c.now) > FRESHNESS.dataAccuracy ? 'warning' : hi ? 'warning' : 'ready';
  out.push(R('jobs.data_accuracy', 'jobs', daStatus, nightFailed ? 'high' : !da ? 'low' : hi ? 'medium' : 'info', night ? 'team_data_nightly_runs' : 'team_data_alert_runs',
    { verifiedAt: iso(da), detail: { code: nightFailed ? 'nightly_failed' : !da ? 'never_run' : age(da, c.now) > FRESHNESS.dataAccuracy ? 'stale' : hi ? 'high_findings_open' : 'fresh', highOpen: hi, nightly: night ? String(night.status) : null },
      action: daStatus !== 'ready' ? { code: 'open_team', route: ROUTES.team } : null }));
  // retention snapshots (CR-01) when that module records them
  if (await exists(db, 'customer_retention_snapshot_runs')) {
    // C3 audit (Nov 4 2026): "fresh" means YESTERDAY's salon-local day has a completed snapshot with full (or reconstructed)
    // coverage — it took the latest run by finish time, so backfilling last March showed fresh, and an incomplete run counted
    const tz = (await sql<any>`select coalesce((select timezone from branches where tenant_id = ${c.tenantId} and deleted_at is null and timezone is not null order by created_at limit 1), 'America/New_York') as tz`.execute(db)).rows[0]?.tz ?? 'America/New_York';
    const y = (await sql<any>`select to_char((${c.now.toISOString()}::timestamptz at time zone ${tz})::date - 1, 'YYYY-MM-DD') as y`.execute(db)).rows[0]?.y as string;
    const last = (await sql<any>`select to_char(r.snapshot_local_date, 'YYYY-MM-DD') as d, r.status, r.coverage, r.finished_at, r.started_at from customer_retention_snapshot_runs r
      where r.tenant_id = ${c.tenantId} order by r.snapshot_local_date desc, coalesce(r.finished_at, r.started_at) desc limit 1`.execute(db)).rows[0];
    const ofY = (await sql<any>`select r.status, r.coverage, r.finished_at from customer_retention_snapshot_runs r
      where r.tenant_id = ${c.tenantId} and r.snapshot_local_date = ${y}::date order by coalesce(r.finished_at, r.started_at) desc limit 1`.execute(db)).rows[0];
    const done = (r: any) => r && (r.status === 'completed' || r.status === 'succeeded');
    const code = !last ? 'never_run' : !ofY ? 'stale' : ofY.status === 'failed' ? 'failed' : !done(ofY) ? String(ofY.status) : ofY.coverage === 'incomplete' ? 'incomplete_coverage' : 'fresh';
    const status: HealthStatus = code === 'never_run' ? 'unknown' : code === 'failed' ? 'error' : code === 'fresh' ? 'ready' : 'warning';
    out.push(R('jobs.retention_snapshot', 'jobs', status, code === 'never_run' ? 'low' : code === 'failed' ? 'high' : code === 'fresh' ? 'info' : 'medium', 'customer_retention_snapshot_runs',
      { verifiedAt: code === 'fresh' ? iso(ofY.finished_at) : null, detail: { code, expectedDate: y, latestDate: last?.d ?? null, latestStatus: last ? String(last.status) : null },
        action: code !== 'fresh' ? { code: 'open_retention', route: ROUTES.retention } : null }));
  }
  return out;
}

// ── Release evidence (QA): CI, staging, device — recorded by the platform, never assumed ──────────────────────────────────
async function release(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const rows = (await sql<any>`select distinct on (kind) kind, outcome, reference, recorded_at, app_version from release_evidence where app_version = ${c.appVersion} order by kind, recorded_at desc`.execute(db)).rows;
  const by = new Map(rows.map((r: any) => [String(r.kind), r]));
  return (['ci_run', 'staging_run', 'device_test'] as const).map((k) => {
    const r: any = by.get(k);
    return R('release.' + k, 'release', !r ? 'pending_external' : r.outcome === 'passed' ? 'ready' : 'action_required', !r ? 'low' : r.outcome === 'passed' ? 'info' : 'high', 'release_evidence',
      { verifiedAt: iso(r?.recorded_at), detail: { code: !r ? 'no_evidence_for_version' : String(r.outcome), version: c.appVersion, reference: r?.reference ?? null } });
  });
}

/** every check, failure-isolated: a check that throws becomes an `error` result (never a silent green or a missing row) */
export async function runAllChecks(db: Kysely<any>, c: CheckCtx): Promise<CheckResult[]> {
  const groups: [string, Area, (db: Kysely<any>, c: CheckCtx) => Promise<CheckResult[]>][] = [
    ['twilio', 'twilio', twilioChecks], ['registration', 'registration', registration], ['sms', 'sms_transport', smsTransport], ['booking', 'booking', booking],
    ['branch', 'branch_settings', branches], ['ai', 'ai', ai], ['jobs', 'jobs', jobs], ['release', 'release', release]];
  const out: CheckResult[] = [];
  for (const [name, area, fn] of groups) {
    try { out.push(...(await fn(db, c))); }
    catch (e) { out.push(R(name + '.check_failed', area, 'error', 'high', 'setup_health', { detail: { code: 'check_failed', error: String((e as Error)?.message ?? e).slice(0, 160) } })); }
  }
  return out;
}

const RANK: Record<HealthStatus, number> = { error: 0, action_required: 1, warning: 2, unknown: 3, pending_external: 4, disabled: 5, ready: 6 };
export const worstOf = (s: HealthStatus[]): HealthStatus => (s.length ? s.reduce((a, b) => (RANK[b] < RANK[a] ? b : a)) : 'unknown');
/** what becomes an alert (dedupe by fingerprint): failures and anything needing the salon, plus medium+ warnings */
export const isAlerting = (r: CheckResult) => r.status === 'error' || r.status === 'action_required' || (r.status === 'warning' && (r.severity === 'medium' || r.severity === 'high' || r.severity === 'critical'));
