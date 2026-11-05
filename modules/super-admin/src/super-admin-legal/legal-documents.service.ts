import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { LegalDocsRepo, LegalVersion } from './legal-documents.repository';
import { LEGAL_DOC_TYPES, DOC_TYPE_LABEL, isLegalDocType, isValidVersion, compareVersions, assertLegalTransition, isContentImmutable, LegalTransitionError, type LegalDocType, type LegalStatus, acceptanceBreakdown } from './legal-document-core';

export class LegalError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); this.name = 'LegalError'; } }
export interface AdminCtx { userId?: string; email?: string; role?: string; ip?: string }

const label = (t: string) => DOC_TYPE_LABEL[t as LegalDocType] || t;

export class LegalDocumentsService {
  constructor(private readonly repo: LegalDocsRepo, private readonly db?: Kysely<DB>) {}

  private async audit(ctx: AdminCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({
      id: sql`gen_random_uuid()` as any, tenant_id: null as any, user_id: (ctx.userId || null) as any, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'legal_document', entity_id: entityId, metadata_json: JSON.stringify(meta || {}) as any,
    } as any).execute().catch(() => { /* auditing must not break the action */ });
  }

  /** Panel rows: the current published (or latest) version per document type that has any version. */
  async listDocuments(): Promise<{ docType: string; label: string; version: string; lastUpdated: string | null; status: string; versionId: string; requiredAcceptance: boolean }[]> {
    const all = await this.repo.listVersions();
    const byType = new Map<string, LegalVersion>();
    for (const v of all) {
      const cur = byType.get(v.docType);
      if (!cur || (v.status === 'published') || (cur.status !== 'published' && v.createdAt > cur.createdAt)) byType.set(v.docType, v);
    }
    return [...byType.values()].map((v) => ({ docType: v.docType, label: label(v.docType), version: v.version, lastUpdated: v.publishedAt || v.updatedAt, status: v.status, versionId: v.id, requiredAcceptance: v.requiredAcceptance }));
  }

  /** Full version history (immutable) for the version-history table. */
  async versionHistory(limit = 50): Promise<{ id: string; docType: string; label: string; version: string; publishedOn: string | null; publishedBy: string | null; status: string }[]> {
    const all = await this.repo.listVersions();
    return all.slice(0, Math.min(Math.max(limit, 1), 200)).map((v) => ({ id: v.id, docType: v.docType, label: label(v.docType), version: v.version, publishedOn: v.publishedAt, publishedBy: v.publishedBy, status: v.status }));
  }

  async getVersion(id: string): Promise<LegalVersion> { const v = await this.repo.getVersion(id); if (!v) throw new LegalError('not_found', 'Legal document version not found.'); return v; }

  async createDraft(ctx: AdminCtx, input: { docType: string; version: string; title?: string; content?: string; summary?: string; requiredAcceptance?: boolean; effectiveDate?: string }): Promise<LegalVersion> {
    if (!isLegalDocType(input.docType)) throw new LegalError('invalid', `Unknown document type. One of: ${LEGAL_DOC_TYPES.join(', ')}.`);
    if (!input.version || !isValidVersion(String(input.version))) throw new LegalError('invalid', 'Version must look like v2.3.0.');
    // version must be newer than any existing version of this type
    const existing = await this.repo.listVersions(input.docType);
    if (existing.some((e) => e.version === input.version)) throw new LegalError('conflict', `Version ${input.version} already exists for ${label(input.docType)}.`);
    for (const e of existing) if (compareVersions(input.version, e.version) <= 0 && e.status === 'published') throw new LegalError('invalid', `Version must be newer than the published ${e.version}.`);
    const v = await this.repo.insertDraft({ docType: input.docType, version: String(input.version), title: input.title || label(input.docType), content: input.content || '', summary: input.summary ?? null, requiredAcceptance: input.requiredAcceptance !== false, effectiveDate: input.effectiveDate ?? null, createdBy: ctx.userId ?? ctx.email ?? null });
    await this.audit(ctx, 'legal_document_version_created', v.id, { docType: v.docType, version: v.version });
    return v;
  }

  async publish(ctx: AdminCtx, versionId: string): Promise<LegalVersion> {
    const v = await this.repo.getVersion(versionId);
    if (!v) throw new LegalError('not_found', 'Legal document version not found.');
    try { assertLegalTransition(v.status as LegalStatus, 'published'); }
    catch (e) { if (e instanceof LegalTransitionError) throw new LegalError('conflict', e.message); throw e; }
    const pub = await this.repo.publish(versionId, ctx.userId ?? ctx.email ?? null);
    if (!pub) throw new LegalError('conflict', 'Could not publish (it may have changed).');
    await this.audit(ctx, 'legal_document_published', pub.id, { docType: pub.docType, version: pub.version, requiresReacceptance: pub.requiredAcceptance });
    return pub;
  }

  async retire(ctx: AdminCtx, versionId: string): Promise<LegalVersion> {
    const v = await this.repo.getVersion(versionId);
    if (!v) throw new LegalError('not_found', 'Legal document version not found.');
    try { assertLegalTransition(v.status as LegalStatus, 'retired'); }
    catch (e) { if (e instanceof LegalTransitionError) throw new LegalError('conflict', e.message); throw e; }
    const r = await this.repo.setStatus(versionId, 'retired');
    if (!r) throw new LegalError('conflict', 'Could not retire the version.');
    await this.audit(ctx, 'legal_document_retired', r.id, { docType: r.docType, version: r.version });
    return r;
  }

  /** Acceptance breakdown for the currently-published (required) version of a type — tied to that exact version. */
  async acceptanceStatus(docType: string): Promise<{ available: boolean; version?: string; accepted: number; declined: number; pending: number; total: number }> {
    if (!isLegalDocType(docType)) throw new LegalError('invalid', 'Unknown document type.');
    const cur = await this.repo.currentPublished(docType);
    if (!cur) return { available: false, accepted: 0, declined: 0, pending: 0, total: 0 };
    const counts = await this.repo.acceptanceCounts(cur.id);
    const total = (await this.repo.tenantTotal()) ?? counts.accepted + counts.declined;
    const b = acceptanceBreakdown(counts.accepted, counts.declined, total);
    return { available: true, version: cur.version, ...b };
  }

  /** The "Legal Docs Version" summary card. Highest published version across types (or the shared one). */
  async overviewVersion(): Promise<{ available: boolean; version: string | null; docCount: number }> {
    const pub = await this.repo.publishedByType();
    if (!pub.length) return { available: false, version: null, docCount: 0 };
    const allSame = pub.every((p) => p.version === pub[0].version);
    const latest = pub.map((p) => p.version).sort(compareVersions).pop()!;
    return { available: true, version: allSame ? pub[0].version : latest, docCount: pub.length };
  }

  /** Guard used by any future content-edit endpoint (published versions are immutable). */
  async assertEditable(versionId: string): Promise<void> {
    const v = await this.getVersion(versionId);
    if (isContentImmutable(v.status as LegalStatus)) throw new LegalError('conflict', 'Published versions are immutable — create a new draft version instead.');
  }
}
