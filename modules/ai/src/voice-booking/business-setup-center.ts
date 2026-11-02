// business-setup-center.ts — AI Business Setup Complete Build Guide (Oct 30 2026): `/pos/ai/business-setup/*`.
//
// The page is a READINESS + KNOWLEDGE layer over the salon's canonical data. It never stores hours, services or
// technicians: every count below is read, in this request, from the SAME tables / rules the AI receptionist and online
// booking use (CustomerBookingKyselyRepository.listServices / listTechnicians: tenant + (branch OR no branch) + active;
// VoiceBranchInfoService.storeHours: the Settings 'store-hours-auto-logout' row, branch row over tenant row).
//
// P0 diagnosis (guide §02) — why the photographed page showed "0 services" and "Business hours configured":
//   • Services: the old screen read `r.services.length` from GET /pos/services, which answers { items, pagination } —
//     `r.services` is undefined, so it printed 0 whatever the catalog held (a FALSE zero, never a real count).
//   • Hours: the old check was "any open day in storeHours" — storeHours falls back to the platform DEFAULT week when the
//     salon never saved hours, so an unconfigured salon showed "configured". Readiness now says Needs setup for defaults.
//   • Technicians: the old count was Team Management's list (status-based, branch-optional); the AI reads technicians by
//     is_active + branch. Both counts are shown now, with the status/is_active disagreement, branch and qualification
//     exclusions — a zero is explained, never guessed.
//   A query that fails reports UNKNOWN with a trace reference — never 0.
//
// FAQs: status draft → pending_review → approved (AI-servable) / needs_review / archived (AI_RECEPTIONIST_FAQ). Text lives
// in append-only revisions; an edit of an approved FAQ is a pending draft revision and never overwrites the live text.
// Every change is version-checked, idempotent and audited in the same transaction. Preview is read-only: it never books,
// holds, texts, calls or contacts a provider.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { canMoveToSql, branchTimeZone } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { DEFAULT_SETTINGS } from '@aipowersalon/tenants';
import { AI_RECEPTIONIST_FAQ } from '../ai-lifecycles';
import { resolveVoiceProvider, resolveTelephonyProvider } from './provider-ports';
import { VOICE_TOOLS, voiceWriteToolsEnabled } from './voice-tools';

export class BusinessSetupError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); }
}
// a row read through raw SQL (column names are the query's own)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export interface BsCtx { tenantId: string; branchId: string | null; userId: string; role?: string; permissions?: string[] }

export const BS_STATUSES = ['READY', 'NEEDS_SETUP', 'STALE', 'FAILED', 'DISABLED', 'UNKNOWN'] as const;
export type BsStatus = typeof BS_STATUSES[number];
export const FAQ_STATUSES = ['draft', 'pending_review', 'approved', 'needs_review', 'archived'] as const;
export const FAQ_ACTIONS = ['edit', 'submit', 'approve', 'reject', 'archive', 'restore'] as const;
export const FAQ_SORTS = ['newest', 'oldest', 'updated', 'approved', 'question_az'] as const;
export const FAQ_DATE_BASES = ['created', 'updated', 'approved'] as const;
export const HISTORY_BASES = ['faq_change', 'approval', 'preview'] as const;
export const SEARCH_SCOPES = ['faqs', 'services', 'technicians', 'tests', 'history'] as const;
export const PAGE_SIZES = [10, 20, 50] as const;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const trace = () => 'bs_' + randomUUID().slice(0, 8);
const nowIso = () => new Date().toISOString();
const pageOf = (p: unknown) => Math.max(1, Math.trunc(Number(p) || 1));
const sizeOf = (s: unknown) => ((PAGE_SIZES as readonly number[]).includes(Number(s)) ? Number(s) : 20);
const like = (q: string) => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** hours validity: open days need HH:MM open + close; close before open is a midnight-spanning day (allowed, flagged) */
export function validateWeek(storeHours: Record<string, any>): { openDays: number; invalidDays: string[]; overnightDays: string[] } {
  let openDays = 0; const invalidDays: string[] = []; const overnightDays: string[] = [];
  for (const d of DAYS) {
    const h = storeHours?.[d];
    if (!h || !h.isOpen) continue;
    if (!HHMM.test(String(h.openTime ?? '')) || !HHMM.test(String(h.closeTime ?? '')) || h.openTime === h.closeTime) { invalidDays.push(d); continue; }
    openDays++;
    if (minutes(h.closeTime) < minutes(h.openTime)) overnightDays.push(d);
  }
  return { openDays, invalidDays, overnightDays };
}

/** strip phone numbers and e-mail addresses from a preview question before it is stored */
export function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]').replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted]').slice(0, 300);
}
const STOP = new Set(['the', 'you', 'your', 'are', 'can', 'and', 'for', 'what', 'how', 'does', 'have', 'with', 'this', 'that', 'there', 'about', 'any', 'get', 'need', 'from', 'when', 'will', 'our', 'is', 'do', 'a', 'an', 'to', 'of', 'in', 'on', 'it', 'my', 'me', 'we', 'i']);
export const tokens = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
export function matchScore(q: string, candidate: string): number {
  const a = tokens(q), b = new Set(tokens(candidate)); if (!a.length || !b.size) return 0;
  return a.filter((w) => b.has(w)).length / Math.min(a.length, b.size);
}
export function classifyIntent(q: string): 'hours' | 'price' | 'technician' | 'booking' | 'policy' | 'general' {
  const s = q.toLowerCase();
  if (/\b(cancel|cancellation|deposit|late|no[- ]?show|refund|policy|policies)\b/.test(s)) return 'policy';
  if (/\b(book|booking|appointment|available|availability|slot|reserve|opening for)\b/.test(s)) return 'booking';
  if (/\b(how much|price|prices|cost|costs|charge|\$)/.test(s)) return 'price';
  if (/\b(who (can|does|do)|technician|technicians|nail tech|artist|stylist)\b/.test(s)) return 'technician';
  if (/\b(open|opens|close|closes|closing|hours|sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekend)\b/.test(s)) return 'hours';
  return 'general';
}
const FAQ_GAP_TOPICS: { key: string; words: RegExp; question: string }[] = [
  { key: 'cancellation', words: /cancel/i, question: 'What is your cancellation policy?' },
  { key: 'walk_ins', words: /walk[- ]?in/i, question: 'Do you take walk-ins?' },
  { key: 'parking', words: /park/i, question: 'Where can I park?' },
  { key: 'payment', words: /(pay|card|cash)/i, question: 'Which payment methods do you accept?' },
  { key: 'late_arrival', words: /late/i, question: 'What happens if I arrive late?' },
  { key: 'gift_cards', words: /gift/i, question: 'Do you sell gift cards?' },
];

export interface Check { key: string; status: BsStatus; source: string; branchScope: string; rawCount: number | null; eligibleCount: number | null;
  exclusions: { reason: string; count: number }[]; warnings: string[]; detail: string; action: { label: string; route: string } | null; checkedAt: string; traceId: string; errorCode?: string }

export class BusinessSetupCenter {
  constructor(private readonly db: Kysely<any>) {}

  private branch(ctx: BsCtx): string | null { return isUuid(ctx.branchId) ? ctx.branchId : null; }
  private scopeLabel(ctx: BsCtx) { return this.branch(ctx) ? 'branch' : 'all_branches'; }
  private async zone(ctx: BsCtx) { return branchTimeZone(this.db, ctx.tenantId, this.branch(ctx)).catch(() => 'America/New_York'); }
  private unknown(key: string, source: string, ctx: BsCtx, e: unknown): Check {
    const t = trace();
    return { key, status: 'UNKNOWN', source, branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
      detail: 'This could not be checked right now. Nothing was assumed — try again.', action: null, checkedAt: nowIso(), traceId: t,
      errorCode: (e as { code?: string })?.code ? String((e as { code?: string }).code) : 'QUERY_FAILED' };
  }

