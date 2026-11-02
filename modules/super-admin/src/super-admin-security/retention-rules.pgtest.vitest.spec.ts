// retention-rules.pgtest.vitest.spec — BUILD_PLAN Phase 10 (E, found by live-phase10-database): storing a retention rule
// must persist it. The rule insert and its audit row share a transaction; the audit insert went to audit_events, whose
// tenant_id is NOT NULL, so for a platform rule it failed — the `.catch` swallowed the JS error but PostgreSQL had
// already aborted the transaction, COMMIT became ROLLBACK, and PATCH /super-admin/security/retention-rules/:class
// answered 200 with a rule that was never stored (the dry run then said "No active retention rule").
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyRetentionRepository } from './retention.kysely.repository';

let db: any;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); }, 180_000);
const ACTOR = { userId: '0e000000-0000-4000-8000-0000000000a1', role: 'SUPER_ADMIN', name: 'Pat', ip: null } as any;

describe('retention rules (migrated schema)', () => {
  it('insertActive persists the rule (and its platform audit row) — getActive finds it', async () => {
    const repo = new KyselyRetentionRepository(db);
    const row = await repo.insertActive('login_attempts', 1, 400, 'delete', ACTOR);
    expect(row.retentionDays).toBe(400);
    const active = await repo.getActive('login_attempts');
    expect(active).toMatchObject({ dataClass: 'login_attempts', version: 1, retentionDays: 400, status: 'active' });
    const audits = (await sql`select count(*)::int as n from audit_logs where action_type = 'security.retention_rule_changed' and entity_id = 'login_attempts'`.execute(db) as any).rows[0].n;
    expect(audits).toBe(1);
  });
  it('a second version archives the first', async () => {
    const repo = new KyselyRetentionRepository(db);
    await repo.insertActive('login_attempts', 2, 500, 'delete', ACTOR);
    expect((await repo.getActive('login_attempts'))?.version).toBe(2);
    expect((await sql`select count(*)::int as n from data_retention_rules where data_class = 'login_attempts' and status = 'active'`.execute(db) as any).rows[0].n).toBe(1);
  });
});
