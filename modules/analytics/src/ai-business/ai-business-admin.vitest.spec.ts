// ai-business-admin.vitest.spec.ts — slice 12: Super Admin ai_business adoption overview (§40).
// Two parts: (1) the in-memory repo reports honest zeros; (2) a real PGlite+Kysely test proves the aggregate
// COUNT/GROUP BY over migrations 320 + 321 is correct across multiple tenants (and returns no tenant rows).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { AiBusinessAdminService } from './ai-business-admin.controller';
import { InMemoryAiBusinessAdminRepository } from './ai-business-admin.repository';
import { KyselyAiBusinessAdminRepository } from './ai-business-admin.kysely.repository';

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

describe('in-memory admin repo', () => {
  it('reports honest zeros without a database', async () => {
    const svc = new AiBusinessAdminService(new InMemoryAiBusinessAdminRepository());
    const o = await svc.overview();
    expect(o.savedQuestions.total).toBe(0);
    expect(o.alerts.total).toBe(0);
  });
});

describe('KyselyAiBusinessAdminRepository (pglite aggregates)', () => {
  let svc: AiBusinessAdminService;
  beforeAll(async () => {
    const pg = new PGlite();
    try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* native */ }
    await pg.exec(readFileSync(`${MIGRATIONS_DIR}/336_ai_business_saved_questions.sql`, 'utf8'));
    await pg.exec(readFileSync(`${MIGRATIONS_DIR}/337_ai_business_alerts.sql`, 'utf8'));
    // Two tenants: tenant A has 2 saved questions (daily_summary + revenue_summary) + 2 alerts (1 active);
    // tenant B has 1 saved question (daily_summary) + 1 active alert.
    await pg.exec(`INSERT INTO ai_business_saved_questions (tenant_id,user_id,title,intent) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A1','daily_summary'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A2','revenue_summary'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','B1','daily_summary');`);
    await pg.exec(`INSERT INTO ai_business_alerts (tenant_id,created_by_user_id,title,metric_id,operator,threshold,active) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A low rev','net_sales','lt',500000,true),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','A ns','no_show_rate','gt',15,false),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','B cx','cancellation_rate','gt',20,true);`);
    const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
    svc = new AiBusinessAdminService(new KyselyAiBusinessAdminRepository(db as any));
  });

  it('aggregates saved questions across tenants', async () => {
    const o = await svc.overview();
    expect(o.savedQuestions.total).toBe(3);
    expect(o.savedQuestions.tenants).toBe(2);
    const daily = o.savedQuestions.byIntent.find((x) => x.intent === 'daily_summary');
    expect(daily?.count).toBe(2);
  });

  it('aggregates alerts with active count and by-metric breakdown', async () => {
    const o = await svc.overview();
    expect(o.alerts.total).toBe(3);
    expect(o.alerts.active).toBe(2);
    expect(o.alerts.tenants).toBe(2);
    const byMetric = Object.fromEntries(o.alerts.byMetric.map((m) => [m.metricId, m.count]));
    expect(byMetric['net_sales']).toBe(1);
    expect(byMetric['no_show_rate']).toBe(1);
    expect(byMetric['cancellation_rate']).toBe(1);
  });

  it('returns only aggregate counts — no tenant identifiers leak into the payload', async () => {
    const o = await svc.overview();
    expect(JSON.stringify(o)).not.toMatch(/aaaaaaaa|bbbbbbbb/); // no tenant UUIDs in the platform overview
  });
});
