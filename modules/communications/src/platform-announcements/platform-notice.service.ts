/**
 * platform-notice.service.ts — Platform Announcements on the POS top bar (Super Admin POS Top-Bar Announcement & Platform
 * Broadcast mandate, Oct 22 2026). ONE authority for:
 *
 *   SUPER ADMIN  create (draft) → edit (versioned) → preview → publish now / schedule (confirm) → pause ⇄ resume → archive
 *                duplicate-to-draft · history (filters + search) · version history · delivery / dismiss / ack counts
 *   POS          the startup / reconnect / safety-sync SNAPSHOT for the signed-in employee (server-side targeting by the
 *                session's tenant + branch — never a tenant id from the request) · dismiss · acknowledge · delivered
 *
 * PostgreSQL is the truth and its clock decides SCHEDULED / ACTIVE / EXPIRED (§16, §102). Every write is one transaction:
 * the row (FOR UPDATE, version-checked), a revision row, and — when a POS could see the change — one outbox event PER
 * TARGETED SALON (tenantId on the envelope) so the realtime projection tells exactly those salons to refetch (§64–§70).
 * A Super Admin action is audited on the platform audit trail (§63).
 */
import { sql, type Kysely, type Transaction } from 'kysely';
import { assertTransition, type DB } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import type { AuditService } from '@aipowersalon/audit';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';
import { adminNotice, adminNoticePage, replaceNoticeTargets } from './platform-notice-admin.queries';
import {
  PLATFORM_NOTICE, NOTICE_TYPES, NOTICE_PRIORITIES, NOTICE_AUDIENCES, cleanMessage, cleanTitle, windowProblem, needsConfirmation, isMaterialChange,
  compareForDisplay, derivedStatus, cleanVietnamese, viProblem, isCriticalNotice, type NoticeStatus,
} from './platform-notice-core';

type Db = Kysely<DB>;
type Trx = Transaction<DB>;
type Exec = Db | Trx;
type Row = Record<string, unknown>;

export type NoticeErrorCode = 'PLATFORM_ANNOUNCEMENT_NOT_FOUND' | 'PLATFORM_ANNOUNCEMENT_ACCESS_DENIED' | 'PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE' | 'PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE'
  | 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' | 'PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT' | 'PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED' | 'PLATFORM_ANNOUNCEMENT_INVALID_STATE'
  | 'PLATFORM_ANNOUNCEMENT_CONFIRMATION_REQUIRED' | 'PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED';
export class PlatformNoticeError extends Error {
  readonly status: number;
  constructor(public readonly code: NoticeErrorCode, message?: string, public readonly details?: Record<string, unknown>) {
    super(message ?? ERROR_REGISTRY[code].message);
    this.name = 'PlatformNoticeError';
    this.status = ERROR_REGISTRY[code].status;
  }
}

export interface PlatformActor { userId?: string | null; permissions?: string[]; role?: string | null; ip?: string | null }
export interface PosActor { tenantId: string; branchId?: string | null; userId?: string | null; permissions?: string[]; role?: string | null }

const VIEW = 'super_admin.communications.view';
const MANAGE = 'super_admin.communications.manage';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const NOTICE_COLS = ['id', 'title', 'message', 'type', 'priority', 'audience', 'surfaces', 'lifecycle_status', 'starts_at', 'ends_at', 'dismissible', 'requires_ack', 'content_version', 'version',
  'duplicated_from', 'created_by', 'updated_by', 'published_by', 'published_at', 'paused_at', 'archived_at', 'created_at', 'updated_at',
  'title_vi', 'message_vi', 'vi_reviewed_by', 'vi_reviewed_at', 'english_only'] as const;   // WP-F (696)

export interface NoticeWrite {
  title?: string | null; message?: string; type?: string; priority?: string; audience?: string; tenantIds?: string[] | null; branchIds?: string[] | null;
  startsAt?: string | null; endsAt?: string | null; dismissible?: boolean; requiresAcknowledgement?: boolean; expectedVersion?: number | null;
  /** WP-F (§56–§57): optional Vietnamese version, its review (true = the caller reviewed THIS wording), English only */
  titleVi?: string | null; messageVi?: string | null; viReviewed?: boolean | null; englishOnly?: boolean | null;
}
type Target = { tenantId: string; branchId: string | null };

export class PlatformNoticeService {
  constructor(private readonly db: Db, private readonly opts: { outbox?: OutboxWriter | null; audit?: AuditService | null } = {}) {}

