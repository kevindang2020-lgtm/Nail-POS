// ai-business-reports.kysely.repository.ts — Postgres adapter. Tenant-scoped from ctx. Content stored inline as JSONB.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { AI_BUSINESS_REPORT_JOB } from '../analytics-lifecycles';
import type { ReportJob, ReportContext, ReportType, ReportsJobRepositoryPort } from './ai-business-reports.repository';

function toDomain(r: any): ReportJob {
  const expiresAt = r.expires_at ? new Date(r.expires_at).toISOString() : '';
  const expired = expiresAt ? Date.parse(expiresAt) < Date.now() : false;
  let content = r.content ?? null;
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch { /* leave as-is */ } }
  return {
    id: String(r.id), reportType: String(r.report_type) as ReportType, preset: String(r.preset),
    status: String(r.status) as ReportJob['status'], content: expired ? null : content, error: r.error ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    expiresAt, expired,
  };
}
const COLS = ['id', 'report_type', 'preset', 'status', 'content', 'error', 'created_at', 'started_at', 'completed_at', 'expires_at'] as const;

export class KyselyReportsJobRepository implements ReportsJobRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async create(ctx: ReportContext, reportType: ReportType, preset: string): Promise<ReportJob> {
    const row = await this.db.insertInto('ai_business_report_jobs').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, requested_by_user_id: ctx.userId,
      report_type: reportType, preset, status: 'queued',
    } as any).returning(COLS as any).executeTakeFirstOrThrow();
    return toDomain(row);
  }
  async get(ctx: ReportContext, id: string): Promise<ReportJob | null> {
    const r = await this.db.selectFrom('ai_business_report_jobs').where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .select(COLS as any).executeTakeFirst().catch(() => null);
    return r ? toDomain(r) : null;
  }
  async list(ctx: ReportContext): Promise<ReportJob[]> {
    const rows = await this.db.selectFrom('ai_business_report_jobs').where('tenant_id', '=', ctx.tenantId)
      .select(COLS as any).orderBy('created_at', 'desc').limit(100).execute().catch(() => [] as any[]);
    return (rows as any[]).map(toDomain);
  }
  async markRunning(ctx: ReportContext, id: string): Promise<void> {
    await this.db.updateTable('ai_business_report_jobs').set({ status: 'running', started_at: new Date() } as any)
      .where(canMoveToSql(AI_BUSINESS_REPORT_JOB, 'running') as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any).executeTakeFirst().catch(() => null);
  }
  async complete(ctx: ReportContext, id: string, content: unknown): Promise<ReportJob | null> {
    const row = await this.db.updateTable('ai_business_report_jobs')
      .set({ status: 'completed', content: sql`${JSON.stringify(content)}::jsonb`, completed_at: new Date() } as any)
      .where(canMoveToSql(AI_BUSINESS_REPORT_JOB, 'completed') as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .returning(COLS as any).executeTakeFirst().catch(() => null);
    return row ? toDomain(row) : null;
  }
  async fail(ctx: ReportContext, id: string, error: string): Promise<ReportJob | null> {
    const row = await this.db.updateTable('ai_business_report_jobs')
      .set({ status: 'failed', error, completed_at: new Date() } as any)
      .where(canMoveToSql(AI_BUSINESS_REPORT_JOB, 'failed') as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .returning(COLS as any).executeTakeFirst().catch(() => null);
    return row ? toDomain(row) : null;
  }
}
