// duplicate-review-center.ts — Duplicate Review (guides FULL + COMPLETE, Nov 1 2026): `/pos/duplicate-review/*`.
//
// The human-review workspace over possible duplicate customer profiles. It owns only REVIEW records (scans, candidate
// groups, the append-only event timeline, merge operations, health runs — migration 761). Identity stays in Customer
// Management (customers); bookings in Booking (pos_tech_appointments); completed work in Service Done / Checkout
// (tickets); points in the Loyalty ledger; plans in Memberships; stored value in Gift Cards; consent on the profile.
//
// Detection (`scan`): set-based SQL over the live directory — groups of profiles sharing a stored phone
// (customers.normalized_phone, written by toStoredCustomerPhone), a trimmed lower-case email, or a Vietnamese-folded full
// name. Each distinct member set is ONE group with a stable id (not the old positional "dup_1", which could point at a
// different group between preview and merge). Keys shared by more than DR_MAX_KEY_MEMBERS profiles are counted, not
// grouped. Groups are never chained together (A~B by phone and B~C by name stay two groups).
//
// Merging: preview (read-only, recorded as a `merge_previewed` event carrying a hash of the current state) → confirm with
// that hash + an idempotency key + every required acknowledgement. Confirm re-computes the preview inside the merge
// transaction under a group lock; any change (a new appointment on the source, an edited profile, a concurrent merge)
// changes the hash and the merge is refused as stale. The merge itself is the canonical customer merge
// (customers/customer-merge.ts), and the group status, merge operation, event and audit commit in the SAME transaction.
// A failed attempt changes nothing and is recorded afterwards as a failed operation + `merge_failed` event.
//
// Never: an automatic merge, a money movement, a refund, a cancelled membership or booking, a message, or consent copied
// from one profile to another. The health check only reads.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_DUPLICATE_GROUP, CUSTOMER_DUPLICATE_SCAN } from '../customer-lifecycles';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { OutboxWriter } from '@aipowersalon/events';
import { VISIT_TICKET_STATUSES } from '../customers/customer-segments';
import { toStoredCustomerPhone } from '../customer-activation-rules/customer-activation-core';
import { RetentionRepository, isUuid, maskPhone, maskEmail, type RetentionContext, type BranchScope } from '../retention/retention.repository';
import { mergeCustomersTx, MERGE_REASSIGN_TABLES, CustomerMergeError } from '../customers/customer-merge';
import { loadMergeSnapshot, assessUnmerge, unmergeCustomersTx, CustomerUnmergeError } from '../customers/customer-unmerge';
import type { CustomerMergeRecordPage, CustomerUnmergeCheck, CustomerUnmergeResult } from '@aipowersalon/api-contracts/tenant';
import {
  DR_RULE_VERSION, DR_OPEN_STATUSES, DR_STATUS_FILTERS, DR_CONFIDENCES, DR_REASONS, DR_DATE_FIELDS, DR_PRESETS, DR_SORTS, DR_PAGE_SIZES,
  DR_EVENT_TYPES, DR_DECISIONS, DR_MAX_KEY_MEMBERS, DR_SCAN_MIN_GAP_SECONDS, DR_STALE_AFTER_MINUTES, DR_PREVIEW_TTL_MINUTES, DR_HEALTH_GAP_SECONDS,
  assessEvidence, classifyConfidence, groupKeyOf, evidenceHashOf, stableHash, pairsOf, presetRange, type MemberSignals, type Evidence,
} from './duplicate-review-core';

type Row = Record<string, any>;
const log = new Logger('DuplicateReview');
export type DrCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;

export class DuplicateReviewError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

