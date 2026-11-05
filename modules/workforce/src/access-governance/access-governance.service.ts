// access-governance.service.ts — BUILD_PLAN Phase 9 (Constitution 2 §153): the owner's access governance behind
// /pos/security — access reviews, the high-risk report, dormant accounts and permission-denial metrics — plus the daily
// dormant-account alert job (one owner alert per dormant account per dormancy episode, acting as worker:dormant-accounts).
//
// A REVIEW snapshots every active team member with the high-risk keys they can use at that moment (decided by the same
// decide() the guards use — role / template, overrides, temporary access). Decisions:
//   keep    — recorded
//   change  — the person moves to another role template through StaffRolesService (same ceiling and audit as the
//             Roles & Permissions screen: never above the reviewer's own permissions, never the last owner)
//   revoke  — users.status = 'inactive' (the users trigger bumps their authorization version; their sessions are revoked)
//             in one transaction with the authorization audit row + AUTHORIZATION_CHANGED; never the last active owner
// Every query names the salon (tenant_id) from the trusted context.
import { sql, type Kysely } from 'kysely';
import type { OutboxWriter } from '@aipowersalon/events';
import { isStaffPrincipal, workerPrincipal, hasPermission, type PermissionSensitivity } from '@aipowersalon/permissions';
import {
  StaffRolesService, KyselyStaffRolesStore, StaffRoleError, KyselyAuthorizationStatePort, recordAuthorizationChange, assertNotLastOwner, LAST_OWNER,
  type AuthorizationStateCache, type AuthorizationStatePort,
} from '@aipowersalon/identity';
import type { AccessReviewView, AccessReviewDecision, HighRiskAccessReport, DormantAccountsReport, PermissionDenialMetrics } from '@aipowersalon/api-contracts/tenant';
import { highRiskGrants, dormantRows, dormantThreshold, dormantEpisodeKey, validateReviewDecision, denialMetrics, denialWindow, type DormantCandidate } from './access-governance.core';
import { assertTransition, canMoveToSql } from '@aipowersalon/database';
import { USER_ACCOUNT } from '@aipowersalon/identity';
import { ACCESS_REVIEW } from '../workforce-lifecycles';

export interface GovernanceActor { tenantId: string; userId: string; role: string; permissions: string[]; ip?: string | null }
export class GovernanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'GovernanceError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);
const nameOf = (r: any): string => r?.full_name || [r?.first_name, r?.last_name].filter(Boolean).join(' ') || r?.email || '—';
const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);

export class AccessGovernanceService {
  private readonly states: AuthorizationStatePort;
  constructor(
    private readonly db: Kysely<any>,
    private readonly outbox: OutboxWriter | null = null,
    private readonly cache: AuthorizationStateCache | null = null,
    states?: AuthorizationStatePort | null,
    private readonly clock: () => number = () => Date.now(),
  ) { this.states = states ?? new KyselyAuthorizationStatePort(db); }

  // ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The salon's staff accounts (never customers, displays or the platform). */
  private async staff(tenantId: string): Promise<any[]> {
    const r = await sql`select id, full_name, first_name, last_name, email, role, coalesce(status, 'active') as status, last_login_at, created_at
        from users where tenant_id = ${tenantId} order by coalesce(full_name, email, id::text)`.execute(this.db);
    return rowsOf(r).filter((u) => isStaffPrincipal(String(u.role)));
  }

  private async memberRisk(tenantId: string, u: any) {
    const st = await this.states.load(String(u.id), tenantId);
    if (!st || !st.member) return { templateKey: null as string | null, grants: [] as ReturnType<typeof highRiskGrants> };
    const grants = highRiskGrants({ userId: st.userId, tenantId, role: st.role, status: st.status, templateKey: st.templateKey, scope: st.scope, grant: st.grant, overrides: st.overrides }, this.clock());
    return { templateKey: st.templateKey, grants };
  }

