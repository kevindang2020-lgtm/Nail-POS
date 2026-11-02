import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { LEGAL_DOCUMENT_VERSION } from '../lifecycles';

export interface LegalVersion {
  id: string; docType: string; version: string; title: string; content: string; summary: string | null;
  status: string; requiredAcceptance: boolean; effectiveDate: string | null; publishedAt: string | null;
  publishedBy: string | null; createdBy: string | null; supersededBy: string | null; createdAt: string; updatedAt: string;
}
export interface NewDraft { docType: string; version: string; title: string; content: string; summary?: string | null; requiredAcceptance: boolean; effectiveDate?: string | null; createdBy: string | null; }

export interface LegalDocsRepo {
  listVersions(docType?: string): Promise<LegalVersion[]>;
  getVersion(id: string): Promise<LegalVersion | null>;
  currentPublished(docType: string): Promise<LegalVersion | null>;
  publishedByType(): Promise<LegalVersion[]>;
  insertDraft(d: NewDraft): Promise<LegalVersion>;
  /** Transactionally supersede the current published version of the type and publish this one. */
  publish(versionId: string, publishedBy: string | null): Promise<LegalVersion | null>;
  setStatus(versionId: string, status: string): Promise<LegalVersion | null>;
  acceptanceCounts(versionId: string): Promise<{ accepted: number; declined: number }>;
  tenantTotal(): Promise<number | null>;
}

function map(r: any): LegalVersion {
  const iso = (x: any) => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
  return {
    id: r.id, docType: r.doc_type, version: r.version, title: r.title, content: r.content ?? '', summary: r.summary ?? null,
    status: r.status, requiredAcceptance: !!r.required_acceptance, effectiveDate: iso(r.effective_date), publishedAt: iso(r.published_at),
    publishedBy: r.published_by ?? null, createdBy: r.created_by ?? null, supersededBy: r.superseded_by ?? null,
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}

export class KyselyLegalDocsRepo implements LegalDocsRepo {
  constructor(private readonly db: Kysely<DB>) {}
  private get t() { return this.db; }

  async listVersions(docType?: string): Promise<LegalVersion[]> {
    let q = this.t.selectFrom('legal_document_versions').selectAll();
    if (docType) q = q.where('doc_type', '=', docType);
    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map(map);
  }
  async getVersion(id: string): Promise<LegalVersion | null> { const r = await this.t.selectFrom('legal_document_versions').selectAll().where('id', '=', id).executeTakeFirst(); return r ? map(r) : null; }
  async currentPublished(docType: string): Promise<LegalVersion | null> { const r = await this.t.selectFrom('legal_document_versions').selectAll().where('doc_type', '=', docType).where('status', '=', 'published').executeTakeFirst(); return r ? map(r) : null; }
  async publishedByType(): Promise<LegalVersion[]> { const rows = await this.t.selectFrom('legal_document_versions').selectAll().where('status', '=', 'published').execute(); return rows.map(map); }
  async insertDraft(d: NewDraft): Promise<LegalVersion> {
    const r = await this.t.insertInto('legal_document_versions').values({
      doc_type: d.docType, version: d.version, title: d.title, content: d.content, summary: d.summary ?? null,
      status: 'draft', required_acceptance: d.requiredAcceptance, effective_date: d.effectiveDate ? new Date(d.effectiveDate) : null,
      created_by: d.createdBy, created_at: new Date(), updated_at: new Date(),
    }).returningAll().executeTakeFirst();
    return map(r);
  }
  async publish(versionId: string, publishedBy: string | null): Promise<LegalVersion | null> {
    return await this.db.transaction().execute(async (trx: any) => {
      const v = await trx.selectFrom('legal_document_versions').selectAll().where('id', '=', versionId).executeTakeFirst();
      if (!v) return null;
      await trx.updateTable('legal_document_versions').set({ status: 'superseded', superseded_by: versionId, updated_at: new Date() }).where('doc_type', '=', v.doc_type).where('status', '=', 'published').where(canMoveToSql(LEGAL_DOCUMENT_VERSION, 'superseded')).execute();
      const pub = await trx.updateTable('legal_document_versions').set({ status: 'published', published_at: new Date(), published_by: publishedBy, updated_at: new Date() }).where('id', '=', versionId).where(canMoveToSql(LEGAL_DOCUMENT_VERSION, 'published')).returningAll().executeTakeFirst();
      if (!pub) throw new InvalidStateTransitionError(LEGAL_DOCUMENT_VERSION, v.status, 'published', 'concurrent');   // rolls the supersede back
      return map(pub);
    });
  }
  async setStatus(versionId: string, status: string): Promise<LegalVersion | null> { const r = await this.t.updateTable('legal_document_versions').set({ status, updated_at: new Date() }).where('id', '=', versionId).where(canMoveToSql(LEGAL_DOCUMENT_VERSION, status) as any).returningAll().executeTakeFirst(); return r ? map(r) : null; }
  async acceptanceCounts(versionId: string): Promise<{ accepted: number; declined: number }> {
    const row: any = await this.t.selectFrom('legal_document_acceptances').select([sql<number>`count(*) filter (where decision='accepted')::int`.as('accepted'), sql<number>`count(*) filter (where decision='declined')::int`.as('declined')]).where('version_id', '=', versionId).executeTakeFirst();
    return { accepted: Number(row?.accepted || 0), declined: Number(row?.declined || 0) };
  }
  async tenantTotal(): Promise<number | null> { try { const r: any = await this.t.selectFrom('tenants').select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(); return Number(r?.n || 0); } catch { return null; } }
}

export class InMemoryLegalDocsRepo implements LegalDocsRepo {
  private rows: LegalVersion[] = [];
  private accept: { versionId: string; decision: string }[] = [];
  private tenants = 0;
  seed(rows: LegalVersion[], tenants = 0) { this.rows = rows; this.tenants = tenants; }
  seedAcceptances(a: { versionId: string; decision: string }[]) { this.accept = a; }

  async listVersions(docType?: string) { return this.rows.filter((r) => !docType || r.docType === docType).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); }
  async getVersion(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async currentPublished(docType: string) { return this.rows.find((r) => r.docType === docType && r.status === 'published') || null; }
  async publishedByType() { return this.rows.filter((r) => r.status === 'published'); }
  async insertDraft(d: NewDraft) { const v: LegalVersion = { id: 'ld_' + (this.rows.length + 1), docType: d.docType, version: d.version, title: d.title, content: d.content, summary: d.summary ?? null, status: 'draft', requiredAcceptance: d.requiredAcceptance, effectiveDate: d.effectiveDate ?? null, publishedAt: null, publishedBy: null, createdBy: d.createdBy, supersededBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.rows.push(v); return v; }
  async publish(versionId: string, publishedBy: string | null) {
    const v = this.rows.find((r) => r.id === versionId); if (!v) return null;
    for (const r of this.rows) if (r.docType === v.docType && r.status === 'published') { r.status = 'superseded'; r.supersededBy = versionId; }
    v.status = 'published'; v.publishedAt = new Date().toISOString(); v.publishedBy = publishedBy; return v;
  }
  async setStatus(versionId: string, status: string) { const v = this.rows.find((r) => r.id === versionId); if (!v) return null; v.status = status; return v; }
  async acceptanceCounts(versionId: string) { const a = this.accept.filter((x) => x.versionId === versionId); return { accepted: a.filter((x) => x.decision === 'accepted').length, declined: a.filter((x) => x.decision === 'declined').length }; }
  async tenantTotal() { return this.tenants || null; }
}