  // ── canonical reads ──────────────────────────────────────────────────────────────────────────────────────────────
  /** the hours the AI is told (same row VoiceBranchInfoService.storeHours reads), plus where they came from */
  async hours(ctx: BsCtx): Promise<{ source: 'branch' | 'tenant' | 'platform_default'; timezone: string; storeHours: Record<string, any>; updatedAt: string | null }> {
    const b = this.branch(ctx); const timezone = await this.zone(ctx);
    const rows: Row[] = (await sql<Row>`select branch_id, settings_json, updated_at from tenant_settings where tenant_id = ${ctx.tenantId}
      and category in ('store-hours-auto-logout', 'store_hours') and (branch_id = ${b} or branch_id is null)`.execute(this.db)).rows;
    const pick = rows.find((r) => b && r.branch_id === b) ?? rows.find((r) => r.branch_id == null);
    const dflt = (DEFAULT_SETTINGS as unknown as { storeHoursAutoLogout: { storeHours: Record<string, unknown> } }).storeHoursAutoLogout.storeHours;
    if (!pick) return { source: 'platform_default', timezone, storeHours: { ...dflt }, updatedAt: null };
    const j = typeof pick.settings_json === 'string' ? JSON.parse(pick.settings_json) : (pick.settings_json ?? {});
    if (!j?.storeHours) return { source: 'platform_default', timezone, storeHours: { ...dflt }, updatedAt: null };
    return { source: pick.branch_id ? 'branch' : 'tenant', timezone, storeHours: { ...dflt, ...j.storeHours }, updatedAt: pick.updated_at ? new Date(pick.updated_at).toISOString() : null };
  }
  /** services the AI and online booking offer: tenant + (branch OR no branch) + active (CustomerBooking listServices) */
  private async eligibleServices(ctx: BsCtx): Promise<Row[]> {
    const b = this.branch(ctx);
    return (await sql<Row>`select id, name, duration_minutes, price_cents, online_booking_enabled from services where tenant_id = ${ctx.tenantId}
      and status = 'active' and (${b}::uuid is null or branch_id = ${b} or branch_id is null) order by name asc, id asc`.execute(this.db)).rows;
  }
  private async eligibleTechnicians(ctx: BsCtx): Promise<Row[]> {
    const b = this.branch(ctx);
    return (await sql<Row>`select t.id, t.full_name,
        exists (select 1 from technician_services ts join services s on s.id = ts.service_id and s.tenant_id = t.tenant_id and s.status = 'active'
                where ts.tenant_id = t.tenant_id and ts.technician_id = t.id) as qualified,
        exists (select 1 from technician_schedules sc where sc.tenant_id = t.tenant_id and sc.technician_id = t.id and sc.is_working) as scheduled
      from technicians t where t.tenant_id = ${ctx.tenantId} and t.is_active = true and (${b}::uuid is null or t.branch_id = ${b} or t.branch_id is null)
      order by t.full_name asc, t.id asc`.execute(this.db)).rows;
  }

