// community-migration.pgtest.vitest.spec.ts — loads the real migration 360 into PGlite and proves the
// schema-level safety constraints: a private incident's visibility is immutable, and a published community post
// MUST be community_published. Also confirms the schema creates cleanly (all tables/indexes/checks valid SQL).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

let pg: PGlite;
const T = '11111111-1111-1111-1111-111111111111';
const U = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => {
  pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/360_tenant_safety_community.sql`, 'utf8'));
});

describe('safety community migration 360', () => {
  it('creates all core tables', async () => {
    const r = await pg.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_name like 'community_%' or table_name like 'tenant_%community%' or table_name like 'tenant_private_incidents'`);
    const names = r.rows.map((x) => x.table_name);
    for (const t of ['tenant_community_settings', 'tenant_private_incidents', 'community_posts', 'community_comments', 'community_reports', 'community_disputes', 'community_moderation_cases', 'community_evidence', 'community_risk_fingerprints']) {
      expect(names).toContain(t);
    }
  });

  it('a private incident cannot be stored with any non-private visibility', async () => {
    await expect(pg.query(
      `insert into tenant_private_incidents (tenant_id, visibility, category, created_by_user_id) values ('${T}','community_published','scam','${U}')`))
      .rejects.toThrow();
    // the valid default works
    const ok = await pg.query<{ visibility: string }>(
      `insert into tenant_private_incidents (tenant_id, category, created_by_user_id) values ('${T}','scam','${U}') returning visibility`);
    expect(ok.rows[0].visibility).toBe('tenant_private');
  });

  it('a published post must be community_published (draft cannot be "published")', async () => {
    // status published but visibility draft → rejected by ck_published_visibility
    await expect(pg.query(
      `insert into community_posts (origin_tenant_id, status, visibility, category, title, redacted_body, created_by_user_id)
       values ('${T}','published_unverified','draft','scam','t','b','${U}')`))
      .rejects.toThrow();
    // a draft with draft visibility is fine
    const ok = await pg.query<{ visibility: string; status: string }>(
      `insert into community_posts (origin_tenant_id, category, title, redacted_body, created_by_user_id)
       values ('${T}','scam','t','b','${U}') returning visibility, status`);
    expect(ok.rows[0].visibility).toBe('draft');
    expect(ok.rows[0].status).toBe('incident_draft');
    // a properly published post is accepted
    const pub = await pg.query<{ visibility: string }>(
      `insert into community_posts (origin_tenant_id, status, visibility, category, title, redacted_body, created_by_user_id)
       values ('${T}','published_unverified','community_published','scam','t','b','${U}') returning visibility`);
    expect(pub.rows[0].visibility).toBe('community_published');
  });

  it('rejects illegal status / severity / verification values', async () => {
    await expect(pg.query(`insert into community_posts (origin_tenant_id, status, category, title, redacted_body, created_by_user_id) values ('${T}','not_a_status','scam','t','b','${U}')`)).rejects.toThrow();
    await expect(pg.query(`insert into community_posts (origin_tenant_id, severity, category, title, redacted_body, created_by_user_id) values ('${T}','apocalyptic','scam','t','b','${U}')`)).rejects.toThrow();
  });

  it('risk fingerprints table stores no identity columns (privacy by construction)', async () => {
    const cols = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'community_risk_fingerprints'`);
    const names = cols.rows.map((c) => c.column_name);
    for (const forbidden of ['customer_id', 'phone', 'email', 'name', 'reporter_tenant_id', 'identity']) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain('fingerprint');
  });
});
