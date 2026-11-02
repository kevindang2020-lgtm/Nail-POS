// ai-knowledge.vitest.spec — Constitution 10 §143–§150.
import { describe, it, expect } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRetrievalFilter, assertFilterIsSafe, retrieve, toPromptContext, assertSingleVectorSpace, canTransition, KNOWLEDGE_TRANSITIONS, AI_READABLE_STATUS, UnsafeRetrievalError, MixedVectorSpaceError, type KnowledgeChunk, type RetrievalContext } from './ai-knowledge';

const chunk = (over: Partial<KnowledgeChunk> = {}): KnowledgeChunk => ({
  id: 'c1', documentId: 'd1', tenantId: 'tenant-A', branchId: null, chunkIndex: 0,
  content: 'Cancellations require 24 hours notice. Late cancellations may be charged.',
  embeddingModelVersion: null, status: 'PUBLISHED', visibility: 'customer_facing', allowedRoles: [], kind: 'booking_policy', title: 'Cancellation policy', ...over,
});
const ctx = (over: Partial<RetrievalContext> = {}): RetrievalContext => ({ tenantId: 'tenant-A', branchId: 'branch-1', role: 'RECEPTION', customerFacing: false, ...over });

describe('§144 filter BEFORE retrieval', () => {
  it('another tenant\'s chunk is excluded by the FILTER, not by ranking', () => {
    const mine = chunk(); const theirs = chunk({ id: 'c2', tenantId: 'tenant-B', content: 'Cancellations require 24 hours notice at Tenant B.' });
    const out = retrieve([theirs, mine], ctx(), 'cancellations notice');
    expect(out.map((c) => c.id)).toEqual(['c1']);
    // …and the other tenant's row is not merely ranked lower: it never becomes eligible at all
    expect(retrieve([theirs], ctx(), 'cancellations notice')).toEqual([]);
  });
  it('another BRANCH\'s chunk is excluded; tenant-wide (null branch) is included', () => {
    const other = chunk({ id: 'c3', branchId: 'branch-9' });
    const mineBranch = chunk({ id: 'c4', branchId: 'branch-1' });
    const out = retrieve([other, mineBranch, chunk()], ctx(), 'cancellations');
    expect(out.map((c) => c.id).sort()).toEqual(['c1', 'c4']);
  });
  it('a query without a tenant or role refuses to run at all', () => {
    expect(() => retrieve([chunk()], ctx({ tenantId: '' }), 'x')).toThrow(UnsafeRetrievalError);
    expect(() => retrieve([chunk()], ctx({ role: '' }), 'x')).toThrow(/actor role/);
  });
  it('assertFilterIsSafe rejects a filter missing any mandatory predicate', () => {
    const good = buildRetrievalFilter(ctx());
    expect(() => assertFilterIsSafe(good)).not.toThrow();
    expect(() => assertFilterIsSafe({ ...good, tenantId: '' })).toThrow(/tenant id/);
    expect(() => assertFilterIsSafe({ ...good, status: 'READY' })).toThrow(/status = PUBLISHED/);
    expect(() => assertFilterIsSafe({ ...good, visibilities: [] })).toThrow(/visibility class/);
    expect(() => assertFilterIsSafe({ ...good, visibilities: ['staff_private'] })).toThrow(/excludes staff_private/);
  });
});

describe('§149 only PUBLISHED is AI-readable', () => {
  it.each(['DRAFT', 'PROCESSING', 'READY', 'ARCHIVED'] as const)('%s is not retrieved', (status) => {
    expect(retrieve([chunk({ status })], ctx(), 'cancellations')).toEqual([]);
  });
  it('READY is specifically NOT readable — processed is not approved', () => {
    expect(AI_READABLE_STATUS).toBe('PUBLISHED');
    expect(retrieve([chunk({ status: 'READY' })], ctx(), 'cancellations')).toEqual([]);
    expect(retrieve([chunk({ status: 'PUBLISHED' })], ctx(), 'cancellations')).toHaveLength(1);
  });
  it('a document cannot skip approval: DRAFT and PROCESSING may not go straight to PUBLISHED', () => {
    expect(canTransition('READY', 'PUBLISHED')).toBe(true);
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('PROCESSING', 'PUBLISHED')).toBe(false);
    expect(canTransition('ARCHIVED', 'PUBLISHED')).toBe(false);
    for (const [from, tos] of Object.entries(KNOWLEDGE_TRANSITIONS)) for (const to of tos) expect(canTransition(from as never, to), `${from}->${to}`).toBe(true);
  });
});