  // ── readiness (guide §03) ───────────────────────────────────────────────────────────────────────────────────────────
  private async hoursCheck(ctx: BsCtx): Promise<Check> {
    try {
      const h = await this.hours(ctx); const v = validateWeek(h.storeHours);
      const b = this.branch(ctx);
      const other = b ? N((await sql<Row>`select count(*)::int n from tenant_location_hours where tenant_id = ${ctx.tenantId} and location_id = ${b}`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n) : 0;
      const warnings: string[] = [];
      if (v.overnightDays.length) warnings.push(`Open past midnight on ${v.overnightDays.join(', ')}.`);
      if (other > 0) warnings.push('Super Admin also keeps location hours for this branch; the AI reads the POS Settings hours only.');
      warnings.push('No holiday or special-closure schedule exists in the system yet, so the AI cannot know about closures.');
      const status: BsStatus = h.source === 'platform_default' ? 'NEEDS_SETUP' : v.invalidDays.length ? 'FAILED' : v.openDays === 0 ? 'NEEDS_SETUP' : 'READY';
      const detail = h.source === 'platform_default' ? 'Hours were never saved for this salon — the AI would only see the platform default week.'
        : v.invalidDays.length ? `Invalid hours on ${v.invalidDays.join(', ')}.` : v.openDays === 0 ? 'Every day is closed.' : `Open ${v.openDays} day(s) a week (${h.timezone}).`;
      return { key: 'business_hours', status, source: h.source === 'branch' ? 'Settings → Store hours (this branch)' : h.source === 'tenant' ? 'Settings → Store hours (salon-wide)' : 'Platform default (not saved)',
        branchScope: this.scopeLabel(ctx), rawCount: 7, eligibleCount: v.openDays, exclusions: v.invalidDays.length ? [{ reason: 'invalid_hours', count: v.invalidDays.length }] : [], warnings, detail,
        action: { label: 'Edit store hours', route: '/settings?section=auto-logout' }, checkedAt: nowIso(), traceId: trace() };
    } catch (e) { return this.unknown('business_hours', 'Settings → Store hours', ctx, e); }
  }
  private async servicesCheck(ctx: BsCtx): Promise<Check> {
    try {
      const b = this.branch(ctx);
      const r: Row = (await sql<Row>`select count(*)::int raw,
          count(*) filter (where status <> 'active')::int inactive,
          count(*) filter (where status = 'active' and ${b}::uuid is not null and branch_id is not null and branch_id <> ${b})::int other_branch
        from services where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
      const el = await this.eligibleServices(ctx);
      const noDur = el.filter((s) => N(s.duration_minutes) <= 0).length, noPrice = el.filter((s) => s.price_cents == null || N(s.price_cents) <= 0).length;
      const notOnline = el.filter((s) => s.online_booking_enabled === false).length;
      const warnings: string[] = [];
      if (noDur) warnings.push(`${noDur} bookable service(s) have no duration.`);
      if (noPrice) warnings.push(`${noPrice} bookable service(s) have no price.`);
      if (notOnline) warnings.push(`${notOnline} service(s) have online booking turned off but are still offered by the AI and online booking (the booking engine does not read that switch).`);
      const exclusions = [{ reason: 'inactive_or_archived', count: N(r.inactive) }, { reason: 'other_branch', count: N(r.other_branch) }].filter((x) => x.count > 0);
      const status: BsStatus = el.length === 0 ? 'NEEDS_SETUP' : 'READY';
      const detail = el.length > 0 ? `${el.length} of ${N(r.raw)} service(s) can be booked by the AI.`
        : N(r.raw) === 0 ? 'No services exist in the catalog yet.' : `No eligible services: ${N(r.raw)} exist but none is active for this branch.`;
      return { key: 'services', status, source: 'Services & Products (services)', branchScope: this.scopeLabel(ctx), rawCount: N(r.raw), eligibleCount: el.length, exclusions, warnings, detail,
        action: { label: 'Open Services', route: '/services' }, checkedAt: nowIso(), traceId: trace() };
    } catch (e) { return this.unknown('services', 'Services & Products', ctx, e); }
  }
  private async techniciansCheck(ctx: BsCtx): Promise<Check> {
    try {
      const b = this.branch(ctx);
      const r: Row = (await sql<Row>`select count(*)::int raw,
          count(*) filter (where not is_active)::int inactive,
          count(*) filter (where is_active and ${b}::uuid is not null and branch_id is not null and branch_id <> ${b})::int other_branch,
          count(*) filter (where (status = 'active') <> is_active and archived_at is null)::int mismatch
        from technicians where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
      const el = await this.eligibleTechnicians(ctx);
      const qualified = el.filter((t) => t.qualified).length, scheduled = el.filter((t) => t.scheduled).length;
      const warnings: string[] = [];
      if (N(r.mismatch)) warnings.push(`${N(r.mismatch)} technician(s) have a Team status that disagrees with their active flag — Team Management and the AI may count them differently.`);
      if (el.length && qualified < el.length) warnings.push(`${el.length - qualified} active technician(s) have no service qualification.`);
      if (el.length && scheduled < el.length) warnings.push(`${el.length - scheduled} active technician(s) have no working schedule.`);
      const exclusions = [{ reason: 'inactive', count: N(r.inactive) }, { reason: 'other_branch', count: N(r.other_branch) }].filter((x) => x.count > 0);
      const status: BsStatus = el.length === 0 ? 'NEEDS_SETUP' : qualified === 0 || scheduled === 0 ? 'NEEDS_SETUP' : 'READY';
      const detail = el.length === 0 ? (N(r.raw) === 0 ? 'No technicians on file.' : `No eligible technicians: ${N(r.raw)} on file but none is active at this branch.`)
        : qualified === 0 ? 'Technicians are on file but none has a service qualification.' : scheduled === 0 ? 'Technicians are on file but none has a working schedule.'
        : `${el.length} technician(s) can be offered; ${qualified} qualified, ${scheduled} scheduled. Availability is checked live at the time of a call.`;
      return { key: 'technicians', status, source: 'Team Management (technicians, technician_services, technician_schedules)', branchScope: this.scopeLabel(ctx), rawCount: N(r.raw), eligibleCount: el.length, exclusions, warnings, detail,
        action: { label: 'Open Team', route: '/technicians' }, checkedAt: nowIso(), traceId: trace() };
    } catch (e) { return this.unknown('technicians', 'Team Management', ctx, e); }
  }
  private async faqCheck(ctx: BsCtx): Promise<Check> {
    try {
      const r: Row = (await sql<Row>`select count(*)::int raw, count(*) filter (where status = 'approved' and approved_revision_id is not null)::int approved,
          count(*) filter (where status in ('draft', 'pending_review', 'needs_review'))::int unapproved, count(*) filter (where status = 'archived')::int archived
        from ai_receptionist_faqs where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
      const exclusions = [{ reason: 'not_approved', count: N(r.unapproved) }, { reason: 'archived', count: N(r.archived) }].filter((x) => x.count > 0);
      return { key: 'faqs', status: N(r.approved) > 0 ? 'READY' : 'NEEDS_SETUP', source: 'Customer FAQs (approved revisions only)', branchScope: this.scopeLabel(ctx), rawCount: N(r.raw), eligibleCount: N(r.approved),
        exclusions, warnings: [], detail: N(r.approved) > 0 ? `${N(r.approved)} approved FAQ(s) the AI may use.` : 'No approved FAQs yet — optional, but the AI hands off questions it cannot answer.',
        action: null, checkedAt: nowIso(), traceId: trace() };
    } catch (e) { return this.unknown('faqs', 'Customer FAQs', ctx, e); }
  }
  private bookingCheck(ctx: BsCtx): Check {
    const armed = voiceWriteToolsEnabled(process.env);
    return { key: 'booking', status: armed ? 'READY' : 'DISABLED', source: 'Booking actions (VOICE_WRITE_TOOLS_ENABLED)', branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
      detail: armed ? 'The AI can hold and book real times after confirming with the caller.' : 'Handoff only: the AI can read real availability but cannot book until booking actions are armed.',
      action: { label: 'Open AI Settings', route: '/tenant/ai/receptionist/settings' }, checkedAt: nowIso(), traceId: trace() };
  }
  private providerCheck(ctx: BsCtx): Check {
    const v = resolveVoiceProvider(process.env).status(), t = resolveTelephonyProvider(process.env).status();
    const ok = v.state === 'connected' && t.state === 'connected';
    return { key: 'provider', status: ok ? 'READY' : 'DISABLED', source: 'Voice provider + phone routing (separate setup screens)', branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
      detail: `Voice agent: ${v.state}${v.detail ? ` (${v.detail})` : ''}. Phone routing: ${t.state}${t.detail ? ` (${t.detail})` : ''}. A saved configuration is not proof the provider works.`,
      action: { label: 'Open AI Receptionist', route: '/tenant/ai/receptionist' }, checkedAt: nowIso(), traceId: trace() };
  }

  async readiness(ctx: BsCtx) {
    const [hours, services, technicians, faqs] = await Promise.all([this.hoursCheck(ctx), this.servicesCheck(ctx), this.techniciansCheck(ctx), this.faqCheck(ctx)]);
    return { branchScope: this.scopeLabel(ctx), checkedAt: nowIso(), core: [hours, services, technicians], supplemental: [faqs, this.bookingCheck(ctx), this.providerCheck(ctx)] };
  }

  // ── one-click health check (guide §11; non-mutating) ─────────────────────────────────────────────────────────────────
  async health(ctx: BsCtx) {
    const r = await this.readiness(ctx);
    const checks: Check[] = [];
    checks.push({ key: 'tenant_branch', status: this.branch(ctx) ? 'READY' : 'NEEDS_SETUP', source: 'Signed-in session', branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
      detail: this.branch(ctx) ? 'Readiness is for the branch you are signed in to.' : 'No branch selected — counts cover all branches; the AI at a location sees only that location.', action: null, checkedAt: nowIso(), traceId: trace() });
    checks.push(...r.core);
    try {
      const el = await this.eligibleTechnicians(ctx); const sch = el.filter((t) => t.scheduled).length;
      checks.push({ key: 'staff_schedule', status: el.length === 0 ? 'NEEDS_SETUP' : sch === el.length ? 'READY' : sch === 0 ? 'NEEDS_SETUP' : 'STALE', source: 'Staff Schedule (technician_schedules)', branchScope: this.scopeLabel(ctx),
        rawCount: el.length, eligibleCount: sch, exclusions: el.length - sch > 0 ? [{ reason: 'no_working_schedule', count: el.length - sch }] : [], warnings: [],
        detail: el.length === 0 ? 'No eligible technicians to schedule.' : `${sch} of ${el.length} eligible technician(s) have a working schedule. Lunch, time off and blocks are applied by Booking at the time of a call.`,
        action: { label: 'Open Staff Schedule', route: '/technicians' }, checkedAt: nowIso(), traceId: trace() });
    } catch (e) { checks.push(this.unknown('staff_schedule', 'Staff Schedule', ctx, e)); }
    checks.push(r.supplemental[1]);
    const faq = r.supplemental[0]; checks.push({ ...faq, key: 'approved_faqs' });
    const tool = VOICE_TOOLS.find((t) => t.name === 'get_business_info');
    checks.push({ key: 'knowledge_sync', status: tool?.enabled ? (faq.status === 'UNKNOWN' ? 'UNKNOWN' : 'READY') : 'DISABLED', source: 'Voice tool get_business_info', branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
      detail: tool?.enabled ? 'The AI reads hours and approved FAQs live at call time — there is no copy to go stale; a draft is never served.' : 'The AI has no tool to read business knowledge.', action: null, checkedAt: nowIso(), traceId: trace() });
    const prov = r.supplemental[2];
    checks.push({ ...prov, key: 'agent_knowledge', status: prov.status === 'READY' ? 'UNKNOWN' : 'DISABLED',
      detail: prov.status === 'READY' ? 'The provider is connected, but whether the live agent has the get_business_info tool registered can only be confirmed in the provider account.' : 'No voice agent is connected, so no agent receives this knowledge yet.' });
    try {
      const j: Row = (await sql<Row>`select count(*) filter (where status = 'failed' and created_at > now() - interval '7 days')::int failed,
          count(*) filter (where status in ('queued', 'running') and updated_at < now() - interval '1 hour')::int stuck from ai_receptionist_provisioning_jobs where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
      const st: BsStatus = N(j.failed) ? 'FAILED' : N(j.stuck) ? 'STALE' : 'READY';
      checks.push({ key: 'audit_jobs', status: st, source: 'AI agent provisioning jobs', branchScope: this.scopeLabel(ctx), rawCount: null, eligibleCount: null, exclusions: [], warnings: [],
        detail: st === 'READY' ? 'No failed or stuck AI setup jobs in the last 7 days.' : `${N(j.failed)} failed and ${N(j.stuck)} stuck AI setup job(s).`, action: { label: 'Open AI Receptionist', route: '/tenant/ai/receptionist' }, checkedAt: nowIso(), traceId: trace() });
    } catch (e) { checks.push(this.unknown('audit_jobs', 'AI agent provisioning jobs', ctx, e)); }
    const worst = (['FAILED', 'UNKNOWN', 'NEEDS_SETUP', 'STALE', 'DISABLED', 'READY'] as BsStatus[]).find((s) => checks.some((c) => c.status === s && c.key !== 'agent_knowledge' && c.key !== 'provider' && c.key !== 'booking')) ?? 'READY';
    return { overall: worst, checkedAt: nowIso(), checks, note: 'This check only reads; it changed nothing. Provider and deployment items are listed separately and are never shown as ready from a saved setting alone.' };
  }

  // ── FAQ list / detail ───────────────────────────────────────────────────────────────────────────────────────────────
  async faqs(ctx: BsCtx, f: { q?: string; status?: string; category?: string; branch?: string; author?: string; dateBasis?: string; from?: string; to?: string; sort?: string; page?: unknown; pageSize?: unknown }) {
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if (f.from && !DATE.test(f.from)) throw new BusinessSetupError('Choose a valid From date.', 'AI_SETUP_INVALID_FILTER');
    if (f.to && !DATE.test(f.to)) throw new BusinessSetupError('Choose a valid To date.', 'AI_SETUP_INVALID_FILTER');
    if (f.from && f.to && f.to < f.from) throw new BusinessSetupError('The To date is before the From date.', 'AI_SETUP_INVALID_FILTER');
    const tz = await this.zone(ctx);
    const basis = (FAQ_DATE_BASES as readonly string[]).includes(String(f.dateBasis)) ? String(f.dateBasis) : 'created';
    const col = basis === 'updated' ? sql`f.updated_at` : basis === 'approved' ? sql`f.approved_at` : sql`f.created_at`;
    const conds = [sql`true`];
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q) conds.push(sql`(f.question ilike ${like(q)} or f.answer ilike ${like(q)} or coalesce(f.category, '') ilike ${like(q)} or f.id::text = ${q}
      or exists (select 1 from ai_receptionist_faq_revisions r where r.tenant_id = f.tenant_id and r.faq_id = f.id and r.id = f.draft_revision_id and (r.question ilike ${like(q)} or r.answer ilike ${like(q)})))`);
    if (f.status && (FAQ_STATUSES as readonly string[]).includes(f.status)) conds.push(sql`f.status = ${f.status}`);
    if (f.category) conds.push(sql`lower(coalesce(f.category, '')) = ${f.category.toLowerCase().slice(0, 60)}`);
    if (f.branch === 'all') conds.push(sql`f.branch_id is null`); else if (isUuid(f.branch)) conds.push(sql`f.branch_id = ${f.branch}`);
    if (isUuid(f.author)) conds.push(sql`f.created_by_user_id = ${f.author}`);
    if (f.from) conds.push(sql`${col} >= (${f.from}::date)::timestamp at time zone ${tz}`);
    if (f.to) conds.push(sql`${col} < ((${f.to}::date + 1))::timestamp at time zone ${tz}`);
    const where = sql.join(conds, sql` and `);
    const order = f.sort === 'oldest' ? sql`f.created_at asc, f.id asc` : f.sort === 'updated' ? sql`f.updated_at desc, f.id desc`
      : f.sort === 'approved' ? sql`f.approved_at desc nulls last, f.id desc` : f.sort === 'question_az' ? sql`lower(f.question) asc, f.id asc` : sql`f.created_at desc, f.id desc`;
    const total = N((await sql<Row>`select count(*)::int n from ai_receptionist_faqs f where f.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const rows: Row[] = (await sql<Row>`select f.id, f.branch_id, f.question, f.answer, f.category, f.status, f.version, f.approved_revision_id, f.draft_revision_id,
        f.created_by_user_id, f.created_at, f.updated_at, f.approved_at, f.submitted_at, f.archived_at,
        (select r.question from ai_receptionist_faq_revisions r where r.tenant_id = f.tenant_id and r.id = f.draft_revision_id) draft_question,
        (select r.answer from ai_receptionist_faq_revisions r where r.tenant_id = f.tenant_id and r.id = f.draft_revision_id) draft_answer
      from ai_receptionist_faqs f where f.tenant_id = ${ctx.tenantId} and ${where} order by ${order} limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    const cats: Row[] = (await sql<Row>`select distinct category from ai_receptionist_faqs where tenant_id = ${ctx.tenantId} and category is not null order by category limit 100`.execute(this.db)).rows;
    return { items: rows.map((r) => this.faqRow(r)), page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), timezone: tz, dateBasis: basis, categories: cats.map((c) => c.category) };
  }
  private faqRow(r: Row) {
    const pending = !!r.draft_revision_id && r.draft_revision_id !== r.approved_revision_id;
    return { id: r.id, branchId: r.branch_id ?? null, question: r.question, answer: r.answer, category: r.category ?? null, status: r.status, version: N(r.version),
      aiServable: r.status === 'approved' && !!r.approved_revision_id, hasPendingChange: r.status === 'approved' && pending,
      draftQuestion: pending ? r.draft_question ?? null : null, draftAnswer: pending ? r.draft_answer ?? null : null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), approvedAt: iso(r.approved_at), submittedAt: iso(r.submitted_at), archivedAt: iso(r.archived_at) };
  }
  async faq(ctx: BsCtx, id: string) {
    if (!isUuid(id)) throw new BusinessSetupError('FAQ not found.', 'AI_FAQ_NOT_FOUND', 404);
    const r: Row = (await sql<Row>`select f.id, f.tenant_id, f.branch_id, f.question, f.answer, f.category, f.status, f.version, f.approved_revision_id, f.draft_revision_id, f.approved_at, f.submitted_at, f.archived_at, f.created_at, f.updated_at, f.created_by_user_id, (select r.question from ai_receptionist_faq_revisions r where r.tenant_id = f.tenant_id and r.id = f.draft_revision_id) draft_question,
        (select r.answer from ai_receptionist_faq_revisions r where r.tenant_id = f.tenant_id and r.id = f.draft_revision_id) draft_answer
      from ai_receptionist_faqs f where f.tenant_id = ${ctx.tenantId} and f.id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw new BusinessSetupError('FAQ not found.', 'AI_FAQ_NOT_FOUND', 404);
    const revisions: Row[] = (await sql<Row>`select id, revision_no, question, answer, category, prior_revision_id, reason, source, created_at from ai_receptionist_faq_revisions
      where tenant_id = ${ctx.tenantId} and faq_id = ${id} order by revision_no desc limit 50`.execute(this.db)).rows;
    const events: Row[] = (await sql<Row>`select id, action, from_status, to_status, revision_id, reason, created_at, (actor_user_id is not null) has_actor,
        (select u.full_name from users u where u.id = e.actor_user_id and u.tenant_id = e.tenant_id) actor_name
      from ai_receptionist_faq_events e where tenant_id = ${ctx.tenantId} and faq_id = ${id} order by created_at desc, id desc limit 100`.execute(this.db)).rows;
    const usage = N((await sql<Row>`select count(*)::int n from ai_business_setup_preview_runs where tenant_id = ${ctx.tenantId} and sources @> ${JSON.stringify([{ type: 'faq', id }])}::jsonb`.execute(this.db)).rows[0]?.n);
    const approved = revisions.find((x) => x.id === r.approved_revision_id) ?? null;
    return { ...this.faqRow(r), approvedRevision: approved ? { id: approved.id, revisionNo: N(approved.revision_no), question: approved.question, answer: approved.answer, category: approved.category } : null,
      revisions: revisions.map((x) => ({ id: x.id, revisionNo: N(x.revision_no), question: x.question, answer: x.answer, category: x.category ?? null, priorRevisionId: x.prior_revision_id ?? null,
        reason: x.reason ?? null, source: x.source, createdAt: iso(x.created_at), isApproved: x.id === r.approved_revision_id, isPendingDraft: x.id === r.draft_revision_id && x.id !== r.approved_revision_id })),
      events: events.map((e) => ({ id: e.id, action: e.action, fromStatus: e.from_status ?? null, toStatus: e.to_status ?? null, revisionId: e.revision_id ?? null, reason: e.reason ?? null,
        actor: e.actor_name ?? (e.has_actor ? 'Staff member' : 'System / unknown'), createdAt: iso(e.created_at) })),
      previewUses: usage };
  }

  // ── FAQ writes (ai.manage; version-checked, idempotent, audited in the same transaction) ───────────────────────────
  private validateText(question: unknown, answer: unknown, category: unknown) {
    const q = String(question ?? '').trim(), a = String(answer ?? '').trim(), c = category == null ? null : String(category).trim() || null;
    if (!q) throw new BusinessSetupError('A question is required.', 'FAQ_QUESTION_REQUIRED');
    if (!a) throw new BusinessSetupError('An answer is required.', 'FAQ_ANSWER_REQUIRED');
    if (q.length > 300) throw new BusinessSetupError('Question is too long.', 'FAQ_QUESTION_TOO_LONG');
    if (a.length > 2000) throw new BusinessSetupError('Answer is too long.', 'FAQ_ANSWER_TOO_LONG');
    if (c && c.length > 60) throw new BusinessSetupError('Category is too long.', 'AI_SETUP_INVALID_FILTER');
    return { q, a, c };
  }
  async createFaq(ctx: BsCtx, b: { question?: unknown; answer?: unknown; category?: unknown; branchScope?: unknown; origin?: unknown; idempotencyKey?: unknown }) {
    const { q, a, c } = this.validateText(b.question, b.answer, b.category);
    const key = String(b.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 120) throw new BusinessSetupError('A request key is required.', 'AI_SETUP_IDEMPOTENCY_REQUIRED');
    const branchId = b.branchScope === 'branch' && this.branch(ctx) ? this.branch(ctx) : null;
    const origin = b.origin === 'assistant' ? 'assistant' : 'pos';
    return this.db.transaction().execute(async (trx) => {
      const prior: Row = (await sql<Row>`select id from ai_receptionist_faqs where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) return { id: prior.id, replayed: true };
      const ins: Row = (await sql<Row>`insert into ai_receptionist_faqs (tenant_id, branch_id, question, answer, category, language, is_active, status, version, idempotency_key, created_by_user_id, updated_by_user_id)
        values (${ctx.tenantId}, ${branchId}, ${q}, ${a}, ${c}, 'en', false, 'draft', 1, ${key}, ${ctx.userId}, ${ctx.userId})
        on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing returning id`.execute(trx)).rows[0];
      if (!ins) return { id: (await sql<Row>`select id from ai_receptionist_faqs where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0]?.id as string, replayed: true };
      const rev: Row = (await sql<Row>`insert into ai_receptionist_faq_revisions (tenant_id, faq_id, revision_no, question, answer, category, reason, source, created_by_user_id)
        values (${ctx.tenantId}, ${ins.id}, 1, ${q}, ${a}, ${c}, ${origin === 'assistant' ? 'Drafted from a Knowledge Assistant suggestion' : 'Created'}, ${origin}, ${ctx.userId}) returning id`.execute(trx)).rows[0];
      await sql<Row>`update ai_receptionist_faqs set draft_revision_id = ${rev.id} where tenant_id = ${ctx.tenantId} and id = ${ins.id}`.execute(trx);
      await sql<Row>`insert into ai_receptionist_faq_events (tenant_id, branch_id, faq_id, action, from_status, to_status, revision_id, actor_user_id, reason)
        values (${ctx.tenantId}, ${branchId}, ${ins.id}, 'created', null, 'draft', ${rev.id}, ${ctx.userId}, null)`.execute(trx);
      await recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
        { module: 'ai_business_setup', action: 'faq.created', resourceType: 'ai_receptionist_faq', resourceId: ins.id, summary: 'Created a draft FAQ (not yet used by the AI)', metadata: { origin } });
      return { id: ins.id as string, replayed: false };
    });
  }

  async faqAction(ctx: BsCtx, id: string, b: { action?: unknown; expectedVersion?: unknown; question?: unknown; answer?: unknown; category?: unknown; reason?: unknown; idempotencyKey?: unknown }) {
    const action = String(b.action ?? '');
    if (!(FAQ_ACTIONS as readonly string[]).includes(action)) throw new BusinessSetupError('Unknown action.', 'AI_SETUP_INVALID_FILTER');
    if (!isUuid(id)) throw new BusinessSetupError('FAQ not found.', 'AI_FAQ_NOT_FOUND', 404);
    const expected = Math.trunc(Number(b.expectedVersion));
    const key = String(b.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 120) throw new BusinessSetupError('A request key is required.', 'AI_SETUP_IDEMPOTENCY_REQUIRED');
    const reason = b.reason == null ? null : String(b.reason).trim().slice(0, 500) || null;
    if ((action === 'reject' || action === 'archive') && !reason) throw new BusinessSetupError('Add a short reason.', 'AI_FAQ_REASON_REQUIRED');
    const text = action === 'edit' ? this.validateText(b.question, b.answer, b.category) : null;
    return this.db.transaction().execute(async (trx) => {
      const f: Row = (await sql<Row>`select id, branch_id, status, version, approved_revision_id, draft_revision_id from ai_receptionist_faqs where tenant_id = ${ctx.tenantId} and id = ${id} for update`.execute(trx)).rows[0];
      if (!f) throw new BusinessSetupError('FAQ not found.', 'AI_FAQ_NOT_FOUND', 404);
      const replay: Row = (await sql<Row>`select id from ai_receptionist_faq_events where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (replay) return { id, status: f.status, version: N(f.version), replayed: true };
      if (N(f.version) !== expected) throw new BusinessSetupError('This FAQ was changed by someone else. Reload and try again.', 'AI_FAQ_VERSION_CONFLICT', 409, { currentVersion: N(f.version) });
      const from = String(f.status);
      let to = from; let event = action; let revisionId: string | null = null; const sets: Row[] = [];
      const move = async (target: string) => {
        const ok: Row = (await sql<Row>`update ai_receptionist_faqs set status = ${target} where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(AI_RECEPTIONIST_FAQ, target)} returning id`.execute(trx)).rows[0];
        if (!ok) throw new BusinessSetupError(`An FAQ that is ${from.replace('_', ' ')} cannot be ${action === 'submit' ? 'submitted' : action + 'd'}.`, 'AI_FAQ_INVALID_TRANSITION', 409, { from, to: target });
        to = target;
      };
      if (action === 'edit') {
        if (from === 'archived') throw new BusinessSetupError('Restore the FAQ before editing it.', 'AI_FAQ_INVALID_TRANSITION', 409, { from });
        const no = N((await sql<Row>`select coalesce(max(revision_no), 0)::int n from ai_receptionist_faq_revisions where tenant_id = ${ctx.tenantId} and faq_id = ${id}`.execute(trx)).rows[0]?.n) + 1;
        const prior = f.draft_revision_id ?? f.approved_revision_id ?? null;
        revisionId = (await sql<Row>`insert into ai_receptionist_faq_revisions (tenant_id, faq_id, revision_no, question, answer, category, prior_revision_id, reason, source, created_by_user_id)
          values (${ctx.tenantId}, ${id}, ${no}, ${text!.q}, ${text!.a}, ${text!.c}, ${prior}, ${reason}, 'pos', ${ctx.userId}) returning id`.execute(trx)).rows[0].id;
        sets.push(sql`draft_revision_id = ${revisionId}`);
        // the visible columns follow the newest text ONLY while nothing is live; an approved FAQ keeps its live text
        if (from !== 'approved') sets.push(sql`question = ${text!.q}, answer = ${text!.a}, category = ${text!.c}`);
        event = 'edited';
      } else if (action === 'submit') {
        if (from === 'approved') {
          if (!f.draft_revision_id || f.draft_revision_id === f.approved_revision_id) throw new BusinessSetupError('There is no pending change to submit.', 'AI_FAQ_NOTHING_PENDING', 409);
          sets.push(sql`submitted_at = now()`);
        } else { await move('pending_review'); sets.push(sql`submitted_at = now()`); }
      } else if (action === 'approve') {
        const rev = f.draft_revision_id;
        if (!rev || (from === 'approved' && rev === f.approved_revision_id)) throw new BusinessSetupError('There is nothing waiting for approval.', 'AI_FAQ_NOTHING_PENDING', 409);
        if (from !== 'approved') await move('approved');
        const t: Row = (await sql<Row>`select question, answer, category from ai_receptionist_faq_revisions where tenant_id = ${ctx.tenantId} and id = ${rev}`.execute(trx)).rows[0];
        sets.push(sql`approved_revision_id = ${rev}, draft_revision_id = null, approved_by_user_id = ${ctx.userId}, approved_at = now(), submitted_at = null, is_active = true,
          question = ${t.question}, answer = ${t.answer}, category = ${t.category}`);
        revisionId = rev;
      } else if (action === 'reject') {
        if (from === 'approved') {
          if (!f.draft_revision_id || f.draft_revision_id === f.approved_revision_id) throw new BusinessSetupError('There is no pending change to reject.', 'AI_FAQ_NOTHING_PENDING', 409);
          revisionId = f.draft_revision_id; sets.push(sql`draft_revision_id = null, submitted_at = null`);
        } else { await move('needs_review'); revisionId = f.draft_revision_id; sets.push(sql`submitted_at = null`); }
      } else if (action === 'archive') {
        await move('archived'); sets.push(sql`archived_at = now(), submitted_at = null`);
      } else if (action === 'restore') {
        await move(f.approved_revision_id ? 'needs_review' : 'draft');
        if (f.approved_revision_id && !f.draft_revision_id) sets.push(sql`draft_revision_id = ${f.approved_revision_id}`);
        sets.push(sql`archived_at = null`); event = 'restored';
      }
      if (to !== 'approved') sets.push(sql`is_active = false`);
      sets.push(sql`version = version + 1, updated_at = now(), updated_by_user_id = ${ctx.userId}`);
      const out: Row = (await sql<Row>`update ai_receptionist_faqs set ${sql.join(sets, sql`, `)} where tenant_id = ${ctx.tenantId} and id = ${id} returning version, status`.execute(trx)).rows[0];
      const evName = action === 'archive' ? 'archived' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'submit' ? 'submitted' : event;
      await sql<Row>`insert into ai_receptionist_faq_events (tenant_id, branch_id, faq_id, action, from_status, to_status, revision_id, actor_user_id, reason, idempotency_key)
        values (${ctx.tenantId}, ${f.branch_id ?? null}, ${id}, ${evName}, ${from}, ${out.status}, ${revisionId}, ${ctx.userId}, ${reason}, ${key})`.execute(trx);
      await recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: this.branch(ctx), userId: ctx.userId, role: ctx.role ?? null },
        { module: 'ai_business_setup', action: `faq.${evName}`, resourceType: 'ai_receptionist_faq', resourceId: id, summary: `FAQ ${evName} (${from} → ${out.status})`, reason, metadata: { from, to: out.status, revisionId } });
      return { id, status: String(out.status), version: N(out.version), replayed: false };
    });
  }