  async highRisk(a: GovernanceActor): Promise<HighRiskAccessReport> {
    const rows: HighRiskAccessReport['rows'] = [];
    for (const u of await this.staff(a.tenantId)) {
      if (String(u.status).toLowerCase() !== 'active') continue;
      const { grants } = await this.memberRisk(a.tenantId, u);
      if (grants.length) rows.push({ userId: String(u.id), name: nameOf(u), role: String(u.role), permissions: grants.map((g) => ({ key: g.key, sensitivity: g.sensitivity as PermissionSensitivity, via: g.via })) });
    }
    rows.sort((x, y) => y.permissions.length - x.permissions.length || x.name.localeCompare(y.name));
    return { generatedAt: new Date(this.clock()).toISOString(), rows };
  }

  async dormant(a: GovernanceActor, daysRaw?: unknown): Promise<DormantAccountsReport> {
    const days = dormantThreshold(daysRaw);
    const users: DormantCandidate[] = (await this.staff(a.tenantId)).map((u) => ({ userId: String(u.id), name: nameOf(u), role: String(u.role), status: String(u.status), lastLoginAt: iso(u.last_login_at), createdAt: iso(u.created_at) }));
    return { generatedAt: new Date(this.clock()).toISOString(), thresholdDays: days, rows: dormantRows(users, days, this.clock()) };
  }

  async denials(a: GovernanceActor, fromRaw?: unknown, toRaw?: unknown): Promise<PermissionDenialMetrics> {
    const w = denialWindow(fromRaw, toRaw, this.clock());
    if (!w) throw new GovernanceError(400, 'VALIDATION_FAILED', 'from / to must be dates, from before to, at most 92 days apart.');
    const r = await sql`select d.permission, d.reason, d.user_id, sum(d.count)::int as n, max(u.full_name) as full_name, max(u.first_name) as first_name, max(u.last_name) as last_name, max(u.email) as email
        from authorization_denials d left join users u on u.id = d.user_id and u.tenant_id = d.tenant_id
       where d.tenant_id = ${a.tenantId} and d.last_at >= ${w.from}::timestamptz and d.first_at <= ${w.to}::timestamptz
       group by d.permission, d.reason, d.user_id`.execute(this.db);
    return denialMetrics(rowsOf(r).map((x) => ({ permission: String(x.permission), reason: String(x.reason), userId: x.user_id ? String(x.user_id) : null, name: x.user_id ? nameOf(x) : null, count: Number(x.n) || 0 })), w.from, w.to);
  }

  // ── access reviews ──────────────────────────────────────────────────────────────────────────────────────────────
  private async view(tenantId: string, id: string): Promise<AccessReviewView> {
    if (!UUID.test(id)) throw new GovernanceError(404, 'RESOURCE_NOT_FOUND', 'That access review does not exist.');
    const r: any = rowsOf(await sql`select ar.*, u.full_name, u.first_name, u.last_name, u.email from access_reviews ar
        left join users u on u.id = ar.started_by_user_id and u.tenant_id = ar.tenant_id where ar.id = ${id} and ar.tenant_id = ${tenantId}`.execute(this.db))[0];
    if (!r) throw new GovernanceError(404, 'RESOURCE_NOT_FOUND', 'That access review does not exist.');
    const items = rowsOf(await sql`select user_id, name, role, template_key, high_risk_permissions, last_login_at, decision, note, decided_at, change_template_key
        from access_review_items where review_id = ${id} and tenant_id = ${tenantId} order by name`.execute(this.db));
    return {
      id: String(r.id), status: r.status, startedByName: r.started_by_user_id ? nameOf(r) : null, dueAt: iso(r.due_at), createdAt: iso(r.created_at)!, completedAt: iso(r.completed_at),
      items: items.map((i) => ({ userId: String(i.user_id), name: String(i.name), role: String(i.role), templateKey: i.decision === 'change' ? (i.change_template_key ?? i.template_key ?? null) : (i.template_key ?? null),
        highRiskPermissions: Array.isArray(i.high_risk_permissions) ? i.high_risk_permissions.map(String) : [], lastLoginAt: iso(i.last_login_at),
        decision: i.decision ?? null, note: i.note ?? null, decidedAt: iso(i.decided_at) })),
    };
  }

