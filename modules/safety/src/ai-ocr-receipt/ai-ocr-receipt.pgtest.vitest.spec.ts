// ai-ocr-receipt.pgtest.vitest.spec.ts — exercises the real KyselyDocStore / KyselySettingsStore /
// KyselyOcrAuditSink against PGlite, proving the document lifecycle persists correctly (create → get → patch →
// list → dedup → decision-state round-trip), settings load, and tenant isolation. No external DB required.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDocStore, KyselySettingsStore, KyselyOcrAuditSink } from './ai-ocr-receipt.kysely';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(compiled: any) { const r = await pg.query(compiled.sql, compiled.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() { /* unused */ },
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '99999999-9999-9999-9999-999999999999';
const U1 = '33333333-3333-3333-3333-333333333333';
const ctx1 = { tenantId: T1, branchId: null, userId: U1, role: 'owner', permissions: [] };

async function makeDb(): Promise<Kysely<any>> {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }
  await pg.exec(`
    create table ocr_documents (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      uploaded_by_user_id uuid, source_channel text, document_type text default 'unknown', vendor text, total_cents bigint,
      document_number text, document_date date, pipeline_status text not null default 'uploaded',
      subtotal_cents bigint, tax_cents bigint, fees_cents bigint, discount_cents bigint,
      review_status text not null default 'not_started', deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
      page_count int not null default 1, quality_flags jsonb not null default '[]'::jsonb, extraction_attempts int not null default 0, next_extraction_at timestamptz,
      last_extraction_error text, suggested_expense_id uuid, suggested_match text, retention_hold boolean not null default false, retention_archived_at timestamptz);
    create table ocr_document_pages (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, document_id uuid not null, page_number int not null,
      storage_key text, width int, height int, created_at timestamptz default now());
    create table ocr_document_files (id uuid primary key default gen_random_uuid(), tenant_id uuid, document_id uuid, kind text,
      storage_key text, size_bytes int, file_hash text, perceptual_hash text, scan_status text, created_at timestamptz default now());
    create table ocr_reviews (id uuid primary key default gen_random_uuid(), tenant_id uuid, document_id uuid, status text default 'in_progress',
      started_by_user_id uuid, started_at timestamptz default now(), submitted_at timestamptz, notes text, decision_state jsonb);
    create table tenant_ocr_ai_settings (id uuid primary key default gen_random_uuid(), tenant_id uuid, level text, branch_id uuid,
      enabled boolean, config jsonb, version int, updated_by_user_id uuid, updated_at timestamptz default now());
    create table ocr_ai_config_versions (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, level text not null, branch_id uuid,
      version int not null, enabled boolean, config jsonb, changed_by_user_id uuid, created_at timestamptz default now());
    create table branches (id uuid primary key, tenant_id uuid not null);
    insert into branches values ('44444444-4444-4444-4444-444444444444', '${T1}'), ('55555555-5555-5555-5555-555555555555', '${T2}');
    create table audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, user_id uuid, role text,
      action_type text, entity_type text, entity_id uuid, metadata_json jsonb, created_at timestamptz default now());
  `);
  await pg.exec(`
    insert into tenant_ocr_ai_settings (tenant_id, level, branch_id, enabled, config, version)
      values ('${T1}','tenant', null, true, '{"tolerance":100}'::jsonb, 1);
  `);
  return new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}