  // ── AI knowledge (the voice tool reads this; approved revisions ONLY) ───────────────────────────────────────────────
  async knowledge(tenantId: string, branchId: string | null) {
    const ctx: BsCtx = { tenantId, branchId, userId: 'ai-receptionist' };
    const h = await this.hours(ctx);
    const faqs: Row[] = (await sql<Row>`select f.id, r.id revision_id, r.question, r.answer, r.category from ai_receptionist_faqs f join ai_receptionist_faq_revisions r on r.id = f.approved_revision_id and r.tenant_id = f.tenant_id
      where f.tenant_id = ${tenantId} and f.status = 'approved' and (f.branch_id is null or f.branch_id = ${isUuid(branchId) ? branchId : null}) order by f.approved_at desc nulls last, f.id desc limit 200`.execute(this.db)).rows;
    return { hours: h.source === 'platform_default' ? null : { timezone: h.timezone, week: h.storeHours, source: h.source },
      hoursNote: h.source === 'platform_default' ? 'Business hours are not set up; do not state opening hours — offer to take a message.' : null,
      faqs: faqs.map((x) => ({ id: x.id, revisionId: x.revision_id, question: x.question, answer: x.answer, category: x.category ?? null })) };
  }

  // ── Preview AI Knowledge (guide §10; read-only) ─────────────────────────────────────────────────────────────────────
  async preview(ctx: BsCtx, b: { question?: unknown }) {
    const raw = String(b.question ?? '').trim();
    if (!raw) throw new BusinessSetupError('Type a sample question.', 'AI_PREVIEW_QUESTION_REQUIRED');
    if (raw.length > 300) throw new BusinessSetupError('The question is too long.', 'AI_PREVIEW_QUESTION_REQUIRED');
    const question = redact(raw); const intent = classifyIntent(question);
    const sources: { type: string; id?: string; revisionId?: string; label: string; version?: string }[] = [];
    let answer = '', outcome: 'answered' | 'not_configured' | 'handoff' | 'source_unavailable' = 'handoff';
    let sourceError: string | null = null;
    const kn = await this.knowledge(ctx.tenantId, this.branch(ctx)).catch((e: unknown) => { sourceError = String((e as { code?: string })?.code ?? 'QUERY_FAILED'); return null; });
    const bestFaq = () => { const all = (kn?.faqs ?? []).map((f) => ({ f, s: matchScore(question, f.question + ' ' + (f.category ?? '')) })).sort((x, y) => y.s - x.s); return all[0] && all[0].s >= 0.5 ? all[0].f : null; };
    try {
      if (!kn) { outcome = 'source_unavailable'; answer = 'The business knowledge could not be read right now. The AI would not guess — it would offer to take a message.'; }
      else if (intent === 'hours') {
        if (!kn.hours) { outcome = 'not_configured'; answer = 'Business hours are not set up, so the AI would not state opening hours.'; }
        else {
          const day = DAYS.find((d) => question.toLowerCase().includes(d));
          const fmt = (d: string) => { const x = kn.hours!.week[d]; return x?.isOpen ? `${d[0].toUpperCase() + d.slice(1)}: ${x.openTime}–${x.closeTime}` : `${d[0].toUpperCase() + d.slice(1)}: closed`; };
          answer = day ? fmt(day) + ` (${kn.hours.timezone}).` : DAYS.map(fmt).join('; ') + ` (${kn.hours.timezone}).`;
          answer += ' Holiday closures are not recorded in the system.'; outcome = 'answered';
          sources.push({ type: 'hours', label: kn.hours.source === 'branch' ? 'Store hours (this branch)' : 'Store hours (salon-wide)' });
        }
      } else if (intent === 'price' || intent === 'technician') {
        const svcs = await this.eligibleServices(ctx);
        const svc = svcs.map((s) => ({ s, sc: matchScore(question, s.name) })).sort((x, y) => y.sc - x.sc)[0];
        if (!svc || svc.sc < 0.5) { const faq = bestFaq(); if (faq) { answer = faq.answer; outcome = 'answered'; sources.push({ type: 'faq', id: faq.id, revisionId: faq.revisionId, label: faq.question }); }
          else { answer = 'No bookable service matched that question, so the AI would ask which service the caller means.'; outcome = 'handoff'; } }
        else if (intent === 'price') {
          const p = svc.s.price_cents == null || N(svc.s.price_cents) <= 0 ? null : N(svc.s.price_cents);
          answer = p == null ? `${svc.s.name} has no price set, so the AI would not quote one.` : `${svc.s.name} is $${(p / 100).toFixed(2)}${N(svc.s.duration_minutes) > 0 ? ` and takes about ${N(svc.s.duration_minutes)} minutes` : ''}. Final price is confirmed at checkout.`;
          outcome = p == null ? 'not_configured' : 'answered'; sources.push({ type: 'service', id: svc.s.id, label: svc.s.name });
        } else {
          const b2 = this.branch(ctx);
          const techs: Row[] = (await sql<Row>`select t.id, t.full_name from technicians t join technician_services ts on ts.technician_id = t.id and ts.tenant_id = t.tenant_id and ts.service_id = ${svc.s.id}
            where t.tenant_id = ${ctx.tenantId} and t.is_active and (${b2}::uuid is null or t.branch_id = ${b2} or t.branch_id is null) order by t.full_name, t.id limit 20`.execute(this.db)).rows;
          answer = techs.length ? `Qualified for ${svc.s.name}: ${techs.map((t) => (t.full_name ?? '').split(' ')[0] || 'Technician').join(', ')}. Who is free is checked live when booking.` : `No technician is recorded as qualified for ${svc.s.name}.`;
          outcome = techs.length ? 'answered' : 'not_configured'; sources.push({ type: 'service', id: svc.s.id, label: svc.s.name }); for (const t of techs) sources.push({ type: 'technician', id: t.id, label: 'Qualification' });
        }
      } else if (intent === 'booking') {
        answer = 'In a real call the AI checks live availability with the booking system at that moment. This preview never checks, holds or books a time.'
          + (voiceWriteToolsEnabled(process.env) ? '' : ' Booking actions are not armed, so the AI would hand the booking to staff.');
        outcome = 'handoff'; sources.push({ type: 'booking', label: 'Live availability (not called by the preview)' });
      } else {
        const faq = bestFaq();
        if (faq) { answer = faq.answer; outcome = 'answered'; sources.push({ type: 'faq', id: faq.id, revisionId: faq.revisionId, label: faq.question }); }
        else if (intent === 'policy') { answer = 'No approved answer covers this policy, so the AI would say it will have staff confirm.'; outcome = 'not_configured'; }
        else { answer = 'No approved answer matches this question. The AI would offer to take a message for staff.'; outcome = 'handoff'; }
      }
    } catch (e) { sourceError = String((e as { code?: string })?.code ?? 'QUERY_FAILED'); outcome = 'source_unavailable'; answer = 'A source could not be read, so the AI would not answer this from guesswork.'; }
    const run: Row = (await sql<Row>`insert into ai_business_setup_preview_runs (tenant_id, branch_id, question, intent, answer, outcome, sources, tester_user_id)
      values (${ctx.tenantId}, ${this.branch(ctx)}, ${question}, ${intent}, ${answer}, ${outcome}, ${JSON.stringify(sources)}::jsonb, ${ctx.userId}) returning id, created_at`.execute(this.db)).rows[0];
    return { runId: run.id, isPreview: true, question, intent, outcome, answer, sources, sourceError, createdAt: iso(run.created_at),
      limits: 'Preview only: nothing was booked, held, texted or called, and no voice provider was contacted. Drafts are never used.' };
  }

