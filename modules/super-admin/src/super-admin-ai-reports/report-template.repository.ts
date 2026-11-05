// Repository port for report templates (port + in-memory + Kysely). Versioning + status writes; the service validates
// every change through report-template-core first.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { TemplateSection } from './report-template-core';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_REPORT_TEMPLATE } from '../lifecycles';

export interface TemplateRow { id: string; reportKey: string; name: string; version: number; status: string; sections: TemplateSection[]; publishedAt: string | null; createdAt: string | null }
export interface InsertTemplateInput { reportKey: string; name: string; version: number; sections: TemplateSection[]; createdBy: string | null }

export interface ReportTemplateRepositoryPort {
  insert(input: InsertTemplateInput): Promise<TemplateRow>;
  get(id: string): Promise<TemplateRow | null>;
  listVersions(reportKey: string): Promise<number[]>;
  listByKey(reportKey: string): Promise<TemplateRow[]>;
  setStatus(id: string, status: string, publishedAt: string | null): Promise<TemplateRow | null>;
  archiveOtherPublished(reportKey: string, exceptId: string): Promise<void>;
  currentPublished(reportKey: string): Promise<TemplateRow | null>;
}

export class InMemoryReportTemplateRepository implements ReportTemplateRepositoryPort {
  rows: TemplateRow[] = [];
  private seq = 1;
  async insert(i: InsertTemplateInput): Promise<TemplateRow> {
    const row: TemplateRow = { id: `tpl${this.seq++}`, reportKey: i.reportKey, name: i.name, version: i.version, status: 'draft', sections: i.sections, publishedAt: null, createdAt: new Date().toISOString() };
    this.rows.push(row); return row;
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async listVersions(reportKey: string) { return this.rows.filter((r) => r.reportKey === reportKey).map((r) => r.version); }
  async listByKey(reportKey: string) { return this.rows.filter((r) => r.reportKey === reportKey); }
  async setStatus(id: string, status: string, publishedAt: string | null) { const r = this.rows.find((x) => x.id === id); if (!r) return null; r.status = status; if (publishedAt) r.publishedAt = publishedAt; return r; }
  async archiveOtherPublished(reportKey: string, exceptId: string) { for (const r of this.rows) if (r.reportKey === reportKey && r.id !== exceptId && r.status === 'published') r.status = 'archived'; }
  async currentPublished(reportKey: string) { return this.rows.filter((r) => r.reportKey === reportKey && r.status === 'published').sort((a, b) => b.version - a.version)[0] || null; }
}

const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): TemplateRow => ({ id: String(r.id), reportKey: r.report_key, name: r.name, version: Number(r.version) || 0, status: r.status, sections: r.sections || [], publishedAt: iso(r.published_at), createdAt: iso(r.created_at) });

export class KyselyReportTemplateRepository implements ReportTemplateRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async insert(i: InsertTemplateInput): Promise<TemplateRow> {
    const r: any = await sql`insert into ai_report_templates (report_key, name, version, status, sections, created_by) values (${i.reportKey}, ${i.name}, ${i.version}, 'draft', ${JSON.stringify(i.sections)}::jsonb, ${i.createdBy}) returning *`.execute(this.db as any).then((x) => x.rows[0]);
    return map(r);
  }
  async get(id: string) { const r: any = await sql`select * from ai_report_templates where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async listVersions(reportKey: string) { const rows: any[] = await sql`select version from ai_report_templates where report_key = ${reportKey}`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map((r) => Number(r.version) || 0); }
  async listByKey(reportKey: string) { const rows: any[] = await sql`select * from ai_report_templates where report_key = ${reportKey} order by version desc`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async setStatus(id: string, status: string, publishedAt: string | null) { const r: any = await sql`update ai_report_templates set status = ${status}, published_at = coalesce(${publishedAt}, published_at), updated_at = now() where id = ${id} and ${canMoveToSql(AI_REPORT_TEMPLATE, status)} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async archiveOtherPublished(reportKey: string, exceptId: string) { await sql`update ai_report_templates set status = 'archived', updated_at = now() where report_key = ${reportKey} and id <> ${exceptId} and status = 'published' and ${canMoveToSql(AI_REPORT_TEMPLATE, 'archived')}`.execute(this.db as any).catch(() => undefined); }
  async currentPublished(reportKey: string) { const r: any = await sql`select * from ai_report_templates where report_key = ${reportKey} and status = 'published' order by version desc limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
}
