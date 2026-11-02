// Repository for reusable campaign templates + immutable versions. In-memory impl is stateful so create, publish,
// and versioning (new version, never overwrite) are exercised without a database.

import type { TemplateInput } from './campaign-template-core';

export interface TemplateRow {
  id: string; name: string; campaignType: string; channel: string; subject: string | null; body: string | null;
  smsContent: string | null; pushTitle: string | null; pushContent: string | null; suggestedAudience: string | null;
  suggestedOffer: string | null; complianceNote: string | null; status: string; currentVersion: number;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
}
export interface TemplateVersionRow { id: string; templateId: string; version: number; subject: string | null; body: string | null; channel: string | null; notes: string | null; published: boolean; createdAt: string }

export interface TemplateRepo {
  list(scope: { status?: string; cap?: number }): Promise<TemplateRow[]>;
  get(id: string): Promise<TemplateRow | null>;
  create(input: TemplateInput & { campaignType?: string; suggestedAudience?: string | null; suggestedOffer?: string | null; complianceNote?: string | null; createdByUserId: string | null }): Promise<TemplateRow>;
  addVersion(templateId: string, v: { subject?: string | null; body?: string | null; channel?: string | null; notes?: string | null; published: boolean; createdByUserId: string | null }): Promise<TemplateVersionRow | null>;
  setStatusAndVersion(templateId: string, status: string, currentVersion: number): Promise<TemplateRow | null>;
  listVersions(templateId: string): Promise<TemplateVersionRow[]>;
}

let TSEQ = 1, TVSEQ = 1;

export class InMemoryTemplateRepo implements TemplateRepo {
  private templates: TemplateRow[] = [];
  private versions: TemplateVersionRow[] = [];

  async list(scope: { status?: string; cap?: number }): Promise<TemplateRow[]> {
    let r = [...this.templates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.status) r = r.filter((t) => t.status === scope.status);
    return r.slice(0, scope.cap ?? 200);
  }
  async get(id: string): Promise<TemplateRow | null> { return this.templates.find((t) => t.id === id) ?? null; }

  async create(input: TemplateInput & { campaignType?: string; suggestedAudience?: string | null; suggestedOffer?: string | null; complianceNote?: string | null; createdByUserId: string | null }): Promise<TemplateRow> {
    const nowIso = new Date().toISOString();
    const row: TemplateRow = {
      id: `TMPL-${String(TSEQ++).padStart(4, '0')}`, name: String(input.name), campaignType: input.campaignType || 'promotional',
      channel: String(input.channel ?? 'email'), subject: input.subject ?? null, body: input.body ?? null, smsContent: input.smsContent ?? null,
      pushTitle: input.pushTitle ?? null, pushContent: input.pushContent ?? null, suggestedAudience: input.suggestedAudience ?? null,
      suggestedOffer: input.suggestedOffer ?? null, complianceNote: input.complianceNote ?? null, status: 'draft', currentVersion: 1,
      createdByUserId: input.createdByUserId, createdAt: nowIso, updatedAt: nowIso,
    };
    this.templates.push(row);
    this.versions.push({ id: `TVER-${String(TVSEQ++).padStart(4, '0')}`, templateId: row.id, version: 1, subject: row.subject, body: row.body, channel: row.channel, notes: 'Initial version', published: false, createdAt: nowIso });
    return row;
  }
  async addVersion(templateId: string, v: { subject?: string | null; body?: string | null; channel?: string | null; notes?: string | null; published: boolean; createdByUserId: string | null }): Promise<TemplateVersionRow | null> {
    const t = this.templates.find((x) => x.id === templateId);
    if (!t) return null;
    const version = t.currentVersion + 1;
    const row: TemplateVersionRow = { id: `TVER-${String(TVSEQ++).padStart(4, '0')}`, templateId, version, subject: v.subject ?? null, body: v.body ?? null, channel: v.channel ?? null, notes: v.notes ?? null, published: v.published, createdAt: new Date().toISOString() };
    this.versions.push(row);
    return row;
  }
  async setStatusAndVersion(templateId: string, status: string, currentVersion: number): Promise<TemplateRow | null> {
    const t = this.templates.find((x) => x.id === templateId);
    if (!t) return null;
    t.status = status; t.currentVersion = currentVersion; t.updatedAt = new Date().toISOString();
    return t;
  }
  async listVersions(templateId: string): Promise<TemplateVersionRow[]> {
    return this.versions.filter((v) => v.templateId === templateId).sort((a, b) => b.version - a.version);
  }
}