  // ── search across scopes (guide §05) ────────────────────────────────────────────────────────────────────────────────
  async search(ctx: BsCtx, f: { scope?: string; q?: string; page?: unknown; pageSize?: unknown }) {
    const scope = (SEARCH_SCOPES as readonly string[]).includes(String(f.scope)) ? String(f.scope) : 'faqs';
    const q = String(f.q ?? '').trim().slice(0, 100); const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if (scope === 'faqs') { const r = await this.faqs(ctx, { q, page, pageSize: size }); return { scope, ...r, items: r.items.map((x) => ({ id: x.id, title: x.question, subtitle: x.status, kind: 'faq' })) }; }
    const b = this.branch(ctx); const pat = like(q);
    let total = 0; let rows: Row[] = [];
    if (scope === 'services') {
      const where = sql`(${b}::uuid is null or branch_id = ${b} or branch_id is null) and (${q} = '' or name ilike ${pat} or id::text = ${q})`;
      total = N((await sql<Row>`select count(*)::int n from services where tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select id, name as title, status as subtitle, 'service' kind from services where tenant_id = ${ctx.tenantId} and ${where} order by name asc, id asc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    } else if (scope === 'technicians') {
      const where = sql`(${b}::uuid is null or branch_id = ${b} or branch_id is null) and (${q} = '' or full_name ilike ${pat} or id::text = ${q})`;
      total = N((await sql<Row>`select count(*)::int n from technicians where tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select id, full_name as title, case when is_active then 'active' else 'inactive' end as subtitle, 'technician' kind from technicians where tenant_id = ${ctx.tenantId} and ${where} order by full_name asc, id asc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    } else if (scope === 'tests') {
      const where = sql`(${q} = '' or question ilike ${pat} or answer ilike ${pat} or id::text = ${q})`;
      total = N((await sql<Row>`select count(*)::int n from ai_business_setup_preview_runs where tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select id, question as title, outcome as subtitle, 'test' kind, created_at from ai_business_setup_preview_runs where tenant_id = ${ctx.tenantId} and ${where} order by created_at desc, id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    } else {
      const where = sql`(${q} = '' or e.action ilike ${pat} or coalesce(e.reason, '') ilike ${pat} or f.question ilike ${pat})`;
      total = N((await sql<Row>`select count(*)::int n from ai_receptionist_faq_events e join ai_receptionist_faqs f on f.id = e.faq_id and f.tenant_id = e.tenant_id where e.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select e.faq_id as id, f.question as title, e.action as subtitle, 'history' kind, e.created_at from ai_receptionist_faq_events e join ai_receptionist_faqs f on f.id = e.faq_id and f.tenant_id = e.tenant_id
        where e.tenant_id = ${ctx.tenantId} and ${where} order by e.created_at desc, e.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    }
    return { scope, items: rows.map((r) => ({ id: r.id, title: r.title ?? '', subtitle: r.subtitle ?? null, kind: r.kind, at: r.created_at ? iso(r.created_at) : null })), page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) };
  }

  // ── history (guide §06 date basis: FAQ change / approval / preview test) ───────────────────────────────────────────
  async history(ctx: BsCtx, f: { basis?: string; from?: string; to?: string; page?: unknown; pageSize?: unknown }) {
    const page = pageOf(f.page), size = sizeOf(f.pageSize);
    if ((f.from && !DATE.test(f.from)) || (f.to && !DATE.test(f.to)) || (f.from && f.to && f.to < f.from)) throw new BusinessSetupError('Choose a valid date range.', 'AI_SETUP_INVALID_FILTER');
    const basis = (HISTORY_BASES as readonly string[]).includes(String(f.basis)) ? String(f.basis) : 'faq_change';
    const tz = await this.zone(ctx);
    const lo = f.from ? sql`(${f.from}::date)::timestamp at time zone ${tz}` : sql`'-infinity'::timestamptz`;
    const hi = f.to ? sql`((${f.to}::date + 1))::timestamp at time zone ${tz}` : sql`'infinity'::timestamptz`;
    let total = 0; let rows: Row[] = [];
    if (basis === 'preview') {
      const where = sql`created_at >= ${lo} and created_at < ${hi}`;
      total = N((await sql<Row>`select count(*)::int n from ai_business_setup_preview_runs where tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select id, 'preview' kind, question as title, outcome as detail, created_at from ai_business_setup_preview_runs where tenant_id = ${ctx.tenantId} and ${where} order by created_at desc, id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    } else {
      const only = basis === 'approval' ? sql`and e.action in ('approved', 'rejected')` : sql``;
      const where = sql`e.created_at >= ${lo} and e.created_at < ${hi} ${only}`;
      total = N((await sql<Row>`select count(*)::int n from ai_receptionist_faq_events e where e.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
      rows = (await sql<Row>`select e.faq_id as id, e.action as kind, f.question as title, coalesce(e.to_status, '') as detail, e.created_at from ai_receptionist_faq_events e
        join ai_receptionist_faqs f on f.id = e.faq_id and f.tenant_id = e.tenant_id where e.tenant_id = ${ctx.tenantId} and ${where} order by e.created_at desc, e.id desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    }
    return { basis, timezone: tz, items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title ?? '', detail: r.detail ?? null, at: iso(r.created_at) })), page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) };
  }

  // ── Knowledge Assistant (guide §12; suggestions only — nothing changes until someone acts) ──────────────────────────
  async assistant(ctx: BsCtx) {
    const out: { key: string; kind: string; why: string; affected: { type: string; id: string | null; name: string } | null; impact: string; suggestion: string; action: { label: string; route?: string; draftQuestion?: string } }[] = [];
    const unavailable: string[] = [];
    const miss = (what: string) => (e: unknown) => { unavailable.push(`${what}:${String((e as { code?: string })?.code ?? 'QUERY_FAILED')}`); };
    const h = await this.hours(ctx).catch((e: unknown) => { miss('hours')(e); return null; });
    if (h && h.source === 'platform_default') out.push({ key: 'hours_not_saved', kind: 'hours', why: 'Store hours were never saved; the AI only sees the platform default week.', affected: null, impact: 'The AI cannot tell callers when you are open.', suggestion: 'Save your real weekly hours.', action: { label: 'Edit store hours', route: '/settings?section=auto-logout' } });
    const svcs = await this.eligibleServices(ctx).catch((e: unknown) => { miss('services')(e); return [] as Row[]; });
    for (const s of svcs.slice(0, 200)) {
      if (s.price_cents == null || N(s.price_cents) <= 0) out.push({ key: `service_price:${s.id}`, kind: 'service', why: 'This bookable service has no price.', affected: { type: 'service', id: s.id, name: s.name }, impact: 'The AI will not quote a price for it.', suggestion: 'Add the price in Services & Products.', action: { label: 'Open Services', route: '/services' } });
      if (N(s.duration_minutes) <= 0) out.push({ key: `service_duration:${s.id}`, kind: 'service', why: 'This bookable service has no duration.', affected: { type: 'service', id: s.id, name: s.name }, impact: 'Availability cannot be computed correctly.', suggestion: 'Add the duration in Services & Products.', action: { label: 'Open Services', route: '/services' } });
    }
    const unq: Row[] = svcs.length ? (await sql<Row>`select s.id, s.name from services s where s.tenant_id = ${ctx.tenantId} and s.id = any(${svcs.map((x) => x.id)}::uuid[])
        and not exists (select 1 from technician_services ts join technicians t on t.id = ts.technician_id and t.is_active where ts.tenant_id = s.tenant_id and ts.service_id = s.id) order by s.name limit 50`.execute(this.db).catch((e: unknown) => { miss('qualifications')(e); return { rows: [] as Row[] }; })).rows : [];
    for (const s of unq) out.push({ key: `service_no_tech:${s.id}`, kind: 'qualification', why: 'No active technician is recorded as qualified for this service.', affected: { type: 'service', id: s.id, name: s.name }, impact: 'The AI cannot name who performs it.', suggestion: 'Add qualified technicians in Team Management.', action: { label: 'Open Team', route: '/technicians' } });
    const techs = await this.eligibleTechnicians(ctx).catch((e: unknown) => { miss('technicians')(e); return [] as Row[]; });
    for (const t of techs.slice(0, 100)) {
      if (!t.qualified) out.push({ key: `tech_no_services:${t.id}`, kind: 'qualification', why: 'This active technician has no service qualification.', affected: { type: 'technician', id: t.id, name: t.full_name ?? 'Technician' }, impact: 'They are never matched to a service.', suggestion: 'Add the services they perform.', action: { label: 'Open Team', route: '/technicians' } });
      if (!t.scheduled) out.push({ key: `tech_no_schedule:${t.id}`, kind: 'schedule', why: 'This active technician has no working schedule.', affected: { type: 'technician', id: t.id, name: t.full_name ?? 'Technician' }, impact: 'They will not appear as available.', suggestion: 'Set their weekly schedule.', action: { label: 'Open Staff Schedule', route: '/technicians' } });
    }
    const faqs: Row[] = (await sql<Row>`select f.id, f.question, f.answer, f.status, f.submitted_at from ai_receptionist_faqs f where f.tenant_id = ${ctx.tenantId} and f.status <> 'archived'`.execute(this.db).catch((e: unknown) => { miss('faqs')(e); return { rows: [] as Row[] }; })).rows;
    const text = faqs.map((f) => `${f.question} ${f.answer}`).join(' \n ');
    for (const g of FAQ_GAP_TOPICS) if (!g.words.test(text)) out.push({ key: `faq_gap:${g.key}`, kind: 'faq', why: 'Callers often ask this and no FAQ covers it.', affected: null, impact: 'The AI will hand these questions off.', suggestion: `Write and approve an answer to "${g.question}". The answer must come from you — the assistant never invents a policy.`, action: { label: 'Draft this FAQ', draftQuestion: g.question } });
    const prices = new Set(svcs.map((s) => N(s.price_cents)).filter((p) => p > 0));
    for (const f of faqs) {
      const amts = [...String(f.answer).matchAll(/\$\s?(\d{1,4}(?:\.\d{2})?)/g)].map((m) => Math.round(Number(m[1]) * 100));
      if (f.status === 'approved' && amts.length && prices.size && amts.some((a) => !prices.has(a))) out.push({ key: `faq_price:${f.id}`, kind: 'faq', why: 'This approved answer mentions a price no current service has.', affected: { type: 'faq', id: f.id, name: f.question }, impact: 'The AI may quote an outdated price.', suggestion: 'Review the answer against Services & Products.', action: { label: 'Open FAQ' } });
      if (f.status === 'pending_review' && f.submitted_at && Date.now() - new Date(f.submitted_at).getTime() > 7 * 86400000) out.push({ key: `faq_waiting:${f.id}`, kind: 'faq', why: 'This FAQ has waited for approval for more than 7 days.', affected: { type: 'faq', id: f.id, name: f.question }, impact: 'The AI cannot use it until it is approved.', suggestion: 'Approve or send it back.', action: { label: 'Open FAQ' } });
    }
    return { generatedAt: nowIso(), suggestions: out, unavailable, note: 'Suggestions only. Nothing changes until an owner or manager acts; prices, services, schedules and phone routing are never changed by the assistant.' };
  }
}
function iso(v: unknown): string | null { return v ? new Date(v as string).toISOString() : null; }
