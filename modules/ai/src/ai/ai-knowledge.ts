// ai-knowledge.ts — Constitution 10 §143–§150: tenant knowledge retrieval for AI.
//
// §144 states the rule that this file is built around: **search must filter before retrieval. Never retrieve
// globally then filter after model response.** Those are two different systems, not two orderings of one. A
// global search that filters afterwards has already put another tenant's text in the candidate set, which
// means a ranking bug, a truncation, or a later "optimization" leaks it. So `buildRetrievalFilter` produces
// the mandatory predicates and `assertFilterIsSafe` refuses a query that lacks them.
//
// §145: no vector database, deliberately. A salon's knowledge is a handful of policy documents; Postgres
// full-text over that is the correct tool, not a compromise. The schema is shaped so embeddings are a later
// migration rather than a rewrite (§147's version column exists from day one).
export type KnowledgeVisibility = 'staff_private' | 'staff_shared' | 'customer_facing';
export type KnowledgeStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'ARCHIVED';
export type KnowledgeKind = 'policy' | 'faq' | 'service_policy' | 'booking_policy' | 'document';

/** §149: the only status AI may read. READY means processed but not yet approved — that distinction is the point. */
export const AI_READABLE_STATUS: KnowledgeStatus = 'PUBLISHED';

export interface KnowledgeChunk {
  id: string; documentId: string; tenantId: string; branchId: string | null; chunkIndex: number; content: string;
  embeddingModelVersion: string | null;
  /** Carried from the document for filtering. */
  status: KnowledgeStatus; visibility: KnowledgeVisibility; allowedRoles: readonly string[]; kind: KnowledgeKind; title: string;
}

/** §144/§150: who is asking, established server-side. Nothing here comes from a model. */
export interface RetrievalContext {
  tenantId: string;
  branchId: string | null;
  role: string;
  /** True when the answer may be shown to a customer — then ONLY customer_facing knowledge is eligible. */
  customerFacing: boolean;
}

export class UnsafeRetrievalError extends Error {
  readonly status = 500;
  constructor(missing: string) { super(`Refusing to run a knowledge query without ${missing} — §144 requires filtering BEFORE retrieval`); this.name = 'UnsafeRetrievalError'; }
}

export interface RetrievalFilter {
  tenantId: string;
  branchIds: (string | null)[];
  status: KnowledgeStatus;
  visibilities: KnowledgeVisibility[];
  role: string;
}

/** §144/§149/§150: the predicates every knowledge query must carry. */
export function buildRetrievalFilter(ctx: RetrievalContext): RetrievalFilter {
  if (!ctx.tenantId) throw new UnsafeRetrievalError('a tenant id');
  if (!ctx.role) throw new UnsafeRetrievalError('an actor role');
  return {
    tenantId: ctx.tenantId,
    // Tenant-wide documents (branch NULL) plus this branch's. Never another branch's.
    branchIds: ctx.branchId ? [null, ctx.branchId] : [null],
    status: AI_READABLE_STATUS,
    // §150: customer-facing answers may quote ONLY customer-facing knowledge. Staff answers may use shared
    // knowledge too. `staff_private` is in neither list — it is not AI knowledge unless someone republishes it.
    visibilities: ctx.customerFacing ? ['customer_facing'] : ['customer_facing', 'staff_shared'],
    role: ctx.role,
  };
}

/** A query that reaches the database must satisfy this, or it does not run. */
export function assertFilterIsSafe(f: Partial<RetrievalFilter>): asserts f is RetrievalFilter {
  if (!f.tenantId) throw new UnsafeRetrievalError('a tenant id');
  if (!f.branchIds) throw new UnsafeRetrievalError('a branch scope');
  if (f.status !== AI_READABLE_STATUS) throw new UnsafeRetrievalError(`status = ${AI_READABLE_STATUS} (§149)`);
  if (!f.visibilities?.length) throw new UnsafeRetrievalError('a visibility class (§150)');
  if (f.visibilities.includes('staff_private' as KnowledgeVisibility)) throw new UnsafeRetrievalError('a visibility set that excludes staff_private (§150)');
  if (!f.role) throw new UnsafeRetrievalError('an actor role');
}