describe('§150 visibility is explicit', () => {
  it('staff_private is never retrieved — not for staff, not for anyone', () => {
    expect(retrieve([chunk({ visibility: 'staff_private' })], ctx(), 'cancellations')).toEqual([]);
    expect(retrieve([chunk({ visibility: 'staff_private' })], ctx({ role: 'OWNER' }), 'cancellations')).toEqual([]);
  });
  it('a customer-facing answer may quote ONLY customer_facing knowledge', () => {
    const shared = chunk({ id: 'shared', visibility: 'staff_shared', content: 'Cancellations: staff may waive the fee at their discretion.' });
    expect(retrieve([shared, chunk()], ctx({ customerFacing: false }), 'cancellations').map((c) => c.id).sort()).toEqual(['c1', 'shared']);
    expect(retrieve([shared, chunk()], ctx({ customerFacing: true }), 'cancellations').map((c) => c.id)).toEqual(['c1']);
  });
  it('allowedRoles narrows further; empty means every role the visibility already permits', () => {
    const ownerOnly = chunk({ id: 'own', allowedRoles: ['OWNER'], content: 'Cancellations reporting for owners.' });
    expect(retrieve([ownerOnly], ctx({ role: 'RECEPTION' }), 'cancellations')).toEqual([]);
    expect(retrieve([ownerOnly], ctx({ role: 'OWNER' }), 'cancellations')).toHaveLength(1);
  });
});

describe('§143 what retrieval hands the prompt', () => {
  it('passages carry their source and are marked untrusted — a tenant document is tenant-authored text', () => {
    const r = toPromptContext([chunk(), chunk({ id: 'c2', documentId: 'd2', title: 'Hours' })]);
    expect(r.untrusted).toBe(true);
    expect(r.sources).toEqual(['d1', 'd2']);
    expect(r.passages[0]).toMatchObject({ documentId: 'd1', title: 'Cancellation policy' });
  });
  it('respects a character budget and truncates rather than overflowing', () => {
    const big = chunk({ content: 'x'.repeat(10_000) });
    const r = toPromptContext([big, chunk({ id: 'c2' })], 500);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0].content.length).toBeLessThan(600);
    expect(r.passages[0].content).toMatch(/…\[truncated\]/);
  });
  it('an empty query returns nothing rather than everything', () => {
    expect(retrieve([chunk()], ctx(), '')).toEqual([]);
    expect(retrieve([chunk()], ctx(), 'a of')).toEqual([]);   // stop-length terms only
  });
});

describe('§145/§147 no vector database, and the rule that makes adding one safe', () => {
  it('§145 the implementation introduces no vector dependency', () => {
    const src = readFileSync(resolve(__dirname, 'ai-knowledge.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/pgvector|cosine|<=>|faiss|pinecone|weaviate/i);
    const mig = readFileSync(`${MIGRATIONS_DIR}/439_ai_knowledge.sql`, 'utf8');
    expect(mig).not.toMatch(/CREATE EXTENSION[^;]*vector|vector\(\d+\)/i);
    expect(mig).toMatch(/embedding_model_version/);   // the hook exists; the dependency does not
  });
  it('§147 a retrieval set spanning two embedding versions is refused', () => {
    expect(() => assertSingleVectorSpace([chunk({ embeddingModelVersion: 'v1' }), chunk({ id: 'c2', embeddingModelVersion: 'v1' })])).not.toThrow();
    expect(() => assertSingleVectorSpace([chunk({ embeddingModelVersion: 'v1' }), chunk({ id: 'c2', embeddingModelVersion: 'v2' })])).toThrow(MixedVectorSpaceError);
    expect(() => assertSingleVectorSpace([chunk(), chunk({ id: 'c2' })])).not.toThrow();   // none embedded yet
  });
});
