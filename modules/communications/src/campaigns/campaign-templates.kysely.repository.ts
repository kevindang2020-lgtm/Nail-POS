// Kysely (Postgres) templates repo. create inserts the template + version 1; addVersion inserts a new immutable
// version (unique per template+version); setStatusAndVersion updates status/current_version. Audits create/version.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TemplateInput } from './campaign-template-core';
import type { TemplateRepo, TemplateRow, TemplateVersionRow } from './campaign-templates.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { CAMPAIGN_TEMPLATE } from '../communications-lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapT = (r: any): TemplateRow => ({
  id: r.id, name: r.name, campaignType: r.campaign_type, channel: r.channel, subject: r.subject, body: r.body,
  smsContent: r.sms_content, pushTitle: r.push_title, pushContent: r.push_content, suggestedAudience: r.suggested_audience,
  suggestedOffer: r.suggested_offer, complianceNote: r.compliance_note, status: r.status, currentVersion: Number(r.current_version || 1),
  createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at) as string, updatedAt: iso(r.updated_at) as string,
});
const mapV = (r: any): TemplateVersionRow => ({ id: r.id, templateId: r.template_id, version: Number(r.version), subject: r.subject, body: r.body, channel: r.channel, notes: r.notes, published: !!r.published, createdAt: iso(r.created_at) as string });

export class KyselyTemplateRepo implements TemplateRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async list(scope: { status?: string; cap?: number }): Promise<TemplateRow[]> {
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    try { const r = await sql<any>`SELECT * FROM campaign_templates WHERE 1=1 ${st} ORDER BY created_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db); return r.rows.map(mapT); } catch { return []; }
  }
  async get(id: string): Promise<TemplateRow | null> {
    try { const r = await sql<any>`SELECT * FROM campaign_templates WHERE id = ${id} LIMIT 1`.execute(this.db); return r.rows[0] ? mapT(r.rows[0]) : null; } catch { return null; }
  }
  async create(input: TemplateInput & { campaignType?: string; suggestedAudience?: string | null; suggestedOffer?: string | null; complianceNote?: string | null; createdByUserId: string | null }): Promise<TemplateRow> {
    const ins = await sql<any>`
      INSERT INTO campaign_templates (name, campaign_type, channel, subject, body, sms_content, push_title, push_content, suggested_audience, suggested_offer, compliance_note, created_by_user_id)
      VALUES (${input.name}, ${input.campaignType || 'promotional'}, ${input.channel ?? 'email'}, ${input.subject ?? null}, ${input.body ?? null}, ${input.smsContent ?? null}, ${input.pushTitle ?? null}, ${input.pushContent ?? null}, ${input.suggestedAudience ?? null}, ${input.suggestedOffer ?? null}, ${input.complianceNote ?? null}, ${input.createdByUserId})
      RETURNING *`.execute(this.db);
    const t = mapT(ins.rows[0]);
    await sql`INSERT INTO campaign_template_versions (template_id, version, subject, body, channel, notes, published, created_by_user_id) VALUES (${t.id}, 1, ${t.subject}, ${t.body}, ${t.channel}, 'Initial version', false, ${input.createdByUserId})`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('campaign_template_created', 'campaign_template', ${t.id}, ${input.createdByUserId}, now())`.execute(this.db); } catch { /* best-effort */ }
    return t;
  }
  async addVersion(templateId: string, v: { subject?: string | null; body?: string | null; channel?: string | null; notes?: string | null; published: boolean; createdByUserId: string | null }): Promise<TemplateVersionRow | null> {
    const t = await this.get(templateId);
    if (!t) return null;
    const version = t.currentVersion + 1;
    const ins = await sql<any>`
      INSERT INTO campaign_template_versions (template_id, version, subject, body, channel, notes, published, created_by_user_id)
      VALUES (${templateId}, ${version}, ${v.subject ?? null}, ${v.body ?? null}, ${v.channel ?? null}, ${v.notes ?? null}, ${v.published}, ${v.createdByUserId})
      RETURNING *`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('campaign_template_versioned', 'campaign_template', ${templateId}, ${v.createdByUserId}, now())`.execute(this.db); } catch { /* best-effort */ }
    return mapV(ins.rows[0]);
  }
  async setStatusAndVersion(templateId: string, status: string, currentVersion: number): Promise<TemplateRow | null> {
    const r = await sql<any>`UPDATE campaign_templates SET status = ${status}, current_version = ${currentVersion}, updated_at = now() WHERE id = ${templateId} AND ${canMoveToSql(CAMPAIGN_TEMPLATE, status)} RETURNING *`.execute(this.db);
    return r.rows[0] ? mapT(r.rows[0]) : null;
  }
  async listVersions(templateId: string): Promise<TemplateVersionRow[]> {
    try { const r = await sql<any>`SELECT * FROM campaign_template_versions WHERE template_id = ${templateId} ORDER BY version DESC`.execute(this.db); return r.rows.map(mapV); } catch { return []; }
  }
}
