// audit-retention.kysely.repository.ts + service — per-category audit retention policies with append-only versioning
// and an honest purge-eligibility preview. NEVER deletes a log row: the preview counts events that WOULD be eligible
// for archival/purge under the effective policy, excluding any event covered by an active legal hold.
import { sql } from 'kysely';
import { BadRequestException } from '@nestjs/common';
import type { AppDatabase } from '@aipowersalon/database';
import { retentionTotalDays } from './audit-logs-core';
import { canMoveToSql } from '@aipowersalon/database';
import { AUDIT_RETENTION_POLICY } from '../lifecycles';

export interface RetentionRow { id: string; category: string; hot_days: number; archive_days: number; version: number; status: string; reason: string | null; effective_date: string; created_at: string }
const COLS = sql`id::text as id, category, hot_days, archive_days, version, status, reason, effective_date::text as effective_date, created_at::text as created_at`;
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class AuditRetentionRepository {
  constructor(private readonly db: AppDatabase) {}

  async listActive(): Promise<RetentionRow[]> {
    try { return (await sql`select ${COLS} from audit_retention_policies where status = 'active' order by category`.execute(this.db as any)).rows as RetentionRow[]; } catch { return []; }
  }
  async history(category: string): Promise<RetentionRow[]> {
    return (await sql`select ${COLS} from audit_retention_policies where category = ${category} order by version desc`.execute(this.db as any)).rows as RetentionRow[];
  }
  /** Append-only version bump: supersede the current active row (if any) and insert the new active version in one txn. */
  async setVersion(i: { category: string; hotDays: number; archiveDays: number; reason: string | null; createdBy: string | null }): Promise<RetentionRow> {
    return await (this.db as any).transaction().execute(async (trx: any) => {
      const prev = (await sql`select coalesce(max(version), 0) as v from audit_retention_policies where category = ${i.category}`.execute(trx)).rows[0] as { v: number };
      await sql`update audit_retention_policies set status = 'superseded' where category = ${i.category} and status = 'active' and ${canMoveToSql(AUDIT_RETENTION_POLICY, 'superseded')}`.execute(trx);
      return (await sql`insert into audit_retention_policies (category, hot_days, archive_days, version, status, reason, created_by)
        values (${i.category}, ${i.hotDays}, ${i.archiveDays}, ${Number(prev.v) + 1}, 'active', ${i.reason}, ${i.createdBy})
        returning ${COLS}`.execute(trx)).rows[0] as RetentionRow;
    });
  }
  /** Count events per category that are past total retention AND not covered by any active legal hold. */
  async eligibilityPreview(category: string, totalDays: number): Promise<number> {
    if (totalDays <= 0) return 0;
    const r = (await sql`
      with cat_events as (
        select id, tenant_id, actor_user_id, action, occurred_at
        from audit_events
        where coalesce(module, 'other') = ${category} and occurred_at < now() - (${totalDays} || ' days')::interval
      )
      select count(*)::int as c from cat_events e
      where not exists (
        select 1 from audit_legal_holds h
        where h.status = 'active' and (
          h.scope_type = 'global'
          or (h.scope_type = 'tenant' and h.scope_value = e.tenant_id::text)
          or (h.scope_type = 'user' and h.scope_value = e.actor_user_id::text)
          or (h.scope_type = 'action' and position(lower(h.scope_value) in lower(coalesce(e.action,''))) > 0)
          or (h.scope_type = 'date_range' and e.occurred_at::date between split_part(h.scope_value,'|',1)::date and split_part(h.scope_value,'|',2)::date)
        )
      )`.execute(this.db as any)).rows[0] as { c: number };
    return r?.c ?? 0;
  }
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const CATEGORY_KEYS = ['auth', 'tenants', 'customers', 'payments', 'devices', 'integrations', 'security', 'ai', 'communications', 'smart-reminders', 'audit-logs', 'other'];
const shape = (r: RetentionRow) => ({ id: r.id, category: r.category, hotDays: r.hot_days, archiveDays: r.archive_days, version: r.version, status: r.status, reason: r.reason, effectiveDate: r.effective_date, createdAt: r.created_at });

export class AuditRetentionService {
  constructor(private readonly repo: AuditRetentionRepository) {}

  async list() {
    const rows = await this.repo.listActive();
    const policies = await Promise.all(rows.map(async (r) => ({ ...shape(r), totalDays: retentionTotalDays({ hotDays: r.hot_days, archiveDays: r.archive_days }), purgeEligible: await this.repo.eligibilityPreview(r.category, retentionTotalDays({ hotDays: r.hot_days, archiveDays: r.archive_days })) })));
    return { available: true as const, policies, categoriesConfigured: policies.length, note: 'Retention is computed and previewed only — this surface never deletes a log row, and legal holds always override retention.' };
  }

  async history(category: string) { return { category, versions: (await this.repo.history(category)).map(shape) }; }

  async setPolicy(ctx: AdminCtx, body: any) {
    const category = String(body?.category ?? '');
    if (!CATEGORY_KEYS.includes(category)) throw new BadRequestException('invalid category');
    const hotDays = Number(body?.hotDays);
    const archiveDays = Number(body?.archiveDays);
    if (!Number.isInteger(hotDays) || hotDays < 0 || !Number.isInteger(archiveDays) || archiveDays < 0) throw new BadRequestException('hotDays and archiveDays must be non-negative integers');
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    const row = await this.repo.setVersion({ category, hotDays, archiveDays, reason, createdBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    return { ok: true, policy: shape(row) };
  }
}