  async listReviews(a: GovernanceActor): Promise<AccessReviewView[]> {
    const ids = rowsOf(await sql`select id from access_reviews where tenant_id = ${a.tenantId} order by created_at desc limit 50`.execute(this.db));
    const out: AccessReviewView[] = [];
    for (const r of ids) out.push(await this.view(a.tenantId, String(r.id)));
    return out;
  }

  getReview(a: GovernanceActor, id: string): Promise<AccessReviewView> { return this.view(a.tenantId, id); }

  async startReview(a: GovernanceActor, body: { dueAt?: string | null } | null): Promise<AccessReviewView> {
    let dueAt: string | null = null;
    if (body?.dueAt) {
      const t = Date.parse(String(body.dueAt));
      if (!Number.isFinite(t) || t <= this.clock()) throw new GovernanceError(400, 'VALIDATION_FAILED', 'dueAt must be a date in the future.');
      dueAt = new Date(t).toISOString();
    }
    // the snapshot is computed BEFORE the transaction (it reads through the authorization-state port)
    const snapshot: { userId: string; name: string; role: string; templateKey: string | null; highRisk: string[]; lastLoginAt: string | null }[] = [];
    for (const u of await this.staff(a.tenantId)) {
      if (String(u.status).toLowerCase() !== 'active') continue;
      const { templateKey, grants } = await this.memberRisk(a.tenantId, u);
      snapshot.push({ userId: String(u.id), name: nameOf(u), role: String(u.role), templateKey, highRisk: grants.map((g) => g.key), lastLoginAt: iso(u.last_login_at) });
    }
    let id: string;
    try {
      id = await this.db.transaction().execute(async (trx) => {
        const row: any = rowsOf(await sql`insert into access_reviews (tenant_id, started_by_user_id, due_at) values (${a.tenantId}, ${a.userId}, ${dueAt}::timestamptz) returning id`.execute(trx))[0];
        for (const s of snapshot) {
          await sql`insert into access_review_items (tenant_id, review_id, user_id, name, role, template_key, high_risk_permissions, last_login_at)
              values (${a.tenantId}, ${row.id}, ${s.userId}, ${s.name}, ${s.role}, ${s.templateKey}, ${JSON.stringify(s.highRisk)}::jsonb, ${s.lastLoginAt}::timestamptz)`.execute(trx);
        }
        await sql`insert into authorization_audit_events (tenant_id, actor_user_id, action, after_state, ip)
            values (${a.tenantId}, ${a.userId}, 'access_review.started', ${JSON.stringify({ reviewId: row.id, members: snapshot.length, dueAt })}::jsonb, ${a.ip ?? null})`.execute(trx);
        return String(row.id);
      });
    } catch (e: any) {
      if (String(e?.code) === '23505') throw new GovernanceError(409, 'CONFLICT', 'An access review is already open. Complete it before starting another.');
      throw e;
    }
    return this.view(a.tenantId, id);
  }