const VISIT = [...VISIT_TICKET_STATUSES] as string[];
const CLOSED_TICKET = ['paid', 'closed', 'completed', 'void', 'voided', 'canceled', 'cancelled', 'refunded'];
const UPCOMING_APPT = ['booked', 'confirmed'];
const IN_SALON_APPT = ['arrived', 'checked_in', 'waiting', 'in_service'];
const ENDED_APPT = ['cancelled', 'no_show'];
const ACTIVE_MEMBERSHIP = ['active', 'trial', 'grace', 'past_due', 'paused', 'pending', 'canceling', 'comped'];
const LIVE_GIFT_CARD = ['active', 'delivered', 'claimed', 'partially_redeemed', 'scheduled', 'frozen', 'suspended'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DR_REQUIRED_INDEXES = ['ix_customers_normalized_phone', 'ix_customers_tenant_email_norm', 'ix_customers_tenant_name_fold',
  'ix_customer_duplicate_groups_detected', 'uq_customer_duplicate_merge_ops_one_merge'] as const;
/** what a reviewer must explicitly acknowledge before a merge (guide §11/§14) — conflicts that do not block */
export const DR_ACK_CODES = ['NAME_ONLY', 'CONTACT_CONFLICT', 'CONSENT_DIFFERS', 'LOYALTY_ON_BOTH', 'FUTURE_APPOINTMENTS', 'GIFT_CARDS_MOVE',
  'MEMBERSHIP_MOVES', 'PAYMENT_METHODS_MOVE'] as const;
export const DR_BLOCKER_CODES = ['GROUP_CLOSED', 'MEMBER_ARCHIVED', 'OUT_OF_SCOPE', 'OPEN_TICKET', 'IN_SALON_NOW', 'MEMBERSHIP_CONFLICT'] as const;

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
const nameOf = (r: Row) => String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim();

export interface DrListQuery {
  q?: unknown; status?: unknown; confidence?: unknown; reason?: unknown; branch?: unknown;
  dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown;
}
export interface DrHistoryQuery { groupId?: unknown; customerId?: unknown; eventType?: unknown; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }
export type DrCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface DrCheck { key: string; state: DrCheckState; evidence: string; action: string | null; count?: number | null; lastGoodAt?: string | null }

export class DuplicateReviewCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null, private readonly now: () => number = () => Date.now()) {
    this.ret = new RetentionRepository(db);
  }

  // ── shared pieces ─────────────────────────────────────────────────────────────────────────────────────────────
  private async scope(ctx: DrCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new DuplicateReviewError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'DUPLICATE_INVALID_BRANCH', e?.status ?? 400); }
  }
  /** a customer the session may see (CR-02: home branch OR activity in an authorized branch); alias `c` */
  private custVisible(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  /** a group the session may see: at least one member visible (alias `g`) */
  private groupVisible(T: string, s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    return sql`exists (select 1 from customers c where c.tenant_id = ${T} and c.id = any(g.member_ids) and ${this.custVisible(s)})`;
  }
  private async salonToday(ctx: DrCtx): Promise<{ today: string; tz: string }> {
    const w = await this.ret.window(ctx, { preset: 'today' });
    return { today: w.today, tz: w.tz };
  }
  /** the date filter, as [start, end) instants of the salon's local days (inclusive start, exclusive next-day end) */
  private async period(ctx: DrCtx, f: { preset?: unknown; from?: unknown; to?: unknown }): Promise<{ preset: string; from: string | null; to: string | null; start: Date | null; end: Date | null; today: string; tz: string }> {
    const preset = pick(DR_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const { today, tz } = await this.salonToday(ctx);
    if (preset === 'all') return { preset, from: null, to: null, start: null, end: null, today, tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new DuplicateReviewError('Choose a From and a To date.', 'DUPLICATE_INVALID_PERIOD');
      if (a > b) throw new DuplicateReviewError('The From date must be on or before the To date.', 'DUPLICATE_INVALID_PERIOD');
      if (Date.parse(b) - Date.parse(a) > 1000 * 86400 * 366 * 10) throw new DuplicateReviewError('Choose a range of ten years or less.', 'DUPLICATE_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = presetRange(preset, today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s), end: new Date(b.e), today, tz };
  }
  private async event(ex: Kysely<any>, T: string, groupId: string, type: (typeof DR_EVENT_TYPES)[number], actor: string | null, note: string | null, payload: Record<string, unknown> = {}) {
    await sql`insert into customer_duplicate_events (tenant_id, group_id, event_type, actor_user_id, note, payload)
      values (${T}, ${groupId}, ${type}, ${uuidOrNull(actor)}, ${note}, ${JSON.stringify(payload)}::jsonb)`.execute(ex);
  }

  // ── detection ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Scan the live directory and reconcile candidate groups. Rate-limited: within DR_SCAN_MIN_GAP_SECONDS of a completed
   *  scan the last one is returned (`reused: true`). Never changes a customer. */
  async scan(ctx: DrCtx, trigger: 'manual' | 'auto' | 'scheduled' = 'manual') {
    const T = ctx.tenantId;
    const scanId = randomUUID();
    let started = false;
    try {
      const out = await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('duplicate-review-scan:' || ${T}))`.execute(trx);
        const last = (await sql<Row>`select id, status, finished_at, customers_scanned, groups_found, groups_new, groups_reopened, groups_resolved, oversized_keys, rule_version
          from customer_duplicate_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(trx)).rows[0];
        if (last && last.rule_version === DR_RULE_VERSION && this.now() - new Date(last.finished_at).getTime() < DR_SCAN_MIN_GAP_SECONDS * 1000)
          return { reused: true, scan: this.scanOut(last) };
        await sql`insert into customer_duplicate_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version) values (${scanId}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${DR_RULE_VERSION})`.execute(trx);
        started = true;
        const res = await this.detect(trx, T, scanId, ctx.userId);
        await sql`update customer_duplicate_scans set status = 'completed', finished_at = now(), customers_scanned = ${res.scanned}, groups_found = ${res.found},
          groups_new = ${res.created}, groups_reopened = ${res.reopened}, groups_resolved = ${res.resolved}, oversized_keys = ${res.oversized}
          where id = ${scanId} and tenant_id = ${T} and ${canMoveToSql(CUSTOMER_DUPLICATE_SCAN, 'completed')}`.execute(trx);
        const row = (await sql<Row>`select id, status, finished_at, customers_scanned, groups_found, groups_new, groups_reopened, groups_resolved, oversized_keys, rule_version from customer_duplicate_scans where tenant_id = ${T} and id = ${scanId}`.execute(trx)).rows[0];
        return { reused: false, scan: this.scanOut(row) };
      });
      return out;
    } catch (e: any) {
      // the scan's own writes rolled back: record the failure so the workspace never shows a dead scanner as "no duplicates"
      await sql`insert into customer_duplicate_scans (id, tenant_id, actor_user_id, trigger_kind, rule_version, status, finished_at, error_code)
        values (${randomUUID()}, ${T}, ${uuidOrNull(ctx.userId)}, ${trigger}, ${DR_RULE_VERSION}, 'failed', now(), ${String(e?.code ?? 'SCAN_FAILED').slice(0, 60)})`.execute(this.db)
        .catch((err: unknown) => log.warn(`could not record a failed duplicate scan: ${(err as Error)?.message ?? err}`));
      if (e instanceof DuplicateReviewError) throw e;
      throw new DuplicateReviewError('The duplicate scan could not finish. Nothing was changed.', 'DUPLICATE_SCAN_FAILED', 503, { started });
    }
  }
  private scanOut(r: Row) {
    return { id: r.id, status: r.status, finishedAt: iso(r.finished_at), customersScanned: N(r.customers_scanned), groupsFound: N(r.groups_found),
      groupsNew: N(r.groups_new), groupsReopened: N(r.groups_reopened), groupsResolved: N(r.groups_resolved), oversizedKeys: N(r.oversized_keys), ruleVersion: r.rule_version };
  }

  private async detect(trx: Kysely<any>, T: string, scanId: string, actor: string) {
    const keys = (await sql<Row>`with live as (
        select id, nullif(btrim(normalized_phone), '') as p, nullif(lower(btrim(email)), '') as e,
               nullif(vi_fold(lower(btrim(coalesce(full_name, first_name || ' ' || coalesce(last_name, ''))))), '') as n
        from customers where tenant_id = ${T} and archived_at is null)
      select 'phone' as reason, array_agg(id order by id)::text[] as ids, count(*)::int as cnt from live where p is not null group by p having count(*) >= 2
      union all select 'email', array_agg(id order by id)::text[], count(*)::int from live where e is not null group by e having count(*) >= 2
      union all select 'name', array_agg(id order by id)::text[], count(*)::int from live where n is not null and length(replace(n, ' ', '')) >= 3 group by n having count(*) >= 2`.execute(trx)).rows;
    const scanned = N((await sql<Row>`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null`.execute(trx)).rows[0]?.n);
    let oversized = 0;
    const sets = new Map<string, { ids: string[]; reasons: Set<string> }>();
    for (const k of keys) {
      if (N(k.cnt) > DR_MAX_KEY_MEMBERS) { oversized++; continue; }
      const ids = (k.ids as string[]).map(String).sort();
      const key = groupKeyOf(ids);
      const cur = sets.get(key) ?? { ids, reasons: new Set<string>() };
      cur.reasons.add(String(k.reason)); sets.set(key, cur);
    }
    const allIds = [...new Set([...sets.values()].flatMap((s) => s.ids))];
    const sig = new Map<string, MemberSignals>();
    if (allIds.length) {
      const rows = (await sql<Row>`select id, nullif(btrim(normalized_phone), '') as p, nullif(lower(btrim(email)), '') as e,
          nullif(vi_fold(lower(btrim(coalesce(full_name, first_name || ' ' || coalesce(last_name, ''))))), '') as n, phone_verified_at
        from customers where tenant_id = ${T} and id = any(${allIds}::uuid[])`.execute(trx)).rows;
      for (const r of rows) sig.set(String(r.id), { id: String(r.id), phone: r.p, email: r.e, nameKey: r.n, phoneVerified: r.phone_verified_at != null });
    }
    const existing = new Map<string, Row>();
    const keyList = [...sets.keys()];
    if (keyList.length) for (const r of (await sql<Row>`select id, group_key, status, evidence_hash, version from customer_duplicate_groups where tenant_id = ${T} and group_key = any(${keyList}::text[])`.execute(trx)).rows) existing.set(String(r.group_key), r);
    const decided = new Map<string, string>();
    for (const r of (await sql<Row>`select customer_a, customer_b, decision from customer_duplicate_decisions where tenant_id = ${T}`.execute(trx)).rows) decided.set(`${r.customer_a}|${r.customer_b}`, String(r.decision));

    let created = 0, reopened = 0;
    const seenIds: string[] = [];
    for (const [key, s] of sets) {
      const members = s.ids.map((id) => sig.get(id)).filter((m): m is MemberSignals => !!m);
      if (members.length < 2) continue;
      const ev: Evidence = assessEvidence(members);
      const conf = classifyConfidence(ev);
      const evHash = evidenceHashOf(ev);
      const reasons = DR_REASONS.filter((r) => s.reasons.has(r));
      const pairs = pairsOf(s.ids).map(([a, b]) => decided.get(`${a}|${b}`));
      const allKept = pairs.length > 0 && pairs.every((d) => d === 'keep_separate');
      const anyNotSure = pairs.some((d) => d === 'not_sure');
      const prev = existing.get(key);
      if (!prev) {
        const status = allKept ? 'kept_separate' : anyNotSure ? 'deferred' : 'pending';
        const row = (await sql<Row>`insert into customer_duplicate_groups (tenant_id, group_key, member_ids, member_count, reasons, confidence, rule_version, evidence, evidence_hash, status, last_scan_id)
          values (${T}, ${key}, ${s.ids}::uuid[], ${s.ids.length}, ${reasons}::text[], ${conf}, ${DR_RULE_VERSION}, ${JSON.stringify(ev)}::jsonb, ${evHash}, ${status}, ${scanId})
          returning id`.execute(trx)).rows[0];
        await this.event(trx, T, row.id, 'detected', null, null, { reasons, confidence: conf, ruleVersion: DR_RULE_VERSION, status, scanId });
        seenIds.push(String(row.id)); created++;
        continue;
      }
      seenIds.push(String(prev.id));
      const changed = prev.evidence_hash !== evHash;
      let status = String(prev.status);
      let reopen: string | null = null;
      if (status === 'merged') continue;   // a merged group's sources are archived; it cannot reappear with the same member set
      if (status === 'resolved') reopen = 'detected_again';
      else if (status === 'kept_separate' && changed) reopen = 'new_evidence';   // material change: never silently overridden, re-reviewed
      if (reopen) {
        status = 'pending';
        if (reopen === 'new_evidence') for (const [a, b] of pairsOf(s.ids)) await sql`delete from customer_duplicate_decisions where tenant_id = ${T} and customer_a = ${a} and customer_b = ${b} and decision = 'keep_separate'`.execute(trx);
      }
      await sql`update customer_duplicate_groups set reasons = ${reasons}::text[], confidence = ${conf}, rule_version = ${DR_RULE_VERSION}, evidence = ${JSON.stringify(ev)}::jsonb,
          evidence_hash = ${evHash}, status = ${status}, last_seen_at = now(), last_scan_id = ${scanId},
          updated_at = case when ${changed || !!reopen} then now() else updated_at end, updated_by = case when ${changed || !!reopen} then null else updated_by end, version = version + case when ${changed || !!reopen} then 1 else 0 end
        where id = ${prev.id} and tenant_id = ${T} and ${canMoveToSql(CUSTOMER_DUPLICATE_GROUP, status)}`.execute(trx);
      if (reopen) { await this.event(trx, T, prev.id, 'reopened', null, null, { from: prev.status, reason: reopen, confidence: conf, scanId }); reopened++; }
    }
    // open groups this scan no longer finds (a profile was edited, archived or merged elsewhere): resolved, history kept
    const gone = (await sql<Row>`update customer_duplicate_groups set status = 'resolved', updated_at = now(), updated_by = null, version = version + 1
      where tenant_id = ${T} and status = any(${[...DR_OPEN_STATUSES]}::text[]) and ${canMoveToSql(CUSTOMER_DUPLICATE_GROUP, 'resolved')} and not (id = any(${seenIds}::uuid[])) returning id`.execute(trx)).rows;
    for (const g of gone) await this.event(trx, T, g.id, 'resolved', null, null, { reason: 'no_longer_detected', scanId });
    void actor;
    return { scanned, found: sets.size, created, reopened, resolved: gone.length, oversized };
  }

  /** what the workspace says about its own data (guide §02: real freshness, never a static "Live") */
  async freshness(ctx: DrCtx) {
    const T = ctx.tenantId;
    const rows = (await sql<Row>`select status, started_at, finished_at, error_code, rule_version from customer_duplicate_scans where tenant_id = ${T} order by started_at desc limit 5`.execute(this.db)).rows;
    const lastOk = rows.find((r) => r.status === 'completed') ?? (await sql<Row>`select finished_at, rule_version from customer_duplicate_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
    const latest = rows[0];
    const ageMin = lastOk?.finished_at ? Math.floor((this.now() - new Date(lastOk.finished_at).getTime()) / 60000) : null;
    let state: 'never' | 'up_to_date' | 'stale' | 'failed' | 'running' = 'never';
    if (latest?.status === 'running') state = 'running';
    else if (latest?.status === 'failed') state = 'failed';
    else if (lastOk) state = lastOk.rule_version !== DR_RULE_VERSION || (ageMin ?? 0) >= DR_STALE_AFTER_MINUTES ? 'stale' : 'up_to_date';
    return { state, lastScanAt: iso(latest?.finished_at ?? latest?.started_at), lastSuccessAt: iso(lastOk?.finished_at), lastError: latest?.status === 'failed' ? latest.error_code : null,
      minutesSinceSuccess: ageMin, ruleVersion: DR_RULE_VERSION, staleAfterMinutes: DR_STALE_AFTER_MINUTES };
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: DrCtx, f: { branch?: unknown } = {}) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const r = (await sql<Row>`select
        count(*) filter (where g.status = any(${[...DR_OPEN_STATUSES]}::text[]))::int as open,
        count(*) filter (where g.status = 'pending')::int as pending,
        count(*) filter (where g.status = 'in_review')::int as in_review,
        count(*) filter (where g.status = any(${[...DR_OPEN_STATUSES]}::text[]) and g.confidence in ('exact', 'strong'))::int as high_confidence,
        count(*) filter (where g.status = 'deferred')::int as deferred,
        count(*) filter (where g.status = 'kept_separate')::int as kept_separate,
        count(*) filter (where g.status = 'merged')::int as merged,
        count(*) filter (where g.status = 'merged' and g.merged_at >= now() - interval '30 days')::int as merged_30d,
        count(*) filter (where g.status = 'failed')::int as failed,
        max(g.detected_at) as latest_detected_at
      from customer_duplicate_groups g where g.tenant_id = ${T} and ${this.groupVisible(T, s)}`.execute(this.db)).rows[0] ?? {};
    return {
      kpis: { open: N(r.open), pending: N(r.pending), inReview: N(r.in_review), highConfidence: N(r.high_confidence), deferred: N(r.deferred),
        keptSeparate: N(r.kept_separate), merged: N(r.merged), merged30d: N(r.merged_30d), failed: N(r.failed) },
      latestDetectedAt: iso(r.latest_detected_at),
      definitions: { open: 'pending + in review + deferred + failed', highConfidence: 'open groups labelled Exact or Strong (rule ' + DR_RULE_VERSION + ')' },
      scope: { label: s.label, confined: s.confined },
      freshness: await this.freshness(ctx),
    };
  }

  // ── queue ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: DrCtx, f: DrListQuery, opts: { fullContact: boolean }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const status = pick(DR_STATUS_FILTERS, f.status) ?? 'open';
    const confidence = pick(DR_CONFIDENCES, f.confidence);
    const reason = pick(DR_REASONS, f.reason);
    const dateField = pick(DR_DATE_FIELDS, f.dateField) ?? 'detected';
    const sort = pick(DR_SORTS, f.sort) ?? 'newest';
    const pageSize = (DR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const p = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new DuplicateReviewError('Type at least 2 characters.', 'DUPLICATE_SEARCH_TOO_SHORT');

    const where = [sql`g.tenant_id = ${T}`, this.groupVisible(T, s)];
    if (status === 'open') where.push(sql`g.status = any(${[...DR_OPEN_STATUSES]}::text[])`);
    else if (status !== 'all') where.push(sql`g.status = ${status}`);
    if (confidence) where.push(sql`g.confidence = ${confidence}`);
    if (reason) where.push(sql`${reason} = any(g.reasons)`);
    if (p.start && p.end) {
      const col = dateField === 'updated' ? sql`g.updated_at` : dateField === 'reviewed' ? sql`g.reviewed_at` : dateField === 'merged' ? sql`g.merged_at` : sql`g.detected_at`;
      if (dateField === 'customer_created') where.push(sql`exists (select 1 from customers c where c.tenant_id = ${T} and c.id = any(g.member_ids) and c.created_at >= ${p.start} and c.created_at < ${p.end})`);
      else where.push(sql`${col} >= ${p.start} and ${col} < ${p.end}`);
    }
    let rank: ReturnType<typeof sql> | null = null;
    if (q) {
      const digits = q.replace(/\D/g, '');
      const stored = toStoredCustomerPhone(q) ?? null;
      const conds = [];
      if (isUuid(`${q}`)) conds.push(sql`(g.id = ${q}::uuid or ${q}::uuid = any(g.member_ids)
          or exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.id = ${q}::uuid and a.customer_id = any(g.member_ids))
          or exists (select 1 from tickets t where t.tenant_id = ${T} and t.id = ${q}::uuid and t.customer_id = any(g.member_ids)))`);
      else {
        const memberMatch = [];
        if (q.includes('@')) memberMatch.push(sql`c.email ilike ${'%' + likeEsc(q) + '%'}`);
        if (stored) memberMatch.push(sql`c.normalized_phone = ${stored}`);
        if (digits.length >= 4 && digits.length >= q.replace(/[\s()+.-]/g, '').length) memberMatch.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`);
        if (!q.includes('@')) memberMatch.push(sql`vi_fold(coalesce(c.full_name, c.first_name || ' ' || coalesce(c.last_name, ''))) ilike ${'%'} || vi_fold(${likeEsc(q)}::text) || ${'%'}`);
        conds.push(sql`exists (select 1 from customers c where c.tenant_id = ${T} and c.id = any(g.member_ids) and (${sql.join(memberMatch, sql` or `)}))`);
      }
      where.push(sql`(${sql.join(conds, sql` or `)})`);
      if (isUuid(`${q}`)) rank = sql`case when g.id = ${q}::uuid then 0 else 1 end`;
    }
    const W = sql.join(where, sql` and `);
    const order = sort === 'oldest' ? sql`g.detected_at asc, g.id asc`
      : sort === 'confidence' ? sql`case g.confidence when 'exact' then 0 when 'strong' then 1 else 2 end, g.detected_at desc, g.id desc`
      : sort === 'members' ? sql`g.member_count desc, g.detected_at desc, g.id desc`
      : sort === 'updated' ? sql`g.updated_at desc, g.id desc`
      : sql`g.detected_at desc, g.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from customer_duplicate_groups g where g.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select g.id, g.member_ids::text[] as member_ids, g.member_count, g.reasons, g.confidence, g.rule_version, g.evidence, g.status, g.assigned_to,
        g.due_on::text as due_on, g.detected_at, g.updated_at, g.reviewed_at, g.merged_at, g.survivor_id, g.version
      from customer_duplicate_groups g where g.tenant_id = ${T} and ${W} order by ${rank ? sql`${rank}, ${order}` : order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const memberIds = [...new Set(rows.flatMap((r) => r.member_ids as string[]))];
    const members = new Map<string, Row>();
    if (memberIds.length) {
      for (const m of (await sql<Row>`select c.id, c.first_name, c.last_name, c.full_name, c.normalized_phone, c.phone_display, c.email, c.status, c.archived_at, c.created_at,
            (select count(*)::int from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])) as visits
          from customers c where c.tenant_id = ${T} and c.id = any(${memberIds}::uuid[])`.execute(this.db)).rows) members.set(String(m.id), m);
    }
    return {
      items: rows.map((g) => ({
        id: g.id, status: g.status, confidence: g.confidence, reasons: g.reasons, memberCount: N(g.member_count), ruleVersion: g.rule_version,
        why: (g.evidence?.why ?? []) as string[], signals: g.evidence?.signals ?? [], version: N(g.version),
        detectedAt: iso(g.detected_at), updatedAt: iso(g.updated_at), reviewedAt: iso(g.reviewed_at), mergedAt: iso(g.merged_at),
        survivorId: g.survivor_id ?? null, assignedTo: g.assigned_to ?? null, dueOn: g.due_on ?? null,
        members: (g.member_ids as string[]).map((id) => {
          const m = members.get(id);
          if (!m) return { customerId: id, name: null, phone: null, email: null, visits: null, archived: true, createdAt: null };
          return { customerId: id, name: nameOf(m) || null, archived: m.archived_at != null, createdAt: iso(m.created_at), visits: N(m.visits),
            phone: m.normalized_phone ? (opts.fullContact ? (m.phone_display || m.normalized_phone) : maskPhone(m.normalized_phone)) : null,
            email: m.email ? (opts.fullContact ? m.email : maskEmail(m.email)) : null };
        }),
      })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, status, confidence: confidence ?? null, reason: reason ?? null, dateField, preset: p.preset, from: p.from, to: p.to, sort },
      period: { from: p.from, to: p.to, timeZone: p.tz, today: p.today },
      freshness: await this.freshness(ctx),
      contact: opts.fullContact ? 'full' : 'masked',
    };
  }

  // ── comparison (Customer 360 side by side) ────────────────────────────────────────────────────────────────────
  private async loadGroup(ex: Kysely<any>, T: string, id: string, forUpdate = false): Promise<Row> {
    if (!isUuid(`${id}`)) throw new DuplicateReviewError('Duplicate group not found.', 'DUPLICATE_GROUP_NOT_FOUND', 404);
    const g = (forUpdate
      ? await sql<Row>`select id, tenant_id, group_key, member_ids::text[] as member_ids, member_count, reasons, confidence, rule_version, evidence, evidence_hash, status, assigned_to, due_on, detected_at, updated_at, last_seen_at, reviewed_at, reviewed_by, merged_at, survivor_id, merge_op_id, version from customer_duplicate_groups where tenant_id = ${T} and id = ${id}::uuid for update`.execute(ex)
      : await sql<Row>`select id, tenant_id, group_key, member_ids::text[] as member_ids, member_count, reasons, confidence, rule_version, evidence, evidence_hash, status, assigned_to, due_on, detected_at, updated_at, last_seen_at, reviewed_at, reviewed_by, merged_at, survivor_id, merge_op_id, version from customer_duplicate_groups where tenant_id = ${T} and id = ${id}::uuid`.execute(ex)).rows[0];
    if (!g) throw new DuplicateReviewError('Duplicate group not found.', 'DUPLICATE_GROUP_NOT_FOUND', 404);
    return g;
  }
  private async assertVisible(ex: Kysely<any>, ctx: DrCtx, s: BranchScope, ids: string[], all: boolean) {
    if (!s.branchIds) return;
    const n = N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${ctx.tenantId} and c.id = any(${ids}::uuid[]) and ${this.custVisible(s)}`.execute(ex)).rows[0]?.n);
    if (all ? n < ids.length : n === 0) throw new DuplicateReviewError('This group includes a customer outside your branches.', 'DUPLICATE_OUT_OF_SCOPE', 403);
  }
  /** per-member facts from each system of record (counts and references — never card data) */
  private async memberFacts(ex: Kysely<any>, T: string, ids: string[], today: string): Promise<Map<string, Row>> {
    const rows = (await sql<Row>`select c.id, c.first_name, c.last_name, c.full_name, c.normalized_phone, c.phone_display, c.email, c.phone_verified_at, c.status, c.archived_at,
        c.created_at, c.updated_at, c.record_version, c.branch_id, b.name as branch_name, c.marketing_sms_opt_in, c.marketing_email_opt_in, c.marketing_opt_in,
        (c.notes is not null and btrim(c.notes) <> '') as has_notes, pt.full_name as preferred_technician,
        (select count(*)::int from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])) as visits,
        (select max(coalesce(t.paid_at, t.created_at)) from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[])) as last_visit,
        (select count(*)::int from tickets t where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and not (t.status = any(${CLOSED_TICKET}::text[]))) as open_tickets,
        (select count(*)::int from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.status = any(${UPCOMING_APPT}::text[]) and a.appt_date >= ${today}::date) as upcoming,
        (select min(a.appt_date)::text from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.status = any(${UPCOMING_APPT}::text[]) and a.appt_date >= ${today}::date) as next_appt,
        (select count(*)::int from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.status = any(${IN_SALON_APPT}::text[]) and a.appt_date = ${today}::date) as in_salon,
        (select count(*)::int from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = c.id and a.status = any(${ENDED_APPT}::text[])) as canceled_no_show,
        (select tt.full_name from tickets t join technicians tt on tt.tenant_id = t.tenant_id and tt.id = t.primary_technician_id
           where t.tenant_id = ${T} and t.customer_id = c.id and t.removed_at is null and t.status = any(${VISIT}::text[]) order by coalesce(t.paid_at, t.created_at) desc limit 1) as last_technician,
        lp.points_balance, lp.loyalty_tier,
        (select count(*)::int from customer_memberships m where m.tenant_id = ${T} and m.customer_id = c.id and m.status = any(${ACTIVE_MEMBERSHIP}::text[])) as active_memberships,
        (select count(*)::int from gift_cards gc where gc.tenant_id = ${T} and gc.customer_id = c.id and gc.status = any(${LIVE_GIFT_CARD}::text[]) and gc.balance_cents > 0) as gift_cards,
        (select coalesce(sum(gc.balance_cents), 0)::bigint from gift_cards gc where gc.tenant_id = ${T} and gc.customer_id = c.id and gc.status = any(${LIVE_GIFT_CARD}::text[]) and gc.balance_cents > 0) as gift_card_cents,
        (select count(*)::int from customer_payment_methods pm where pm.tenant_id = ${T} and pm.customer_id = c.id) as payment_methods,
        (select coalesce(array_agg(ct.tag order by ct.tag), '{}') from customer_tags ct where ct.tenant_id = ${T} and ct.customer_id = c.id) as tags
      from customers c
      left join branches b on b.tenant_id = c.tenant_id and b.id = c.branch_id
      left join technicians pt on pt.tenant_id = c.tenant_id and pt.id = c.preferred_technician_id
      left join customer_loyalty_profiles lp on lp.tenant_id = c.tenant_id and lp.customer_id = c.id
      where c.tenant_id = ${T} and c.id = any(${ids}::uuid[])`.execute(ex)).rows;
    return new Map(rows.map((r) => [String(r.id), r]));
  }
  private memberOut(r: Row | undefined, id: string, fullContact: boolean) {
    if (!r) return { customerId: id, missing: true };
    return {
      customerId: id, missing: false, name: nameOf(r) || null, status: r.status, archived: r.archived_at != null, version: N(r.record_version),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), branch: r.branch_name ?? null,
      phone: r.normalized_phone ? (fullContact ? (r.phone_display || r.normalized_phone) : maskPhone(r.normalized_phone)) : null,
      phoneVerified: r.normalized_phone ? r.phone_verified_at != null : null,
      email: r.email ? (fullContact ? r.email : maskEmail(r.email)) : null,
      consent: { sms: r.marketing_sms_opt_in ?? null, email: r.marketing_email_opt_in ?? null, marketing: r.marketing_opt_in ?? null },
      hasNotes: !!r.has_notes, preferredTechnician: r.preferred_technician ?? null, lastTechnician: r.last_technician ?? null,
      visits: N(r.visits), lastVisit: iso(r.last_visit), upcomingAppointments: N(r.upcoming), nextAppointment: r.next_appt ?? null,
      inSalonToday: N(r.in_salon), canceledOrNoShow: N(r.canceled_no_show), openTickets: N(r.open_tickets),
      loyalty: { points: r.points_balance == null ? null : N(r.points_balance), tier: r.loyalty_tier ?? null },
      activeMemberships: N(r.active_memberships), giftCards: { count: N(r.gift_cards), balanceCents: N(r.gift_card_cents) },
      paymentMethods: N(r.payment_methods), tags: (r.tags ?? []) as string[],
    };
  }

  async detail(ctx: DrCtx, id: string, opts: { fullContact: boolean; audit: AuditFn }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.salonToday(ctx);
    return this.db.transaction().execute(async (trx) => {
      const g = await this.loadGroup(trx, T, id);
      const ids = g.member_ids as string[];
      await this.assertVisible(trx, ctx, s, ids, false);
      const facts = await this.memberFacts(trx, T, ids, today);
      const events = (await sql<Row>`select id, event_type, actor_user_id, note, payload, created_at from customer_duplicate_events
        where tenant_id = ${T} and group_id = ${g.id} order by created_at desc, id desc limit 50`.execute(trx)).rows;
      // every comparison open is audited, and a failed audit blocks the read (guide §17: audit sensitive profile access)
      await opts.audit(trx, { groupId: g.id, members: ids.length, contact: opts.fullContact ? 'full' : 'masked' });
      return {
        group: { id: g.id, status: g.status, confidence: g.confidence, reasons: g.reasons, ruleVersion: g.rule_version, version: N(g.version),
          detectedAt: iso(g.detected_at), updatedAt: iso(g.updated_at), lastSeenAt: iso(g.last_seen_at), reviewedAt: iso(g.reviewed_at), mergedAt: iso(g.merged_at),
          survivorId: g.survivor_id ?? null, assignedTo: g.assigned_to ?? null, dueOn: g.due_on ? String(g.due_on).slice(0, 10) : null },
        evidence: g.evidence,
        members: ids.map((m) => this.memberOut(facts.get(m), m, opts.fullContact)),
        events: events.map((e) => ({ id: e.id, type: e.event_type, actorUserId: e.actor_user_id, note: e.note, payload: e.payload, at: iso(e.created_at) })),
        contact: opts.fullContact ? 'full' : 'masked',
      };
    });
  }

  // ── review decisions ──────────────────────────────────────────────────────────────────────────────────────────
  async decide(ctx: DrCtx, id: string, b: { decision?: unknown; note?: unknown; expectedVersion?: unknown; assignee?: unknown; dueOn?: unknown }, audit: AuditFn) {
    const T = ctx.tenantId;
    const decision = pick(DR_DECISIONS, b.decision);
    if (!decision) throw new DuplicateReviewError('Choose a decision.', 'DUPLICATE_INVALID_DECISION');
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
    if ((decision === 'keep_separate' || decision === 'request_evidence') && !note) throw new DuplicateReviewError('Add a short reason.', 'DUPLICATE_REASON_REQUIRED');
    const dueOn = typeof b.dueOn === 'string' && DAY.test(b.dueOn) ? b.dueOn : null;
    const assignee = uuidOrNull(b.assignee);
    const s = await this.scope(ctx);
    return this.db.transaction().execute(async (trx) => {
      const g = await this.loadGroup(trx, T, id, true);
      await this.assertVisible(trx, ctx, s, g.member_ids, true);
      if (b.expectedVersion != null && Number(b.expectedVersion) !== N(g.version))
        throw new DuplicateReviewError('Someone else updated this group. Reload it and try again.', 'DUPLICATE_STALE_VERSION', 409, { currentVersion: N(g.version) });
      const from = String(g.status);
      if (from === 'merged') throw new DuplicateReviewError('This group was already merged.', 'DUPLICATE_ALREADY_MERGED', 409);
      if (decision === 'reopen' && !['kept_separate', 'deferred', 'resolved', 'failed'].includes(from)) throw new DuplicateReviewError('Only a closed or deferred group can be reopened.', 'DUPLICATE_INVALID_DECISION');
      const to = decision === 'keep_separate' ? 'kept_separate' : decision === 'defer' ? 'deferred' : decision === 'in_review' ? 'in_review' : decision === 'reopen' ? 'pending' : from;
      const ids = g.member_ids as string[];
      if (decision === 'keep_separate' || decision === 'defer') {
        for (const [a, c] of pairsOf(ids)) await sql`insert into customer_duplicate_decisions (tenant_id, customer_a, customer_b, decision, decided_by, decided_at)
          values (${T}, ${a}, ${c}, ${decision === 'keep_separate' ? 'keep_separate' : 'not_sure'}, ${uuidOrNull(ctx.userId)}, now())
          on conflict (tenant_id, customer_a, customer_b) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now()`.execute(trx);
      }
      if (decision === 'reopen') for (const [a, c] of pairsOf(ids)) await sql`delete from customer_duplicate_decisions where tenant_id = ${T} and customer_a = ${a} and customer_b = ${c}`.execute(trx);
      await sql`update customer_duplicate_groups set status = ${to}, version = version + 1, updated_at = now(), updated_by = ${uuidOrNull(ctx.userId)},
          reviewed_at = case when ${decision === 'keep_separate' || decision === 'defer'} then now() else reviewed_at end,
          reviewed_by = case when ${decision === 'keep_separate' || decision === 'defer'} then ${uuidOrNull(ctx.userId)}::uuid else reviewed_by end,
          assigned_to = coalesce(${assignee}::uuid, assigned_to), due_on = coalesce(${dueOn}::date, due_on)
        where id = ${g.id} and tenant_id = ${T} and ${canMoveToSql(CUSTOMER_DUPLICATE_GROUP, to)}`.execute(trx);
      const type = decision === 'keep_separate' ? 'kept_separate' : decision === 'defer' ? 'deferred' : decision === 'in_review' ? 'in_review' : decision === 'reopen' ? 'reopened' : 'evidence_requested';
      await this.event(trx, T, g.id, type, ctx.userId, note, { from, to, assignee, dueOn });
      await audit(trx, { groupId: g.id, decision, from, to });
      const v = (await sql<Row>`select version, status from customer_duplicate_groups where tenant_id = ${T} and id = ${g.id}`.execute(trx)).rows[0];
      return { id: g.id, status: v.status, version: N(v.version) };
    });
  }

  async addNote(ctx: DrCtx, id: string, b: { note?: unknown }) {
    const T = ctx.tenantId;
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
    if (!note) throw new DuplicateReviewError('Write a note first.', 'DUPLICATE_NOTE_REQUIRED');
    const s = await this.scope(ctx);
    return this.db.transaction().execute(async (trx) => {
      const g = await this.loadGroup(trx, T, id);
      await this.assertVisible(trx, ctx, s, g.member_ids, false);
      await this.event(trx, T, g.id, 'note_added', ctx.userId, note, {});
      return { id: g.id, ok: true };
    });
  }

  // ── merge preview + confirm ───────────────────────────────────────────────────────────────────────────────────
  /** read-only impact analysis from the current source of truth; returns a state hash bound to every input */
  private async computePreview(ex: Kysely<any>, ctx: DrCtx, s: BranchScope, g: Row, survivorId: string, today: string) {
    const T = ctx.tenantId;
    const ids = g.member_ids as string[];
    if (!isUuid(`${survivorId}`) || !ids.includes(survivorId)) throw new DuplicateReviewError('Choose a profile from this group to keep.', 'DUPLICATE_SURVIVOR_NOT_IN_GROUP');
    const sources = ids.filter((x) => x !== survivorId);
    const facts = await this.memberFacts(ex, T, ids, today);
    const counts: Record<string, number> = {};
    for (const t of MERGE_REASSIGN_TABLES) {
      const n = N((await sql<Row>`select count(*)::int as n from ${sql.table(t)} where tenant_id = ${T} and customer_id = any(${sources}::uuid[])`.execute(ex)).rows[0]?.n);
      if (n) counts[t] = n;
    }
    const visibleAll = !s.branchIds || N((await sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.id = any(${ids}::uuid[]) and ${this.custVisible(s)}`.execute(ex)).rows[0]?.n) === ids.length;
    const blockers: { code: string; detail: Record<string, unknown> }[] = [];
    const acks: { code: string; detail: Record<string, unknown> }[] = [];
    const surv = facts.get(survivorId);
    const src = sources.map((x) => facts.get(x));
    if (!['pending', 'in_review', 'deferred', 'failed'].includes(String(g.status))) blockers.push({ code: 'GROUP_CLOSED', detail: { status: g.status } });
    if (!surv || surv.archived_at || src.some((r) => !r || r.archived_at)) blockers.push({ code: 'MEMBER_ARCHIVED', detail: {} });
    if (!visibleAll) blockers.push({ code: 'OUT_OF_SCOPE', detail: {} });
    const openTickets = src.reduce((n, r) => n + N(r?.open_tickets), 0);
    if (openTickets) blockers.push({ code: 'OPEN_TICKET', detail: { count: openTickets } });
    const inSalon = src.reduce((n, r) => n + N(r?.in_salon), 0);
    if (inSalon) blockers.push({ code: 'IN_SALON_NOW', detail: { count: inSalon } });
    const withMembership = [...facts.values()].filter((r) => N(r.active_memberships) > 0).length;
    if (withMembership > 1) blockers.push({ code: 'MEMBERSHIP_CONFLICT', detail: { profiles: withMembership } });
    // acknowledgements: allowed, but a human must read and accept each one
    if ((g.evidence?.why ?? []).includes('name_only')) acks.push({ code: 'NAME_ONLY', detail: {} });
    const distinct = (k: string) => new Set([...facts.values()].map((r) => (r[k] == null ? '' : String(r[k]).trim().toLowerCase())).filter(Boolean)).size;
    if (distinct('normalized_phone') > 1 || distinct('email') > 1) acks.push({ code: 'CONTACT_CONFLICT', detail: { phones: distinct('normalized_phone'), emails: distinct('email') } });
    const consentKey = (r: Row | undefined) => `${r?.marketing_sms_opt_in ?? ''}|${r?.marketing_email_opt_in ?? ''}|${r?.marketing_opt_in ?? ''}`;
    if (src.some((r) => consentKey(r) !== consentKey(surv))) acks.push({ code: 'CONSENT_DIFFERS', detail: {} });
    const withPoints = [...facts.values()].filter((r) => N(r.points_balance) !== 0).length;
    if (withPoints > 1) acks.push({ code: 'LOYALTY_ON_BOTH', detail: { profiles: withPoints } });
    const upcoming = src.reduce((n, r) => n + N(r?.upcoming), 0);
    if (upcoming) acks.push({ code: 'FUTURE_APPOINTMENTS', detail: { count: upcoming } });
    const gc = src.reduce((n, r) => n + N(r?.gift_cards), 0);
    if (gc) acks.push({ code: 'GIFT_CARDS_MOVE', detail: { count: gc, balanceCents: src.reduce((n, r) => n + N(r?.gift_card_cents), 0) } });
    if (withMembership === 1 && src.some((r) => N(r?.active_memberships) > 0)) acks.push({ code: 'MEMBERSHIP_MOVES', detail: {} });
    const pm = src.reduce((n, r) => n + N(r?.payment_methods), 0);
    if (pm) acks.push({ code: 'PAYMENT_METHODS_MOVE', detail: { count: pm } });
    const state = {
      groupId: g.id, groupVersion: N(g.version), survivorId, sources: [...sources].sort(),
      members: ids.map((m) => { const r = facts.get(m); return [m, N(r?.record_version), iso(r?.updated_at), r?.archived_at ? 1 : 0]; }),
      counts, blockers: blockers.map((b) => b.code), acks: acks.map((a) => a.code),
    };
    return { state, previewHash: stableHash(state).slice(0, 40), counts, blockers, acks, facts, sources };
  }

  async preview(ctx: DrCtx, id: string, survivorId: string, opts: { fullContact: boolean }) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.salonToday(ctx);
    return this.db.transaction().execute(async (trx) => {
      const g = await this.loadGroup(trx, T, id);
      await this.assertVisible(trx, ctx, s, g.member_ids, false);
      const pv = await this.computePreview(trx, ctx, s, g, survivorId, today);
      await this.event(trx, T, g.id, 'merge_previewed', ctx.userId, null, { previewHash: pv.previewHash, survivorId, sources: pv.sources, blockers: pv.blockers.map((b) => b.code) });
      const facts = pv.facts;
      return {
        groupId: g.id, groupVersion: N(g.version), previewHash: pv.previewHash,
        expiresAt: new Date(this.now() + DR_PREVIEW_TTL_MINUTES * 60000).toISOString(),
        survivor: this.memberOut(facts.get(survivorId), survivorId, opts.fullContact),
        sources: pv.sources.map((x) => this.memberOut(facts.get(x), x, opts.fullContact)),
        moves: pv.counts,   // table → number of rows that will point at the survivor
        blockers: pv.blockers, acknowledgements: pv.acks, canMerge: pv.blockers.length === 0,
        keeps: ['survivor_name_and_contact', 'survivor_consent', 'loyalty_ledger_history', 'archived_source_profiles', 'merge_log'],
        never: ['money_movement', 'refund', 'membership_cancel', 'booking_reschedule', 'message', 'consent_copy'],
        undo: 'not_supported',   // sources are archived, not deleted; the merge log names every moved row count
      };
    });
  }

  async confirm(ctx: DrCtx, id: string, b: { survivorId?: unknown; previewHash?: unknown; idempotencyKey?: unknown; acknowledged?: unknown; confirm?: unknown }, audit: AuditFn) {
    const T = ctx.tenantId;
    if (b.confirm !== true) throw new DuplicateReviewError('Confirm the merge explicitly.', 'DUPLICATE_CONFIRMATION_REQUIRED');
    const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
    if (key.length < 8 || key.length > 100) throw new DuplicateReviewError('Missing request key.', 'DUPLICATE_IDEMPOTENCY_KEY_REQUIRED');
    const survivorId = String(b.survivorId ?? '');
    const previewHash = String(b.previewHash ?? '');
    const acked = new Set(Array.isArray(b.acknowledged) ? b.acknowledged.map(String) : []);
    // a repeated request returns the recorded outcome — never a second merge, never re-applied points
    const prior = (await sql<Row>`select id, status, error_code, result, group_id from customer_duplicate_merge_ops where tenant_id = ${T} and idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (prior) return { operationId: prior.id, status: prior.status, errorCode: prior.error_code ?? null, result: prior.result, replayed: true };
    const s = await this.scope(ctx);
    const { today } = await this.salonToday(ctx);
    const opId = randomUUID();
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('duplicate-review-merge:' || ${T} || ':' || ${String(id)}))`.execute(trx);
        const g = await this.loadGroup(trx, T, id, true);
        if (g.status === 'merged') throw new DuplicateReviewError('This group was already merged.', 'DUPLICATE_ALREADY_MERGED', 409);
        const pv = await this.computePreview(trx, ctx, s, g, survivorId, today);
        if (pv.previewHash !== previewHash) throw new DuplicateReviewError('Something changed since the preview. Preview the merge again.', 'DUPLICATE_STALE_PREVIEW', 409);
        const seen = (await sql<Row>`select 1 from customer_duplicate_events where tenant_id = ${T} and group_id = ${g.id} and event_type = 'merge_previewed'
          and payload->>'previewHash' = ${previewHash} and created_at >= now() - ${DR_PREVIEW_TTL_MINUTES + ' minutes'}::interval limit 1`.execute(trx)).rows.length > 0;
        if (!seen) throw new DuplicateReviewError('The preview expired. Preview the merge again.', 'DUPLICATE_STALE_PREVIEW', 409);
        if (pv.blockers.length) throw new DuplicateReviewError('This merge is blocked until the listed issues are resolved.', 'DUPLICATE_MERGE_BLOCKED', 409, { blockers: pv.blockers.map((x) => x.code) });
        const missing = pv.acks.map((a) => a.code).filter((c) => !acked.has(c));
        if (missing.length) throw new DuplicateReviewError('Confirm every listed consequence before merging.', 'DUPLICATE_ACK_REQUIRED', 409, { missing });
        const merged = await mergeCustomersTx(trx, { tenantId: T, branchId: ctx.branchId || null, userId: ctx.userId }, survivorId, pv.sources, { groupId: g.id }, this.outbox);
        const result = { survivorId, sourceIds: pv.sources, moved: merged.moved, mergeLogIds: merged.mergeLogIds };
        await sql`insert into customer_duplicate_merge_ops (id, tenant_id, group_id, idempotency_key, preview_hash, survivor_id, source_ids, status, result, actor_user_id)
          values (${opId}, ${T}, ${g.id}, ${key}, ${previewHash}, ${survivorId}, ${pv.sources}::uuid[], 'completed', ${JSON.stringify(result)}::jsonb, ${uuidOrNull(ctx.userId)})`.execute(trx);
        await sql`update customer_duplicate_groups set status = 'merged', merged_at = now(), survivor_id = ${survivorId}, merge_op_id = ${opId},
          reviewed_at = now(), reviewed_by = ${uuidOrNull(ctx.userId)}, version = version + 1, updated_at = now(), updated_by = ${uuidOrNull(ctx.userId)} where id = ${g.id} and tenant_id = ${T} and ${canMoveToSql(CUSTOMER_DUPLICATE_GROUP, 'merged')}`.execute(trx);
        await this.event(trx, T, g.id, 'merged', ctx.userId, null, { operationId: opId, survivorId, sourceIds: pv.sources, moved: merged.moved, acknowledged: [...acked].sort() });
        await audit(trx, { groupId: g.id, operationId: opId, survivorId, sourceIds: pv.sources, moved: merged.moved });
        return { operationId: opId, status: 'completed', errorCode: null, result, replayed: false };
      });
    } catch (e: any) {
      const code = e instanceof DuplicateReviewError || e instanceof CustomerMergeError ? e.code : String(e?.code ?? '') === '23505' ? 'DUPLICATE_ALREADY_MERGED' : 'DUPLICATE_MERGE_FAILED';
      // record the failed attempt (the merge itself rolled back: nothing changed). Stale/blocked/ack answers are not
      // operations — the reviewer simply previews again — so only real execution failures and conflicts are recorded.
      if (!['DUPLICATE_STALE_PREVIEW', 'DUPLICATE_ACK_REQUIRED', 'DUPLICATE_MERGE_BLOCKED', 'DUPLICATE_SURVIVOR_NOT_IN_GROUP', 'DUPLICATE_GROUP_NOT_FOUND'].includes(code) && isUuid(`${id}`)) {
        await this.db.transaction().execute(async (trx) => {
          const exists = (await sql<Row>`select id from customer_duplicate_groups where tenant_id = ${T} and id = ${id}::uuid`.execute(trx)).rows[0];
          if (!exists) return;
          await sql`insert into customer_duplicate_merge_ops (id, tenant_id, group_id, idempotency_key, preview_hash, survivor_id, source_ids, status, error_code, actor_user_id)
            values (${opId}, ${T}, ${id}::uuid, ${key}, ${previewHash || 'none'}, ${uuidOrNull(survivorId) ?? '00000000-0000-0000-0000-000000000000'}::uuid, '{}'::uuid[], 'failed', ${code}, ${uuidOrNull(ctx.userId)})
            on conflict (tenant_id, idempotency_key) do nothing`.execute(trx);
          await this.event(trx, T, id, 'merge_failed', ctx.userId, null, { operationId: opId, code });
        }).catch((err: unknown) => log.warn(`could not record a failed merge attempt: ${(err as Error)?.message ?? err}`));
      }
      if (e instanceof DuplicateReviewError) throw e;
      if (e instanceof CustomerMergeError) throw new DuplicateReviewError(e.message, e.code, 409);
      if (code === 'DUPLICATE_ALREADY_MERGED') throw new DuplicateReviewError('This group was already merged.', 'DUPLICATE_ALREADY_MERGED', 409);
      throw new DuplicateReviewError('The merge could not finish. Nothing was changed.', 'DUPLICATE_MERGE_FAILED', 500);
    }
  }

  // ── extras Customer 08 (Nov 13 2026): reversible merges ───────────────────────────────────────────────────────────
  /** the salon's completed merges (newest first) with the people involved and whether each was undone */
  async merges(ctx: DrCtx, f: { page?: unknown; pageSize?: unknown; status?: unknown }): Promise<CustomerMergeRecordPage> {
    const T = ctx.tenantId;
    const pageSize = (DR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const st = f.status === 'active' || f.status === 'undone' ? String(f.status) : null;
    const W = st ? sql`and m.status = ${st}` : sql``;
    const total = Number((await sql<Row>`select count(*)::int as n from customer_merge_snapshots m where m.tenant_id = ${T} ${W}`.execute(this.db)).rows[0]?.n ?? 0);
    const rows = (await sql<Row>`select m.id, m.group_id, m.merged_at, m.survivor_customer_id, m.source_customer_ids, m.status, m.undone_at, m.undo_reason,
        coalesce(mu.full_name, mu.email) as merged_by, coalesce(uu.full_name, uu.email) as undone_by
      from customer_merge_snapshots m
      left join users mu on mu.id = m.merged_by_user_id and mu.tenant_id = ${T}
      left join users uu on uu.id = m.undone_by_user_id and uu.tenant_id = ${T}
      where m.tenant_id = ${T} ${W} order by m.merged_at desc, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const ids = [...new Set(rows.flatMap((r) => [String(r.survivor_customer_id), ...((r.source_customer_ids as string[]) ?? [])]))];
    const names = new Map(ids.length ? (await sql<Row>`select id, coalesce(nullif(full_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as name from customers where tenant_id = ${T} and id = any(${ids}::uuid[])`.execute(this.db)).rows.map((r) => [String(r.id), (r.name as string) || null] as const) : []);
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
    return {
      items: rows.map((r) => ({ id: String(r.id), groupId: String(r.group_id), mergedAt: iso(r.merged_at)!, mergedBy: (r.merged_by as string) ?? null,
        survivor: { id: String(r.survivor_customer_id), name: names.get(String(r.survivor_customer_id)) ?? null },
        sources: ((r.source_customer_ids as string[]) ?? []).map((x) => ({ id: x, name: names.get(x) ?? null })),
        status: r.status === 'undone' ? 'undone' as const : 'active' as const, undoneAt: iso(r.undone_at), undoneBy: (r.undone_by as string) ?? null, undoReason: (r.undo_reason as string) ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** read-only: can this merge be undone right now? */
  async unmergeCheck(ctx: DrCtx, id: string): Promise<CustomerUnmergeCheck> {
    if (!isUuid(id)) throw new DuplicateReviewError('That merge was not found.', 'CUSTOMER_UNMERGE_NOT_FOUND', 404);
    const snap = await loadMergeSnapshot(this.db, ctx.tenantId, id, false);
    if (!snap) throw new DuplicateReviewError('That merge was not found.', 'CUSTOMER_UNMERGE_NOT_FOUND', 404);
    return assessUnmerge(this.db, snap);
  }

  /** undo the merge from its snapshot, audited in the same transaction; refuses (409, coded) when anything changed since */
  async unmerge(ctx: DrCtx, id: string, b: { reason?: unknown; confirm?: unknown }, audit: (trx: any, meta: Record<string, unknown>) => Promise<void>): Promise<CustomerUnmergeResult> {
    if (!isUuid(id)) throw new DuplicateReviewError('That merge was not found.', 'CUSTOMER_UNMERGE_NOT_FOUND', 404);
    const reason = String(b?.reason ?? '').trim();
    if (b?.confirm !== true) throw new DuplicateReviewError('Confirm that you want to undo this merge.', 'CUSTOMER_UNMERGE_CONFIRM_REQUIRED', 400);
    if (reason.length < 3) throw new DuplicateReviewError('Give a reason for undoing this merge.', 'CUSTOMER_UNMERGE_REASON_REQUIRED', 400);
    try {
      return await this.db.transaction().execute(async (trx) => {
        const out = await unmergeCustomersTx(trx, { tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: ctx.userId }, id, reason);
        await audit(trx, { snapshotId: id, survivorId: out.survivorId, restoredCustomerIds: out.restoredCustomerIds, restored: out.restored, pointsRestored: out.pointsRestored, reason });
        return out;
      });
    } catch (e) {
      if (e instanceof CustomerUnmergeError) throw new DuplicateReviewError(e.message, e.code, e.code === 'CUSTOMER_UNMERGE_NOT_FOUND' ? 404 : 409, e.details);
      throw e;
    }
  }

  // ── history ───────────────────────────────────────────────────────────────────────────────────────────────────
  async history(ctx: DrCtx, f: DrHistoryQuery) {
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const pageSize = (DR_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const p = await this.period(ctx, f);
    const where = [sql`e.tenant_id = ${T}`, this.groupVisible(T, s)];
    if (f.groupId != null && f.groupId !== '') { if (!isUuid(String(f.groupId))) throw new DuplicateReviewError('Unknown group id.', 'DUPLICATE_INVALID_FILTER'); where.push(sql`e.group_id = ${String(f.groupId)}::uuid`); }
    if (f.customerId != null && f.customerId !== '') { if (!isUuid(String(f.customerId))) throw new DuplicateReviewError('Unknown customer id.', 'DUPLICATE_INVALID_FILTER'); where.push(sql`${String(f.customerId)}::uuid = any(g.member_ids)`); }
    const type = pick(DR_EVENT_TYPES, f.eventType);
    if (type) where.push(sql`e.event_type = ${type}`);
    if (p.start && p.end) where.push(sql`e.created_at >= ${p.start} and e.created_at < ${p.end}`);
    const W = sql.join(where, sql` and `);
    const total = N((await sql<Row>`select count(*)::int as n from customer_duplicate_events e join customer_duplicate_groups g on g.id = e.group_id and g.tenant_id = ${T} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.group_id, e.event_type, e.actor_user_id, coalesce(u.full_name, u.email) as actor_name, e.note, e.payload, e.created_at, g.confidence, g.status as group_status, g.member_count
      from customer_duplicate_events e join customer_duplicate_groups g on g.id = e.group_id and g.tenant_id = ${T}
      left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((e) => ({ id: e.id, groupId: e.group_id, type: e.event_type, actorUserId: e.actor_user_id, actor: e.actor_name ?? null, note: e.note, payload: e.payload,
        at: iso(e.created_at), groupConfidence: e.confidence, groupStatus: e.group_status, memberCount: N(e.member_count) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      period: { from: p.from, to: p.to, timeZone: p.tz },
    };
  }

  // ── one-click health check (read-only; records only its own evidence) ────────────────────────────────────────
  async check(ctx: DrCtx) {
    const T = ctx.tenantId;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('duplicate-review-health:' || ${T}))`.execute(trx);
      const recent = (await sql<Row>`select id, overall, checks, created_at from customer_duplicate_health_runs where tenant_id = ${T}
        and created_at >= now() - ${DR_HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(trx)).rows[0];
      if (recent) return { id: recent.id, overall: recent.overall, checks: recent.checks, checkedAt: iso(recent.created_at), reused: true };
      const checks: DrCheck[] = [];
      const add = (c: DrCheck) => checks.push(c);
      const q1 = async (q: any): Promise<Row> => (await q.execute(trx)).rows[0] ?? {};

      const lastOk = await q1(sql<Row>`select finished_at, rule_version, oversized_keys, customers_scanned, groups_found from customer_duplicate_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`);
      const latest = await q1(sql<Row>`select status, error_code, started_at from customer_duplicate_scans where tenant_id = ${T} order by started_at desc limit 1`);
      const age = lastOk.finished_at ? (this.now() - new Date(lastOk.finished_at).getTime()) / 3600000 : null;
      add(age == null ? { key: 'scan_freshness', state: 'INSUFFICIENT_DATA', evidence: 'No duplicate scan has completed yet.', action: 'Press Scan now.', lastGoodAt: null }
        : age > 24 ? { key: 'scan_freshness', state: 'WARNING', evidence: `Last completed scan was ${Math.floor(age)} h ago.`, action: 'Run a scan; the queue may be missing new duplicates.', lastGoodAt: iso(lastOk.finished_at) }
        : lastOk.rule_version !== DR_RULE_VERSION ? { key: 'scan_freshness', state: 'WARNING', evidence: `Last scan used rule ${lastOk.rule_version}; current is ${DR_RULE_VERSION}.`, action: 'Run a scan to relabel groups with the current rule.', lastGoodAt: iso(lastOk.finished_at) }
        : { key: 'scan_freshness', state: 'PASSED', evidence: `Last scan ${iso(lastOk.finished_at)}: ${N(lastOk.customers_scanned)} profiles, ${N(lastOk.groups_found)} groups.`, action: null, lastGoodAt: iso(lastOk.finished_at) });
      add(latest.status === 'failed' ? { key: 'scan_failures', state: 'FAILED', evidence: `The latest scan failed (${latest.error_code ?? 'unknown'}).`, action: 'Run the scan again; if it fails again, report the error code.', lastGoodAt: iso(lastOk.finished_at) }
        : { key: 'scan_failures', state: latest.status ? 'PASSED' : 'INSUFFICIENT_DATA', evidence: latest.status ? 'The latest scan did not fail.' : 'No scan yet.', action: null, lastGoodAt: iso(lastOk.finished_at) });

      // the screenshot diagnostic: a Strong / Exact label must rest on a shared phone or email, never on the name alone
      const over = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_groups where tenant_id = ${T} and confidence in ('exact', 'strong')
        and (evidence->'why') ? 'name_only'`)).n);
      add({ key: 'confidence_rule', state: over ? 'FAILED' : 'PASSED', count: over,
        evidence: over ? `${over} group(s) are labelled Strong/Exact on a name match alone.` : `No group is labelled Strong or Exact on a name alone (rule ${DR_RULE_VERSION}).`,
        action: over ? 'Run a scan with the current rule.' : null });
      const legacy = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_groups where tenant_id = ${T} and status = any(${[...DR_OPEN_STATUSES]}::text[])
        and evidence->>'legacyLabel' in ('strong', 'exact') and confidence = 'possible'`)).n);
      add({ key: 'legacy_overconfidence', state: legacy ? 'WARNING' : 'PASSED', count: legacy,
        evidence: legacy ? `${legacy} open group(s) the old rule called Strong/Exact are only Possible: a blank phone or email was counted as a match, or only the name matches.` : 'No open group was over-labelled by the old rule.',
        action: legacy ? 'Treat these as Possible. A matching name alone does not show the same person; confirm with the customer before merging.' : null });

      const sampleOk = toStoredCustomerPhone('(609) 555-0101') != null && toStoredCustomerPhone('(609) 555-0101') === toStoredCustomerPhone('+1 609-555-0101');
      const fold = await q1(sql<Row>`select vi_fold(lower(btrim(${'  Nguyễn Thị Hằng '}::text))) as f, lower(btrim(${' Test@Example.COM '}::text)) as e`);
      const normOk = sampleOk && fold.f === 'nguyen thi hang' && fold.e === 'test@example.com';
      add({ key: 'normalizers', state: normOk ? 'PASSED' : 'FAILED', evidence: normOk ? 'Phone, email and Vietnamese-name normalizers agree on synthetic samples.' : `A normalizer disagreed (phone ok: ${sampleOk}, name fold: ${fold.f}, email: ${fold.e}).`,
        action: normOk ? null : 'Do not trust phone/name matches until the normalizer is fixed.' });

      const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${[...DR_REQUIRED_INDEXES]}::text[])`.execute(trx)).rows.map((r) => String(r.indexname));
      const missingIdx = DR_REQUIRED_INDEXES.filter((i) => !idx.includes(i));
      add({ key: 'indexes', state: missingIdx.length ? 'WARNING' : 'PASSED', count: missingIdx.length, evidence: missingIdx.length ? `Missing: ${missingIdx.join(', ')}.` : 'Detection and queue indexes are present.', action: missingIdx.length ? 'Apply migration 761.' : null });

      const staleMembers = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_groups g where g.tenant_id = ${T} and g.status = any(${[...DR_OPEN_STATUSES]}::text[])
        and exists (select 1 from unnest(g.member_ids) m(id) where not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = m.id and c.archived_at is null))`)).n);
      add({ key: 'stale_members', state: staleMembers ? 'WARNING' : 'PASSED', count: staleMembers, evidence: staleMembers ? `${staleMembers} open group(s) include an archived or missing profile.` : 'Every open group lists live profiles only.', action: staleMembers ? 'Run a scan; those groups will be resolved.' : null });

      const cross = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_groups g where g.tenant_id = ${T}
        and exists (select 1 from unnest(g.member_ids) m(id) join customers c on c.id = m.id where c.tenant_id <> ${T})`)).n);
      add({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross, evidence: cross ? `${cross} group(s) reference another salon's customer.` : 'Every group references this salon\'s customers only.', action: cross ? 'Critical: stop merging and report this immediately.' : null });

      const badMerge = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_merge_ops o where o.tenant_id = ${T} and o.status = 'completed'
        and (exists (select 1 from customers c where c.tenant_id = ${T} and c.id = any(o.source_ids) and c.archived_at is null)
          or exists (select 1 from tickets t where t.tenant_id = ${T} and t.customer_id = any(o.source_ids))
          or exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id = any(o.source_ids)))`)).n);
      const mergesDone = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_merge_ops where tenant_id = ${T} and status = 'completed'`)).n);
      add({ key: 'merge_integrity', state: badMerge ? 'FAILED' : mergesDone ? 'PASSED' : 'INSUFFICIENT_DATA', count: badMerge,
        evidence: badMerge ? `${badMerge} completed merge(s) left a live source profile or a booking/ticket on a merged profile.` : mergesDone ? `${mergesDone} completed merge(s): every source archived, no booking or ticket left behind.` : 'No merge has been completed from this workspace yet.',
        action: badMerge ? 'Reconcile the listed merges through Customers before merging more.' : null });

      const failedOps = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_merge_ops where tenant_id = ${T} and status = 'failed' and created_at >= now() - interval '7 days'`)).n);
      add({ key: 'merge_failures', state: failedOps ? 'WARNING' : 'PASSED', count: failedOps, evidence: failedOps ? `${failedOps} merge attempt(s) failed in the last 7 days (nothing was changed by them).` : 'No failed merge attempts in the last 7 days.', action: failedOps ? 'Open History → Merge failed for the reason codes.' : null });

      const ledgerOff = N((await q1(sql<Row>`select count(*)::int as n from customer_duplicate_merge_ops o
        join customer_loyalty_profiles lp on lp.tenant_id = o.tenant_id and lp.customer_id = o.survivor_id
        where o.tenant_id = ${T} and o.status = 'completed'
          and lp.points_balance <> coalesce((select sum(l.delta) from loyalty_ledger l where l.tenant_id = o.tenant_id and l.customer_id = o.survivor_id), 0)`)).n);
      add({ key: 'loyalty_after_merge', state: ledgerOff ? 'FAILED' : mergesDone ? 'PASSED' : 'INSUFFICIENT_DATA', count: ledgerOff,
        evidence: ledgerOff ? `${ledgerOff} merged profile(s) have a points balance that differs from their loyalty ledger.` : mergesDone ? 'Merged profiles\' points balances equal their loyalty ledger.' : 'No merged profile to check yet.',
        action: ledgerOff ? 'Run the loyalty reconcile job; do not adjust points by hand.' : null });

      add({ key: 'oversized_keys', state: N(lastOk.oversized_keys) ? 'WARNING' : lastOk.finished_at ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(lastOk.oversized_keys),
        evidence: N(lastOk.oversized_keys) ? `${N(lastOk.oversized_keys)} phone/email/name value(s) are shared by more than ${DR_MAX_KEY_MEMBERS} profiles and were not grouped (for example the salon's own number).` : 'No over-shared phone, email or name.',
        action: N(lastOk.oversized_keys) ? 'Clean up placeholder phones/emails on those profiles in Customers.' : null });

      // ── extras Customer 02: customer data integrity beyond the merge workspace (each a count; nothing is repaired here) ──
      // records in other systems that still name a customer id this salon no longer has (a deleted profile)
      const orphan = await q1(sql<Row>`select
          (select count(*)::int from pos_tech_appointments a where a.tenant_id = ${T} and a.customer_id is not null
             and not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = a.customer_id)) as appts,
          (select count(*)::int from gift_cards g where g.tenant_id = ${T} and g.customer_id is not null
             and not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = g.customer_id)) as cards,
          (select count(*)::int from loyalty_ledger l where l.tenant_id = ${T}
             and not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = l.customer_id)) as points,
          (select count(*)::int from customer_memberships m where m.tenant_id = ${T}
             and not exists (select 1 from customers c where c.tenant_id = ${T} and c.id = m.customer_id)) as plans`);
      const orphanN = N(orphan.appts) + N(orphan.cards) + N(orphan.points) + N(orphan.plans);
      add({ key: 'orphan_references', state: orphanN ? 'WARNING' : 'PASSED', count: orphanN,
        evidence: orphanN ? `Records naming a missing customer: ${N(orphan.appts)} booking(s), ${N(orphan.cards)} gift card(s), ${N(orphan.points)} loyalty entr(ies), ${N(orphan.plans)} membership(s).` : 'Every booking, gift card, loyalty entry and membership names a customer this salon has.',
        action: orphanN ? 'Look these up in their own screens; reattach them to the right customer there. Nothing is changed by this check.' : null });
      // live bookings still on an archived profile (a merged source is merge_integrity's)
      const archBooked = N((await q1(sql<Row>`select count(*)::int as n from pos_tech_appointments a join customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
        where a.tenant_id = ${T} and c.archived_at is not null and a.status in ('booked', 'confirmed')
          and a.appt_date >= (now() at time zone coalesce((select bz.timezone from branches bz where bz.tenant_id = a.tenant_id and bz.id = a.branch_id), 'America/New_York'))::date
          and not exists (select 1 from customer_duplicate_merge_ops o where o.tenant_id = a.tenant_id and o.status = 'completed' and a.customer_id = any(o.source_ids))`)).n);
      add({ key: 'archived_with_bookings', state: archBooked ? 'WARNING' : 'PASSED', count: archBooked,
        evidence: archBooked ? `${archBooked} upcoming booking(s) belong to an archived customer profile.` : 'No upcoming booking belongs to an archived profile.',
        action: archBooked ? 'Open the bookings and move them to the customer\'s live profile, or restore the profile.' : null });
      // the same loyalty posting twice (same customer, type, source and reference) where the ledger's unique key does not apply
      const repeatPts = N((await q1(sql<Row>`select count(*)::int as n from (select 1 from loyalty_ledger l where l.tenant_id = ${T} and l.source_id is null and l.reference_id is not null
        group by l.customer_id, l.type, l.source, l.reference_id having count(*) > 1) x`)).n);
      add({ key: 'loyalty_repeat_entries', state: repeatPts ? 'WARNING' : 'PASSED', count: repeatPts,
        evidence: repeatPts ? `${repeatPts} loyalty posting(s) appear more than once for the same customer and reference.` : 'No loyalty posting is repeated for the same customer and reference.',
        action: repeatPts ? 'Review them in Loyalty; a correction is a reasoned reversal there, never a hand edit.' : null });
      // marketing consent on the profile while the same phone / email is on the opt-out list (the send is blocked either way)
      const consent = N((await q1(sql<Row>`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.archived_at is null and (
          (c.marketing_sms_opt_in and exists (select 1 from notification_opt_outs o where o.tenant_id = c.tenant_id and o.channel = 'sms' and o.address = c.normalized_phone))
          or (c.marketing_email_opt_in and exists (select 1 from notification_opt_outs o where o.tenant_id = c.tenant_id and o.channel = 'email' and o.address = lower(btrim(c.email)))))`)).n);
      add({ key: 'consent_conflict', state: consent ? 'WARNING' : 'PASSED', count: consent,
        evidence: consent ? `${consent} profile(s) are marked opted in to marketing while their phone or email is on the opt-out list.` : 'No profile is opted in to marketing while on the opt-out list.',
        action: consent ? 'Confirm with the customer and update the profile; the opt-out list always wins when sending.' : null });

      const order = ['FAILED', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
      const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING'
        : checks.every((c) => c.state === 'INSUFFICIENT_DATA' || c.state === 'PASSED') && checks.some((c) => c.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
      checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
      const runId = randomUUID();
      await sql`insert into customer_duplicate_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