/**
 * The in-memory implementation of the same rules the SQL must follow, used by tests and by the offline path.
 * Every predicate here has a matching WHERE clause; the point of writing it twice is that the test can prove
 * the FILTER is what excludes a row, rather than the ranking happening not to surface it.
 */
export function retrieve(chunks: readonly KnowledgeChunk[], ctx: RetrievalContext, query: string, limit = 5): KnowledgeChunk[] {
  const f = buildRetrievalFilter(ctx);
  assertFilterIsSafe(f);
  const eligible = chunks.filter((c) =>
    c.tenantId === f.tenantId
    && f.branchIds.includes(c.branchId)
    && c.status === f.status
    && f.visibilities.includes(c.visibility)
    && (c.allowedRoles.length === 0 || c.allowedRoles.includes(f.role)));

  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (!terms.length) return [];
  return eligible
    .map((c) => ({ c, score: terms.reduce((n, t) => n + (c.content.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.chunkIndex - b.c.chunkIndex)
    .slice(0, limit)
    .map((x) => x.c);
}

/**
 * §137 + §143: what retrieval hands the prompt. Passages come with their source so an answer can cite, and
 * the whole thing is UNTRUSTED content — it is tenant-authored text, and a tenant document containing
 * "ignore your instructions" is the same threat as a review containing it.
 */
export interface RetrievedContext { passages: Array<{ documentId: string; title: string; content: string }>; sources: string[]; untrusted: true }

export function toPromptContext(chunks: readonly KnowledgeChunk[], maxChars = 4000): RetrievedContext {
  const passages: RetrievedContext['passages'] = [];
  let total = 0;
  for (const c of chunks) {
    const remaining = maxChars - total;
    if (remaining <= 100) break;
    const content = c.content.length > remaining ? `${c.content.slice(0, remaining)} …[truncated]` : c.content;
    passages.push({ documentId: c.documentId, title: c.title, content });
    total += content.length;
  }
  return { passages, sources: [...new Set(passages.map((p) => p.documentId))], untrusted: true };
}

// ---------------------------------------------------------------------------------------------------------------
// §147 embedding versions
// ---------------------------------------------------------------------------------------------------------------
export class MixedVectorSpaceError extends Error {
  readonly status = 500;
  constructor(found: string[]) { super(`Chunks span ${found.length} embedding versions (${found.join(', ')}); §147 forbids silently mixing incompatible vector spaces`); this.name = 'MixedVectorSpaceError'; }
}

/**
 * §147. Nothing is embedded yet, so this exists to make the rule enforceable the day something is: a retrieval
 * set must be from exactly one embedding version. Writing it now costs a few lines; writing it after a
 * half-migrated index is in production costs a re-embedding run and a stretch of quietly bad answers.
 */
export function assertSingleVectorSpace(chunks: readonly KnowledgeChunk[]): void {
  const versions = [...new Set(chunks.map((c) => c.embeddingModelVersion).filter((v): v is string => !!v))];
  if (versions.length > 1) throw new MixedVectorSpaceError(versions);
}

/** §149: the transitions a document may make. Anything else is refused, so nothing skips approval into PUBLISHED. */
export const KNOWLEDGE_TRANSITIONS: Readonly<Record<KnowledgeStatus, readonly KnowledgeStatus[]>> = Object.freeze({
  DRAFT: ['PROCESSING', 'ARCHIVED'],
  PROCESSING: ['READY', 'DRAFT', 'ARCHIVED'],
  READY: ['PUBLISHED', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED', 'DRAFT'],
  ARCHIVED: ['DRAFT'],
});

export function canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
  return (KNOWLEDGE_TRANSITIONS[from] ?? []).includes(to);
}