  async decide(a: GovernanceActor, reviewId: string, input: Partial<AccessReviewDecision> | null): Promise<AccessReviewView> {
    const v = validateReviewDecision(input, a.userId);
    if (!v.ok) throw new GovernanceError(v.code === 'PERMISSION_DENIED' ? 403 : 400, v.code, v.message);
    const d = v.value;
    const review = await this.view(a.tenantId, reviewId);   // 404 for another salon's review
    if (review.status !== 'open') throw new GovernanceError(409, 'CONFLICT', 'This access review is closed.');
    const item = review.items.find((i) => i.userId === d.userId);
    if (!item) throw new GovernanceError(404, 'RESOURCE_NOT_FOUND', 'That person is not part of this review.');
    if (item.decision) throw new GovernanceError(409, 'CONFLICT', 'A decision was already recorded for this person.');

    const claim = (trx: any) => sql`update access_review_items set decision = ${d.decision}, note = ${d.note ?? null}, change_template_key = ${d.templateKey ?? null},
          decided_by_user_id = ${a.userId}, decided_at = now()
        where review_id = ${reviewId} and tenant_id = ${a.tenantId} and user_id = ${d.userId} and decision is null returning id`.execute(trx);
    const conflict = () => new GovernanceError(409, 'CONFLICT', 'A decision was already recorded for this person.');
    if (d.decision === 'change') {
      // claim the item first (a concurrent reviewer gets 409 and changes nothing), then the role change through the same
      // path as the Roles & Permissions screen (ceiling = the reviewer's own permissions, last-owner protected, audited);
      // a refused change releases the claim
      if (!rowsOf(await claim(this.db)).length) throw conflict();
      try {
        await new StaffRolesService(new KyselyStaffRolesStore(this.db)).assignRole({ tenantId: a.tenantId, userId: a.userId, role: a.role, permissions: a.permissions, ip: a.ip ?? null }, d.userId, d.templateKey!, { reason: `access review: ${d.note ?? 'role changed'}` });
      } catch (e) {
        await sql`update access_review_items set decision = null, note = null, change_template_key = null, decided_by_user_id = null, decided_at = null
            where review_id = ${reviewId} and tenant_id = ${a.tenantId} and user_id = ${d.userId}`.execute(this.db);
        if (e instanceof StaffRoleError) throw new GovernanceError(e.code === 'CONFLICT' ? 409 : e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 400, e.reason ?? (e.code === 'FORBIDDEN' ? 'PERMISSION_DENIED' : e.code === 'CONFLICT' ? 'CONFLICT' : e.code === 'NOT_FOUND' ? 'RESOURCE_NOT_FOUND' : 'VALIDATION_FAILED'), e.message);
        throw e;
      }
      await this.db.transaction().execute(async (trx) => {
        await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: d.userId, action: 'access_review.decided',
          before: { role: item.role, templateKey: item.templateKey }, after: { decision: 'change', templateKey: d.templateKey, reviewId }, reason: d.note ?? null, ip: a.ip ?? null });
      });
    } else {
      try {
        await this.db.transaction().execute(async (trx) => {
          if (!rowsOf(await claim(trx)).length) throw conflict();
          if (d.decision === 'revoke') {
            await assertNotLastOwner(trx, a.tenantId, d.userId);
            const before: any = rowsOf(await sql`select role, coalesce(status, 'active') as status from users where id = ${d.userId} and tenant_id = ${a.tenantId} for update`.execute(trx))[0];
            if (!before) throw new GovernanceError(404, 'RESOURCE_NOT_FOUND', 'That person is not a staff member of this salon.');
            assertTransition(USER_ACCOUNT, before.status, 'inactive');   // Phase 12 (#27): the one user-account machine (identity)
            await sql`update users set status = 'inactive', updated_at = now() where id = ${d.userId} and tenant_id = ${a.tenantId} and (status is null or ${canMoveToSql(USER_ACCOUNT, 'inactive')})`.execute(trx);
            await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: d.userId, action: 'access_review.decided',
              before: { status: before.status, role: before.role }, after: { status: 'inactive', decision: 'revoke', reviewId }, reason: d.note ?? null, ip: a.ip ?? null });
          } else {
            await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: d.userId, action: 'access_review.decided',
              before: { role: item.role, templateKey: item.templateKey }, after: { decision: 'keep', reviewId }, reason: d.note ?? null, ip: a.ip ?? null });
          }
        });
      } catch (e) {
        if (e instanceof StaffRoleError && e.reason === LAST_OWNER) throw new GovernanceError(409, LAST_OWNER, e.message);
        throw e;
      }
    }
    if (d.decision === 'revoke') {
      // their live sessions end now (the version bump alone would re-authorize them as inactive on the next request)
      if (this.cache) await this.cache.revokeUserSessions(d.userId); else await this.states.revokeUserSessions(d.userId);
    } else this.cache?.invalidateUser(d.userId);
    return this.view(a.tenantId, reviewId);
  }

  async complete(a: GovernanceActor, reviewId: string): Promise<AccessReviewView> {
    const review = await this.view(a.tenantId, reviewId);
    if (review.status !== 'open') throw new GovernanceError(409, 'CONFLICT', 'This access review is already closed.');
    const open = review.items.filter((i) => !i.decision);
    if (open.length) throw new GovernanceError(409, 'CONFLICT', `${open.length} ${open.length === 1 ? 'person still needs' : 'people still need'} a decision.`);
    await this.db.transaction().execute(async (trx) => {
      const r = rowsOf(await sql`update access_reviews set status = 'completed', completed_at = now(), completed_by_user_id = ${a.userId}
          where id = ${reviewId} and tenant_id = ${a.tenantId} and status = 'open' and ${canMoveToSql(ACCESS_REVIEW, 'completed')} returning id`.execute(trx));
      if (!r.length) throw new GovernanceError(409, 'CONFLICT', 'This access review is already closed.');
      const kept = review.items.filter((i) => i.decision === 'keep').length, revoked = review.items.filter((i) => i.decision === 'revoke').length;
      await sql`insert into authorization_audit_events (tenant_id, actor_user_id, action, after_state, ip)
          values (${a.tenantId}, ${a.userId}, 'access_review.completed', ${JSON.stringify({ reviewId, kept, revoked, changed: review.items.length - kept - revoked })}::jsonb, ${a.ip ?? null})`.execute(trx);
    });
    return this.view(a.tenantId, reviewId);
  }

  // ── the dormant-account job ─────────────────────────────────────────────────────────────────────────────────────
  /** One salon: raise ONE owner alert per dormant account per dormancy episode. Acts as worker:dormant-accounts. */
  async alertDormantForTenant(tenantId: string, days = 60): Promise<number> {
    const worker = workerPrincipal('dormant-accounts', { tenantId });
    if (!hasPermission(worker as any, 'security_reports.view')) return 0;   // the job's own grant, checked like anyone's
    const report = await this.dormant({ tenantId, userId: worker.userId, role: worker.role, permissions: worker.permissions }, days);
    let raised = 0;
    for (const row of report.rows) {
      raised += await this.db.transaction().execute(async (trx) => {
        const claimed = rowsOf(await sql`insert into dormant_account_alerts (tenant_id, user_id, episode_key, days_dormant)
            values (${tenantId}, ${row.userId}, ${dormantEpisodeKey(row.lastLoginAt)}, ${row.daysSince}) on conflict do nothing returning id`.execute(trx));
        if (!claimed.length) return 0;
        const body = row.lastLoginAt ? `${row.name} (${row.role}) has not signed in for ${row.daysSince} days but still has access. Review it in Security → Dormant accounts.`
          : `${row.name} (${row.role}) has never signed in but still has access. Review it in Security → Dormant accounts.`;
        const alert: any = rowsOf(await sql`insert into owner_alerts (tenant_id, category, severity, status, title, body, metadata, audience)
            values (${tenantId}, 'security', 'warning', 'new', 'Dormant staff account', ${body},
                    ${JSON.stringify({ kind: 'dormant_account', userId: row.userId, daysSince: row.daysSince, thresholdDays: report.thresholdDays, actor: worker.actor })}::jsonb, 'owner') returning id`.execute(trx))[0];
        await sql`update dormant_account_alerts set owner_alert_id = ${alert?.id ?? null} where id = ${claimed[0].id} and tenant_id = ${tenantId}`.execute(trx);
        return 1;
      });
    }
    return raised;
  }

  /** Salons with at least one active staff account quiet for `days` (the job's work list). */
  async tenantsWithDormant(days = 60, limit = 500): Promise<string[]> {
    const r = await sql`select distinct tenant_id from users
        where tenant_id is not null and coalesce(status, 'active') = 'active' and role not in ('SUPER_ADMIN', 'CUSTOMER', 'CUSTOMER_DISPLAY')
          and coalesce(last_login_at, created_at) < now() - make_interval(days => ${days}) limit ${limit}`.execute(this.db);
    return rowsOf(r).map((x) => String(x.tenant_id)).filter((t) => UUID.test(t));
  }
}