  // ── guards / helpers ────────────────────────────────────────────────────────────────────────────────────────────────
  private need(ctx: PlatformActor, perm: string) {
    if (!ctx?.userId || !hasPermission({ userId: ctx.userId, tenantId: '', branchId: '', role: ctx.role ?? 'SUPER_ADMIN', permissions: ctx.permissions ?? [] } as never, perm))
      throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ACCESS_DENIED');
  }
  private async clock(exec: Exec): Promise<number> {
    const r = await sql<{ now: string }>`SELECT now() AS now`.execute(exec);
    return new Date(r.rows[0].now).getTime();
  }
  private async lock(trx: Trx, id: string): Promise<Row> {
    if (!UUID.test(id)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_NOT_FOUND');
    const r = await trx.selectFrom('platform_notices').select([...NOTICE_COLS]).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!r) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_NOT_FOUND');
    return r as Row;
  }
  private checkVersion(n: Row, expected: number | null | undefined) {
    if (expected != null && Number(expected) !== Number(n.version)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT', undefined, { currentVersion: Number(n.version) });
  }
  private async targetsOf(exec: Exec, id: string): Promise<Target[]> {
    const r = await exec.selectFrom('platform_notice_targets').select(['tenant_id', 'branch_id']).where('notice_id', '=', id).execute();
    return r.map((t) => ({ tenantId: String(t.tenant_id), branchId: (t.branch_id as string) ?? null }));
  }
  private async audit(ctx: PlatformActor, action: string, id: string, metadata: Record<string, unknown>, severity: 'low' | 'medium' | 'high' = 'medium') {
    if (!this.opts.audit) return;
    // AuditService.recordPlatform never throws (best effort by contract); the revision row is the transactional record
    await this.opts.audit.recordPlatform({ module: 'platform_announcements', action, resourceType: 'platform_announcement', resourceId: id, severity, metadata, userId: uuidOrNull(ctx.userId), role: ctx.role ?? 'SUPER_ADMIN' } as never);
  }
  private snapshot(n: Row, targets: Target[]) {
    return { title: n.title ?? null, message: n.message, type: n.type, priority: n.priority, audience: n.audience, lifecycleStatus: n.lifecycle_status, startsAt: iso(n.starts_at), endsAt: iso(n.ends_at),
      dismissible: !!n.dismissible, requiresAcknowledgement: !!n.requires_ack, contentVersion: Number(n.content_version),
      titleVi: (n.title_vi as string) ?? null, messageVi: (n.message_vi as string) ?? null, englishOnly: !!n.english_only, viReviewedBy: (n.vi_reviewed_by as string) ?? null, viReviewedAt: iso(n.vi_reviewed_at), targets };
  }
  private async revision(trx: Trx, ctx: PlatformActor, id: string, action: string) {
    const n = (await trx.selectFrom('platform_notices').select([...NOTICE_COLS]).where('id', '=', id).executeTakeFirstOrThrow()) as Row;
    await trx.insertInto('platform_notice_revisions').values({ notice_id: id, version: Number(n.version), action, actor_id: uuidOrNull(ctx.userId), snapshot: JSON.stringify(this.snapshot(n, await this.targetsOf(trx, id))) }).execute();
    return n;
  }

  /** Validate the audience and resolve its targets against authoritative tenant / branch rows (§53–§55, §13). */
  private async resolveAudience(exec: Exec, audience: string, tenantIds: string[] | null | undefined, branchIds: string[] | null | undefined): Promise<Target[]> {
    if (!(NOTICE_AUDIENCES as readonly string[]).includes(audience)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE');
    if (audience === 'all_tenants') return [];
    if (audience === 'selected_tenants') {
      const ids = [...new Set((tenantIds ?? []).filter((x) => UUID.test(x)))];
      if (!ids.length || ids.length !== (tenantIds ?? []).length) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'Choose at least one salon.');
      if (ids.length > 5000) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'That is too many salons for one targeted message — use All Tenants.');
      const found = await exec.selectFrom('tenants').select('id').where('id', 'in', ids).execute();
      if (found.length !== ids.length) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'One of the chosen salons does not exist.');
      return ids.map((t) => ({ tenantId: t, branchId: null }));
    }
    const ids = [...new Set((branchIds ?? []).filter((x) => UUID.test(x)))];
    if (!ids.length || ids.length !== (branchIds ?? []).length) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'Choose at least one branch.');
    if (ids.length > 5000) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'That is too many branches for one targeted message.');
    // the branch's OWN tenant is taken from the branch row — a client never says which salon a branch belongs to
    const rows = await exec.selectFrom('branches').select(['id', 'tenant_id']).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
    if (rows.length !== ids.length) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'One of the chosen branches does not exist.');
    if (tenantIds?.length) {
      const allowed = new Set(tenantIds);
      if (rows.some((r) => !allowed.has(String(r.tenant_id)))) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE', 'A chosen branch does not belong to the chosen salon.');
    }
    return rows.map((r) => ({ tenantId: String(r.tenant_id), branchId: String(r.id) }));
  }
  private async writeTargets(trx: Trx, id: string, targets: Target[]) { await replaceNoticeTargets(trx, id, targets); }

  /** Which salons' POS screens could change, and in which branch rooms: the union of before and after (a salon removed
   *  from the audience must hear that its notice is gone). All tenants = every active salon with its active branches. */
  private async notify(trx: Trx, type: DomainEventType, n: Row, audiences: Array<{ audience: string; targets: Target[] }>, action: string) {
    if (!this.opts.outbox) return;
    const salons = new Map<string, Set<string>>();
    const addTenantWide = async (tenantIds: string[] | null) => {
      let q = trx.selectFrom('branches').select(['id', 'tenant_id']).where('deleted_at', 'is', null);
      if (tenantIds) { if (!tenantIds.length) return; q = q.where('tenant_id', 'in', tenantIds); }
      else q = q.where('tenant_id', 'in', trx.selectFrom('tenants').select('id').where('status', '=', 'active'));
      for (const b of await q.execute()) { const k = String(b.tenant_id); if (!salons.has(k)) salons.set(k, new Set()); salons.get(k)!.add(String(b.id)); }
      for (const t of tenantIds ?? (await trx.selectFrom('tenants').select('id').where('status', '=', 'active').execute()).map((x) => String(x.id))) if (!salons.has(t)) salons.set(t, new Set());
    };
    for (const a of audiences) {
      if (a.audience === 'all_tenants') await addTenantWide(null);
      else if (a.audience === 'selected_tenants') await addTenantWide(a.targets.map((t) => t.tenantId));
      else for (const t of a.targets) { if (!salons.has(t.tenantId)) salons.set(t.tenantId, new Set()); if (t.branchId) salons.get(t.tenantId)!.add(t.branchId); }
    }
    for (const [tenantId, branches] of salons) {
      await this.opts.outbox.write(trx as never, createDomainEvent({ eventType: type, tenantId, aggregateType: 'platform_announcement', aggregateId: String(n.id), aggregateVersion: Number(n.version),
        actorType: 'system', payload: { announcementId: String(n.id), version: Number(n.version), action, branchIds: [...branches] } } as never));
    }
  }

  // ── Super Admin: reads ──────────────────────────────────────────────────────────────────────────────────────────────
  private statusSql() {
    return sql<string>`CASE WHEN n.lifecycle_status <> 'published' THEN n.lifecycle_status
      WHEN n.ends_at IS NOT NULL AND n.ends_at <= now() THEN 'expired'
      WHEN n.starts_at IS NOT NULL AND n.starts_at > now() THEN 'scheduled' ELSE 'active' END`;
  }
  private toRow(r: Row, nowMs: number) {
    return {
      id: String(r.id), title: (r.title as string) ?? null, message: String(r.message), type: r.type as never, priority: r.priority as never, audience: r.audience as never,
      status: derivedStatus({ lifecycle: String(r.lifecycle_status), startsAt: r.starts_at as string, endsAt: r.ends_at as string }, nowMs),
      startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), dismissible: !!r.dismissible, requiresAcknowledgement: !!r.requires_ack, surfaces: (r.surfaces as string[]) ?? ['pos'],
      version: Number(r.version), contentVersion: Number(r.content_version), targetCount: Number(r.target_count ?? 0),
      createdBy: (r.created_by as string) ?? null, createdByName: (r.created_by_name as string) ?? null, updatedBy: (r.updated_by as string) ?? null, publishedBy: (r.published_by as string) ?? null,
      createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, publishedAt: iso(r.published_at), pausedAt: iso(r.paused_at), archivedAt: iso(r.archived_at), duplicatedFrom: (r.duplicated_from as string) ?? null,
      titleVi: (r.title_vi as string) ?? null, messageVi: (r.message_vi as string) ?? null, englishOnly: !!r.english_only,
      viReviewedBy: (r.vi_reviewed_by as string) ?? null, viReviewedAt: iso(r.vi_reviewed_at),
      vietnamese: (r.english_only ? 'english_only' : !r.message_vi ? 'none' : r.vi_reviewed_at ? 'reviewed' : 'unreviewed') as 'none' | 'unreviewed' | 'reviewed' | 'english_only',
      critical: isCriticalNotice({ type: String(r.type), priority: String(r.priority) }),
    };
  }
  /** §60, §128–§129: every announcement with its derived status; filter by status, search title / message / target salon. */
  async list(ctx: PlatformActor, q: { status?: string | null; q?: string | null; page?: number | null; pageSize?: number | null } = {}) {
    this.need(ctx, VIEW);
    const page = Math.max(1, Math.floor(Number(q.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(q.pageSize) || 25)));
    const status = q.status && ['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'].includes(q.status) ? q.status : null;
    const term = (q.q ?? '').trim().slice(0, 100);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = sql`WHERE (${status}::text IS NULL OR ${this.statusSql()} = ${status})
      AND (${term} = '' OR n.title ILIKE ${like} OR n.message ILIKE ${like}
        OR (${term} <> '' AND n.id IN (
          -- §98 (Oct 27): salons first, then their targets through the PARTIAL unique indexes (one branch per target_type);
          -- the old correlated EXISTS scanned every target row (899 ms → 30 ms on 1.88M targets, PERFORMANCE_REPORT.md)
          SELECT t.notice_id FROM platform_notice_targets t JOIN tenants tn ON tn.id = t.tenant_id WHERE t.target_type = 'tenant' AND (tn.display_name ILIKE ${like} OR tn.tenant_code ILIKE ${like})
          UNION ALL
          SELECT t.notice_id FROM platform_notice_targets t JOIN tenants tn ON tn.id = t.tenant_id WHERE t.target_type = 'branch' AND (tn.display_name ILIKE ${like} OR tn.tenant_code ILIKE ${like}))))`;
    const rows = { rows: (await adminNoticePage(this.db as never, where, pageSize, (page - 1) * pageSize)) as Row[] };
    const total = await sql<{ c: number }>`SELECT count(*)::int AS c FROM platform_notices n ${where}`.execute(this.db);
    const nowMs = await this.clock(this.db);
    return { items: rows.rows.map((r) => this.toRow(r, nowMs)), total: Number(total.rows[0]?.c ?? 0), page, pageSize, serverTime: new Date(nowMs).toISOString() };
  }
  async get(ctx: PlatformActor, id: string) {
    this.need(ctx, VIEW);
    if (!UUID.test(id)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_NOT_FOUND');
    const r = { rows: [(await adminNotice(this.db as never, id)) as Row].filter(Boolean) };
    if (!r.rows[0]) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_NOT_FOUND');
    const nowMs = await this.clock(this.db);
    const targets = await this.db.selectFrom('platform_notice_targets as t').leftJoin('tenants as tn', 'tn.id', 't.tenant_id').leftJoin('branches as b', 'b.id', 't.branch_id')
      .select(['t.tenant_id', 't.branch_id', 'tn.display_name as tenant_name', 'b.name as branch_name']).where('t.notice_id', '=', id).orderBy('tn.display_name').execute();
    const revisions = await this.db.selectFrom('platform_notice_revisions').select(['version', 'action', 'actor_id', 'created_at', 'snapshot']).where('notice_id', '=', id).orderBy('version', 'desc').limit(100).execute();
    const stats = await sql<{ delivered: number; dismissed: number; acknowledged: number; tenants: number }>`SELECT
        count(*) FILTER (WHERE kind = 'delivered')::int AS delivered, count(*) FILTER (WHERE kind = 'dismissed')::int AS dismissed,
        count(*) FILTER (WHERE kind = 'acknowledged')::int AS acknowledged, count(DISTINCT tenant_id) FILTER (WHERE kind = 'delivered')::int AS tenants
      FROM platform_notice_receipts WHERE notice_id = ${id}`.execute(this.db);
    const s = stats.rows[0] ?? { delivered: 0, dismissed: 0, acknowledged: 0, tenants: 0 };
    return {
      ...this.toRow(r.rows[0], nowMs),
      targets: targets.map((t) => ({ tenantId: String(t.tenant_id), tenantName: (t.tenant_name as string) ?? null, branchId: (t.branch_id as string) ?? null, branchName: (t.branch_name as string) ?? null })),
      revisions: revisions.map((v) => ({ version: Number(v.version), action: String(v.action), actorId: (v.actor_id as string) ?? null, at: iso(v.created_at)!, snapshot: (typeof v.snapshot === 'string' ? JSON.parse(v.snapshot) : v.snapshot) as Record<string, unknown> })),
      stats: { delivered: Number(s.delivered), dismissed: Number(s.dismissed), acknowledged: Number(s.acknowledged), tenantsReached: Number(s.tenants) },
    };
  }
  /** §54: searchable, paginated salon picker (server side — never the whole platform in the browser). */
  async tenantOptions(ctx: PlatformActor, q: { q?: string | null; page?: number | null; pageSize?: number | null } = {}) {
    this.need(ctx, VIEW);
    const page = Math.max(1, Math.floor(Number(q.page) || 1)), pageSize = Math.min(50, Math.max(1, Math.floor(Number(q.pageSize) || 20)));
    const term = (q.q ?? '').trim().slice(0, 100);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = sql`WHERE (${term} = '' OR t.display_name ILIKE ${like} OR t.legal_name ILIKE ${like} OR t.tenant_code ILIKE ${like})`;
    const rows = await sql<Row>`SELECT t.id, t.display_name, t.tenant_code, t.status, (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL)::int AS branches
      FROM tenants t ${where} ORDER BY t.display_name, t.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db);
    const total = await sql<{ c: number }>`SELECT count(*)::int AS c FROM tenants t ${where}`.execute(this.db);
    return { items: rows.rows.map((r) => ({ id: String(r.id), name: String(r.display_name), code: (r.tenant_code as string) ?? null, status: String(r.status), branches: Number(r.branches) })), total: Number(total.rows[0]?.c ?? 0), page, pageSize };
  }
  /** §55: the branches of a chosen salon, from the authoritative branch rows. */
  async branchOptions(ctx: PlatformActor, tenantId: string) {
    this.need(ctx, VIEW);
    if (!UUID.test(tenantId)) return [];
    const rows = await this.db.selectFrom('branches').select(['id', 'name', 'status']).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).orderBy('name').execute();
    return rows.map((b) => ({ id: String(b.id), name: String(b.name), status: String(b.status) }));
  }

  // ── Super Admin: writes ─────────────────────────────────────────────────────────────────────────────────────────────
  private fields(b: NoticeWrite, base?: Row, ctx?: PlatformActor) {
    const title = cleanTitle(b.title === undefined ? (base?.title ?? null) : b.title);
    if (!title.ok) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', title.reason);
    const message = cleanMessage(b.message === undefined ? base?.message : b.message);
    if (!message.ok) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', message.reason);
    const type = String(b.type ?? base?.type ?? 'info');
    if (!(NOTICE_TYPES as readonly string[]).includes(type)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', 'Choose Info, Update, Maintenance, Warning or Urgent.');
    const priority = String(b.priority ?? base?.priority ?? 'normal');
    if (!(NOTICE_PRIORITIES as readonly string[]).includes(priority)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', 'Choose Low, Normal, High or Critical.');
    const when = (v: string | null | undefined, cur: unknown) => {
      if (v === undefined) return cur ? new Date(cur as string).getTime() : null;
      if (v === null || v === '') return null;
      const t = new Date(v).getTime();
      if (!Number.isFinite(t)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', 'That date / time is not valid.');
      return t;
    };
    const startsAt = when(b.startsAt, base?.starts_at), endsAt = when(b.endsAt, base?.ends_at);
    const p = windowProblem({ startsAt, endsAt, type }, 0, false);
    if (p) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', p);
    // WP-F (§56–§57): the Vietnamese version — cleaned by the English rules; a review belongs to ONE wording
    const vi = cleanVietnamese(b.titleVi === undefined ? (base?.title_vi ?? null) : b.titleVi, b.messageVi === undefined ? (base?.message_vi ?? null) : b.messageVi);
    if (!vi.ok) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', vi.reason);
    const englishOnly = b.englishOnly == null ? !!base?.english_only : !!b.englishOnly;
    if (englishOnly && vi.value.messageVi) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', 'English only cannot carry a Vietnamese version — remove the Vietnamese text or untick English only.');
    const wordingChanged = !base || (base.title ?? null) !== title.value || base.message !== message.value
      || (base.title_vi ?? null) !== vi.value.titleVi || (base.message_vi ?? null) !== vi.value.messageVi;
    if (b.viReviewed === true && !vi.value.messageVi) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE', 'There is no Vietnamese version to mark as reviewed.');
    const reviewer = uuidOrNull(ctx?.userId);
    const review: { by: string | null; at: unknown } = b.viReviewed === true && reviewer ? { by: reviewer, at: sql`now()` }
      : b.viReviewed === false || wordingChanged || !vi.value.messageVi ? { by: null, at: null }
      : { by: (base?.vi_reviewed_by as string) ?? null, at: base?.vi_reviewed_at ?? null };
    if (!review.by) review.at = null;
    return { title: title.value, message: message.value, type, priority, startsAt, endsAt, titleVi: vi.value.titleVi, messageVi: vi.value.messageVi, englishOnly, review,
      dismissible: b.dismissible === undefined ? (base ? !!base.dismissible : true) : !!b.dismissible,
      requiresAck: b.requiresAcknowledgement === undefined ? (base ? !!base.requires_ack : false) : !!b.requiresAcknowledgement,
      audience: String(b.audience ?? base?.audience ?? 'all_tenants') };
  }
  /** §48–§50: a new announcement is always a DRAFT (never shown on a POS until it is published). */
  async create(ctx: PlatformActor, b: NoticeWrite) {
    this.need(ctx, MANAGE);
    const f = this.fields(b, undefined, ctx);
    const id = await this.db.transaction().execute(async (trx) => {
      const targets = await this.resolveAudience(trx, f.audience, b.tenantIds, b.branchIds);
      const ins = await trx.insertInto('platform_notices').values({ title: f.title, message: f.message, type: f.type, priority: f.priority, audience: f.audience, lifecycle_status: 'draft',
        starts_at: f.startsAt != null ? new Date(f.startsAt).toISOString() : null, ends_at: f.endsAt != null ? new Date(f.endsAt).toISOString() : null, dismissible: f.dismissible, requires_ack: f.requiresAck,
        title_vi: f.titleVi, message_vi: f.messageVi, english_only: f.englishOnly, vi_reviewed_by: f.review.by, vi_reviewed_at: f.review.at,
        created_by: uuidOrNull(ctx.userId), updated_by: uuidOrNull(ctx.userId) } as never).returning('id').executeTakeFirstOrThrow();
      await this.writeTargets(trx, String(ins.id), targets);
      await this.revision(trx, ctx, String(ins.id), 'created');
      return String(ins.id);
    });
    await this.audit(ctx, 'created', id, { type: f.type, priority: f.priority, audience: f.audience, vietnamese: f.englishOnly ? 'english_only' : f.messageVi ? (f.review.by ? 'reviewed' : 'unreviewed') : 'none' });
    return this.get(ctx, id);
  }
  /** §61–§62: an edit names the version it was made on; a stale writer is refused. Editing a published announcement
   *  changes what the salons see right away (their POS is told); a material change brings back a dismissed message. */
  async update(ctx: PlatformActor, id: string, b: NoticeWrite) {
    this.need(ctx, MANAGE);
    if (b.expectedVersion == null) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT', 'Reload the announcement before editing it.');
    const out = await this.db.transaction().execute(async (trx) => {
      const n = await this.lock(trx, id);
      if (n.lifecycle_status === 'archived') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED');
      this.checkVersion(n, b.expectedVersion);
      const f = this.fields(b, n, ctx);
      const beforeTargets = await this.targetsOf(trx, id);
      const audienceChanged = b.audience !== undefined || b.tenantIds !== undefined || b.branchIds !== undefined;
      const targets = audienceChanged ? await this.resolveAudience(trx, f.audience, b.tenantIds ?? (f.audience === 'selected_tenants' ? [...new Set(beforeTargets.map((t) => t.tenantId))] : null), b.branchIds ?? (f.audience === 'selected_branches' ? beforeTargets.filter((t) => t.branchId).map((t) => t.branchId!) : null)) : beforeTargets;
      if (n.lifecycle_status !== 'draft') {
        const nowMs = await this.clock(trx);
        const p = windowProblem({ startsAt: f.startsAt, endsAt: f.endsAt, type: f.type }, nowMs, true);
        if (p) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', p);
        // WP-F §57: a live (or paused) critical notice stays reviewed-Vietnamese or English only through every edit
        const v = viProblem({ type: f.type, priority: f.priority, messageVi: f.messageVi, viReviewed: !!f.review.by, englishOnly: f.englishOnly });
        if (v) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED', v);
      }
      const material = isMaterialChange({ title: (n.title as string) ?? null, message: String(n.message), type: String(n.type), priority: String(n.priority), titleVi: (n.title_vi as string) ?? null, messageVi: (n.message_vi as string) ?? null }, f);
      await trx.updateTable('platform_notices').set({ title: f.title, message: f.message, type: f.type, priority: f.priority, audience: f.audience,
        starts_at: f.startsAt != null ? new Date(f.startsAt).toISOString() : null, ends_at: f.endsAt != null ? new Date(f.endsAt).toISOString() : null, dismissible: f.dismissible, requires_ack: f.requiresAck,
        title_vi: f.titleVi, message_vi: f.messageVi, english_only: f.englishOnly, vi_reviewed_by: f.review.by, vi_reviewed_at: f.review.at,
        content_version: material ? sql`content_version + 1` : sql`content_version`, version: sql`version + 1`, updated_by: uuidOrNull(ctx.userId), updated_at: sql`now()` } as never)
        .where('id', '=', id).where('version', '=', Number(n.version)).execute();
      if (audienceChanged) await this.writeTargets(trx, id, targets);
      const after = await this.revision(trx, ctx, id, 'edited');
      if (n.lifecycle_status === 'published') await this.notify(trx, DOMAIN_EVENTS.ANNOUNCEMENT_CHANGED, after, [{ audience: String(n.audience), targets: beforeTargets }, { audience: f.audience, targets }], 'edited');
      return { before: this.snapshot(n, beforeTargets), after: this.snapshot(after, targets) };
    });
    await this.audit(ctx, 'edited', id, out);
    return this.get(ctx, id);
  }
  /** §56–§57, §95, §120–§121: publish now (the server sets the start) or schedule a future start. Publishing twice is one
   *  publication. Every salon at once, or a high / critical message, needs `confirm` (the screen shows the preview first). */
  async publish(ctx: PlatformActor, id: string, b: { expectedVersion?: number | null; publishNow?: boolean | null; startsAt?: string | null; confirm?: boolean | null } = {}) {
    this.need(ctx, MANAGE);
    const out = await this.db.transaction().execute(async (trx) => {
      const n = await this.lock(trx, id);
      if (n.lifecycle_status === 'published') return { replay: true };
      if (n.lifecycle_status === 'archived') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED');
      if (n.lifecycle_status !== 'draft') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_STATE', 'A paused announcement is resumed, not published again.');
      this.checkVersion(n, b.expectedVersion);
      // WP-F §57: no critical notice goes live without a reviewed Vietnamese version or an explicit English-only decision
      const v = viProblem({ type: String(n.type), priority: String(n.priority), messageVi: (n.message_vi as string) ?? null, viReviewed: !!n.vi_reviewed_at, englishOnly: !!n.english_only });
      if (v) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED', v);
      if (needsConfirmation({ audience: String(n.audience), priority: String(n.priority) }) && b.confirm !== true) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_CONFIRMATION_REQUIRED');
      const nowMs = await this.clock(trx);
      let startsAt: number | null;
      if (b.publishNow !== false && !b.startsAt) startsAt = null;   // now — the database clock (set below)
      else {
        const t = new Date(String(b.startsAt ?? n.starts_at ?? '')).getTime();
        if (!Number.isFinite(t)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', 'Choose when it should start.');
        startsAt = t;
      }
      const endsAt = n.ends_at ? new Date(n.ends_at as string).getTime() : null;
      const p = windowProblem({ startsAt: startsAt ?? nowMs, endsAt, type: String(n.type) }, nowMs, true);
      if (p) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', p);
      assertTransition(PLATFORM_NOTICE, 'draft', 'published');
      await trx.updateTable('platform_notices').set({ lifecycle_status: 'published', starts_at: startsAt != null && startsAt > nowMs ? new Date(startsAt).toISOString() : sql`now()`,
        published_at: sql`now()`, published_by: uuidOrNull(ctx.userId), paused_at: null, version: sql`version + 1`, updated_by: uuidOrNull(ctx.userId), updated_at: sql`now()` } as never)
        .where('id', '=', id).where('version', '=', Number(n.version)).execute();
      const after = await this.revision(trx, ctx, id, 'published');
      await this.notify(trx, DOMAIN_EVENTS.ANNOUNCEMENT_PUBLISHED, after, [{ audience: String(n.audience), targets: await this.targetsOf(trx, id) }], 'published');
      return { replay: false, scheduled: startsAt != null && startsAt > nowMs };
    });
    if (!out.replay) await this.audit(ctx, out.scheduled ? 'scheduled' : 'published', id, {}, 'high');
    return this.get(ctx, id);
  }
  private async move(ctx: PlatformActor, id: string, expectedVersion: number | null | undefined, to: 'paused' | 'published' | 'archived', action: 'paused' | 'resumed' | 'archived') {
    this.need(ctx, MANAGE);
    const changed = await this.db.transaction().execute(async (trx) => {
      const n = await this.lock(trx, id);
      if (n.lifecycle_status === to) return false;   // a repeated click is one transition
      if (n.lifecycle_status === 'archived') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED');
      if (action === 'resumed' && n.lifecycle_status !== 'paused') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_STATE', 'Only a paused announcement can be resumed.');
      if (action === 'paused' && n.lifecycle_status !== 'published') throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_STATE', 'Only a published announcement can be paused.');
      this.checkVersion(n, expectedVersion);
      if (action === 'resumed' && n.ends_at && new Date(n.ends_at as string).getTime() <= await this.clock(trx)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE', 'Its end time has passed — change the end time first.');
      if (action === 'resumed') {   // WP-F §57: going live again follows the publish rule
        const v = viProblem({ type: String(n.type), priority: String(n.priority), messageVi: (n.message_vi as string) ?? null, viReviewed: !!n.vi_reviewed_at, englishOnly: !!n.english_only });
        if (v) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED', v);
      }
      assertTransition(PLATFORM_NOTICE, String(n.lifecycle_status), to);
      await trx.updateTable('platform_notices').set({ lifecycle_status: to, ...(to === 'paused' ? { paused_at: sql`now()` } : {}), ...(to === 'published' ? { paused_at: null } : {}),
        ...(to === 'archived' ? { archived_at: sql`now()` } : {}), version: sql`version + 1`, updated_by: uuidOrNull(ctx.userId), updated_at: sql`now()` } as never)
        .where('id', '=', id).where('version', '=', Number(n.version)).execute();
      const after = await this.revision(trx, ctx, id, action);
      // a draft archived never reached a POS — nothing to tell
      if (n.lifecycle_status !== 'draft') await this.notify(trx, DOMAIN_EVENTS.ANNOUNCEMENT_CHANGED, after, [{ audience: String(n.audience), targets: await this.targetsOf(trx, id) }], action);
      return true;
    });
    if (changed) await this.audit(ctx, action, id, {}, action === 'archived' ? 'medium' : 'high');
    return this.get(ctx, id);
  }
  /** §18: pause hides it from every POS at once, without deleting it. */
  pause(ctx: PlatformActor, id: string, b: { expectedVersion?: number | null } = {}) { return this.move(ctx, id, b.expectedVersion, 'paused', 'paused'); }
  resume(ctx: PlatformActor, id: string, b: { expectedVersion?: number | null } = {}) { return this.move(ctx, id, b.expectedVersion, 'published', 'resumed'); }
  /** §20, §131: archive keeps the history; nothing published is ever deleted. */
  archive(ctx: PlatformActor, id: string, b: { expectedVersion?: number | null } = {}) { return this.move(ctx, id, b.expectedVersion, 'archived', 'archived'); }
  /** §130: copy an old announcement into a new DRAFT (never republished automatically). */
  async duplicate(ctx: PlatformActor, id: string) {
    this.need(ctx, MANAGE);
    const newId = await this.db.transaction().execute(async (trx) => {
      const n = await this.lock(trx, id);
      const ins = await trx.insertInto('platform_notices').values({ title: n.title as string | null, message: String(n.message), type: String(n.type), priority: String(n.priority), audience: String(n.audience),
        lifecycle_status: 'draft', starts_at: null, ends_at: null, dismissible: !!n.dismissible, requires_ack: !!n.requires_ack, duplicated_from: id,
        // WP-F: the Vietnamese wording comes along; its review does not (the copy is re-reviewed before it goes live)
        title_vi: (n.title_vi as string) ?? null, message_vi: (n.message_vi as string) ?? null, english_only: !!n.english_only,
        created_by: uuidOrNull(ctx.userId), updated_by: uuidOrNull(ctx.userId) } as never).returning('id').executeTakeFirstOrThrow();
      await this.writeTargets(trx, String(ins.id), await this.targetsOf(trx, id));
      await this.revision(trx, ctx, String(ins.id), 'duplicated');
      return String(ins.id);
    });
    await this.audit(ctx, 'duplicated', newId, { from: id }, 'low');
    return this.get(ctx, newId);
  }

  // ── POS ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** §71–§73, §67–§69, §87–§88: the signed-in employee's snapshot. Tenant and branch come from the SESSION; the query
   *  matches all-tenant, this-salon and this-branch notices only, inside their window on the database clock. */
  async active(ctx: PosActor) {
    if (!ctx?.tenantId || !UUID.test(ctx.tenantId)) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ACCESS_DENIED');
    const tenantId = ctx.tenantId, branchId = uuidOrNull(ctx.branchId), userId = uuidOrNull(ctx.userId);
    const rows = await sql<Row>`SELECT n.id, n.title, n.message, n.title_vi, n.message_vi, n.english_only, n.type, n.priority, n.dismissible, n.requires_ack, n.starts_at, n.ends_at, n.version, n.content_version, n.published_at,
        EXISTS (SELECT 1 FROM platform_notice_receipts r WHERE r.tenant_id = ${tenantId} AND r.notice_id = n.id AND r.user_id = ${userId} AND r.kind = 'dismissed' AND r.content_version = n.content_version) AS dismissed,
        EXISTS (SELECT 1 FROM platform_notice_receipts r WHERE r.tenant_id = ${tenantId} AND r.notice_id = n.id AND r.user_id = ${userId} AND r.kind = 'acknowledged' AND r.content_version = n.content_version) AS acknowledged
      FROM platform_notices n
      WHERE n.lifecycle_status = 'published' AND 'pos' = ANY (n.surfaces)
        AND (n.starts_at IS NULL OR n.starts_at <= now()) AND (n.ends_at IS NULL OR n.ends_at > now())
        AND (n.audience = 'all_tenants'
          OR (n.audience = 'selected_tenants' AND EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = ${tenantId} AND t.target_type = 'tenant'))
          OR (n.audience = 'selected_branches' AND ${branchId}::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = ${tenantId} AND t.target_type = 'branch' AND t.branch_id = ${branchId}::uuid)))`.execute(this.db);
    // the next instant anything this salon could see starts or ends — the POS refetches then (no scheduler, no refresh)
    const next = await sql<{ at: string | null }>`SELECT min(x) AS at FROM (
        SELECT n.starts_at AS x FROM platform_notices n WHERE n.lifecycle_status = 'published' AND n.starts_at > now()
          AND (n.audience = 'all_tenants' OR EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = ${tenantId} AND (t.target_type = 'tenant' OR t.branch_id = ${branchId}::uuid)))
        UNION ALL
        SELECT n.ends_at FROM platform_notices n WHERE n.lifecycle_status = 'published' AND n.ends_at > now()
          AND (n.audience = 'all_tenants' OR EXISTS (SELECT 1 FROM platform_notice_targets t WHERE t.notice_id = n.id AND t.tenant_id = ${tenantId} AND (t.target_type = 'tenant' OR t.branch_id = ${branchId}::uuid)))) s`.execute(this.db);
    const nowMs = await this.clock(this.db);
    const list = rows.rows.filter((r) => !(r.dismissed && r.dismissible))
      .map((r) => ({ id: String(r.id), title: (r.title as string) ?? null, message: String(r.message),
        // WP-F §56: both versions travel in the snapshot; the POS picks by its CURRENT language (no refetch on a switch)
        titleVi: r.english_only || !r.message_vi ? null : ((r.title_vi as string) ?? null), messageVi: r.english_only ? null : ((r.message_vi as string) ?? null),
        type: r.type as never, priority: r.priority as never, dismissible: !!r.dismissible,
        requiresAcknowledgement: !!r.requires_ack, acknowledged: !!r.acknowledged, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), version: Number(r.version), contentVersion: Number(r.content_version),
        publishedAt: iso(r.published_at) }))
      .sort(compareForDisplay)
      .map(({ publishedAt: _p, ...x }) => x);
    return { announcements: list, serverTime: new Date(nowMs).toISOString(), nextChangeAt: iso(next.rows[0]?.at) };
  }
  /** §38, §132–§136, §117: dismiss / acknowledge / first delivery — per USER and content version, tied to the signed-in
   *  employee (a shared terminal records who). Only for a notice this employee can see; a non-dismissible notice cannot
   *  be dismissed. Repeats are one record. */
  async receipt(ctx: PosActor, id: string, kind: 'delivered' | 'dismissed' | 'acknowledged', contentVersion: number) {
    const userId = uuidOrNull(ctx.userId);
    if (!ctx?.tenantId || !UUID.test(ctx.tenantId) || !userId) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_ACCESS_DENIED');
    const visible = (await this.active(ctx)).announcements.find((a) => a.id === id) ?? null;
    // a dismissed notice is filtered out of the snapshot — a repeated dismiss of the same version is still a success
    if (!visible) {
      const already = await this.db.selectFrom('platform_notice_receipts').select('id').where('tenant_id', '=', ctx.tenantId).where('notice_id', '=', id).where('user_id', '=', userId).where('kind', '=', kind).where('content_version', '=', Number(contentVersion)).executeTakeFirst();
      if (already) return { id, kind, contentVersion: Number(contentVersion), recorded: false };
      throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_NOT_FOUND');
    }
    if (kind === 'dismissed' && !visible.dismissible) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_STATE', 'This announcement cannot be dismissed.');
    if (kind === 'acknowledged' && !visible.requiresAcknowledgement) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_INVALID_STATE', 'This announcement does not ask for an acknowledgement.');
    if (Number(contentVersion) !== visible.contentVersion) throw new PlatformNoticeError('PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT', 'The announcement changed — read the new version first.', { contentVersion: visible.contentVersion });
    const ins = await this.db.insertInto('platform_notice_receipts').values({ tenant_id: ctx.tenantId, notice_id: id, user_id: userId, branch_id: uuidOrNull(ctx.branchId), kind, content_version: visible.contentVersion })
      .onConflict((oc) => oc.columns(['tenant_id', 'notice_id', 'user_id', 'kind', 'content_version']).doNothing()).returning('id').executeTakeFirst();
    return { id, kind, contentVersion: visible.contentVersion, recorded: !!ins };
  }
}

export type { NoticeStatus };