describe('AI OCR Receipt DB adapters (pglite)', () => {
  let db: Kysely<any>; let docs: KyselyDocStore; let settings: KyselySettingsStore; let audit: KyselyOcrAuditSink;
  beforeAll(async () => { db = await makeDb(); docs = new KyselyDocStore(db as any); settings = new KyselySettingsStore(db as any); audit = new KyselyOcrAuditSink(db as any); });

  it('create → get round-trips a document scoped to the tenant', async () => {
    const created = await docs.create(ctx1, { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    expect(created.id).toBeTruthy();
    const got = await docs.get(ctx1, created.id);
    expect(got?.pipelineState).toBe('uploaded');
    expect(got?.tenantId).toBe(T1);
    // cross-tenant read returns null (isolation)
    expect(await docs.get({ ...ctx1, tenantId: T2 }, created.id)).toBeNull();
  });

  it('patch updates only provided fields', async () => {
    const d = await docs.create(ctx1, { pipelineState: 'validating', documentType: 'unknown', postingVersion: 1 });
    await docs.patch(ctx1, d.id, { pipelineState: 'review_required', vendor: 'Acme Supply', totalCents: 4599 });
    const got = await docs.get(ctx1, d.id);
    expect(got?.pipelineState).toBe('review_required');
    expect(got?.vendor).toBe('Acme Supply');
    expect(got?.totalCents).toBe(4599);
  });

  it('decision state round-trips (defaults to in_review/empty)', async () => {
    const d = await docs.create(ctx1, { pipelineState: 'in_review', documentType: 'invoice', postingVersion: 1 });
    expect(await docs.loadDecisionState(ctx1, d.id)).toEqual({ status: 'in_review', approvals: [] });
    await docs.saveDecisionState(ctx1, d.id, { status: 'approved', approvals: [{ userId: 'u1', at: 't1' }] });
    const loaded = await docs.loadDecisionState(ctx1, d.id);
    expect(loaded.status).toBe('approved');
    expect(loaded.approvals).toHaveLength(1);
  });

  it('list is tenant-scoped and counts', async () => {
    const r = await docs.list(ctx1, {});
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.items.every((d) => d.tenantId === T1)).toBe(true);
    expect((await docs.list({ ...ctx1, tenantId: T2 }, {})).total).toBe(0);
  });

  it('dedupCandidates returns tenant documents', async () => {
    const cands = await docs.dedupCandidates(ctx1, { fileHash: null, perceptualHash: null, vendor: 'Acme Supply', documentNumber: null, documentDate: null, totalCents: 4599 });
    expect(Array.isArray(cands)).toBe(true);
    expect(cands.length).toBeGreaterThanOrEqual(1);
  });

  it('settings save (PUT /settings used to save nothing): upserts the tenant row, bumps its version, keeps history', async () => {
    const before = (await settings.load(ctx1)).find((r) => r.level === 'tenant');
    expect(await settings.save(ctx1, { level: 'tenant', branch_id: null, enabled: true, config: { highAmountCents: 12345 } })).toBe(true);
    const after = (await settings.load(ctx1)).filter((r) => r.level === 'tenant');
    expect(after).toHaveLength(1);                                     // updated in place, not a second tenant row
    expect(after[0].config).toEqual({ highAmountCents: 12345 });
    expect(before).toBeTruthy();
    const v = await db.executeQuery<any>({ sql: `select version from ocr_ai_config_versions where tenant_id = $1 and level = 'tenant'`, parameters: [T1], query: {} as any } as any);
    expect(v.rows.map((r: any) => r.version)).toEqual([2]);
    // restore the seeded row the later test reads
    await settings.save(ctx1, { level: 'tenant', branch_id: null, enabled: true, config: { tolerance: 100 } as any });
  });
  it('settings save: a branch row for this tenant\'s branch is stored; another tenant\'s branch is refused (false), nothing written', async () => {
    expect(await settings.save(ctx1, { level: 'branch', branch_id: '44444444-4444-4444-4444-444444444444', enabled: false, config: null })).toBe(true);
    expect((await settings.load(ctx1)).find((r) => r.level === 'branch')).toMatchObject({ branch_id: '44444444-4444-4444-4444-444444444444', enabled: false });
    expect(await settings.save(ctx1, { level: 'branch', branch_id: '55555555-5555-5555-5555-555555555555', enabled: false, config: null })).toBe(false);
    expect((await settings.load(ctx1)).filter((r) => r.level === 'branch')).toHaveLength(1);
    await db.deleteFrom('tenant_ocr_ai_settings').where('level', '=', 'branch').execute();   // the next test reads the seed alone
  });

  it('settings load maps rows', async () => {
    const rows = await settings.load(ctx1);
    expect(rows.length).toBe(1);
    expect(rows[0].level).toBe('tenant');
    expect(rows[0].enabled).toBe(true);
  });

  it('audit sink writes to audit_logs', async () => {
    const d = await docs.create(ctx1, { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    await audit.record(ctx1, 'document.uploaded', d.id, { disposition: 'accept' });
    const rows = await db.selectFrom('audit_logs').selectAll().where('entity_id', '=', d.id).execute();
    expect(rows.length).toBe(1);
    expect(rows[0].action_type).toBe('document.uploaded');
    expect(rows[0].entity_type).toBe('ocr_document');
  });
});
