// ai-knowledge.kysely.ts — BUILD_PLAN Phase 14 (Constitution 10 §143–§150, Constitution 12 "AI cross-tenant isolation
// tested"): the SQL half of tenant knowledge retrieval — the first production caller is the Reception Copilot's
// "explain service and approved policies" (ai-center/reception-copilot-assist.service.ts).
//
// §144 in SQL: every predicate of buildRetrievalFilter is a WHERE clause of the ONE query, evaluated by Postgres BEFORE
// ranking — tenant (on the chunk AND its document), branch (tenant-wide or this branch, never another), status
// PUBLISHED, the visibility classes the caller may read, the allowed roles. assertFilterIsSafe runs before the query is
// built, so a filter missing any of them never reaches the database. Ranking (ts_rank over the generated tsvector) only
// orders rows that already passed every predicate — another salon's text is never in the candidate set.
import { sql } from 'kysely';
import { assertFilterIsSafe, buildRetrievalFilter, type KnowledgeChunk, type RetrievalContext } from './ai-knowledge';

export interface KnowledgeRetriever { retrieve(ctx: RetrievalContext, query: string, limit?: number): Promise<KnowledgeChunk[]> }

/** The query's words as an OR of lexemes (≥ 3 letters, letters/digits only) — never raw user text inside tsquery syntax. */
export function knowledgeTerms(query: string): string[] {
  return [...new Set(String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].slice(0, 12);
}

export class KyselyKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly db: any) {}
  async retrieve(ctx: RetrievalContext, query: string, limit = 5): Promise<KnowledgeChunk[]> {
    const f = buildRetrievalFilter(ctx);
    assertFilterIsSafe(f);
    const terms = knowledgeTerms(query);
    if (!terms.length) return [];
    const branchId = f.branchIds.find((b): b is string => !!b) ?? null;
    const tsq = sql`to_tsquery('english', ${terms.join(' | ')})`;
    const rows: any[] = (await sql`
      select c.id, c.document_id, c.tenant_id, c.branch_id, c.chunk_index, c.content, c.embedding_model_version,
             d.status, d.visibility, d.allowed_roles, d.kind, d.title, ts_rank(c.content_tsv, ${tsq}) as rank
        from ai_knowledge_chunks c
        join ai_knowledge_documents d on d.id = c.document_id
       where c.tenant_id = ${f.tenantId}::uuid and d.tenant_id = ${f.tenantId}::uuid
         and (c.branch_id is null or c.branch_id = ${branchId}::uuid)
         and (d.branch_id is null or d.branch_id = ${branchId}::uuid)
         and d.status = ${f.status}
         and d.visibility = any(${sql.val(f.visibilities)}::text[])
         and (cardinality(d.allowed_roles) = 0 or ${f.role} = any(d.allowed_roles))
         and c.content_tsv @@ ${tsq}
       order by rank desc, c.chunk_index asc
       limit ${Math.max(1, Math.min(20, Math.floor(limit)))}`.execute(this.db)).rows;
    // Defence in depth: the WHERE already guarantees it — a row of another salon here is a bug, and it never leaves.
    if (rows.some((r) => String(r.tenant_id) !== f.tenantId)) throw new Error('knowledge retrieval returned a row of another tenant — refused');
    return rows.map((r) => ({
      id: String(r.id), documentId: String(r.document_id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null,
      chunkIndex: Number(r.chunk_index), content: String(r.content), embeddingModelVersion: r.embedding_model_version ?? null,
      status: r.status, visibility: r.visibility, allowedRoles: Array.isArray(r.allowed_roles) ? r.allowed_roles.map(String) : [], kind: r.kind, title: String(r.title),
    }));
  }
}
