// unique-tenant-review.pgtest — BUILD_PLAN Phase 15 C: the gate `check:unique-tenant-review`
// (scripts/audit-unique-tenant-review.mjs) on the real migrated schema. Every non-PK unique index on a tenant table that
// omits tenant_id is in docs/UNIQUE_INDEX_TENANT_REVIEW.md; a NEW one, a changed definition, a stale row or an
// unreviewable class fails it.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite } from '@aipowersalon/testing';
import { UNREVIEWED_SQL, parseReview, reviewProblems, CLASSES } from '../../scripts/audit-unique-tenant-review.mjs';

const DOC = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'UNIQUE_INDEX_TENANT_REVIEW.md'), 'utf8');
let pg: any;
beforeAll(async () => { pg = await migratedPglite(); await pg.query("SET TIME ZONE 'UTC'"); }, 120_000);   // pg_get_indexdef prints timestamps in the session zone — the reviewed text is UTC (as the gate pins)

describe('check:unique-tenant-review', () => {
  it('passes on the schema as migrated: 98 reviewed, every class a reviewed one, none "should be tenant-scoped"', async () => {
    const live = (await pg.query(UNREVIEWED_SQL)).rows;
    const reviewed = parseReview(DOC);
    expect(live).toHaveLength(98);
    expect(reviewed.size).toBe(98);
    expect(reviewProblems(live, reviewed)).toEqual([]);
    expect([...reviewed.values()].every((r: any) => CLASSES.includes(r.cls))).toBe(true);
    expect(live.map((r: any) => r.index_name)).not.toContain('uq_payment_gateway_events_processed');
  });

  it('a NEW unique index on a tenant table without tenant_id fails; keyed (tenant_id, …) it passes', async () => {
    await pg.exec(`CREATE TABLE p15c_gate_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, sku text NOT NULL)`);
    await pg.exec(`CREATE UNIQUE INDEX uq_p15c_gate_probe_sku ON p15c_gate_probe (sku)`);
    let problems = reviewProblems((await pg.query(UNREVIEWED_SQL)).rows, parseReview(DOC));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^NEW {2}p15c_gate_probe\.uq_p15c_gate_probe_sku/);
    await pg.exec(`DROP INDEX uq_p15c_gate_probe_sku; CREATE UNIQUE INDEX uq_p15c_gate_probe_sku ON p15c_gate_probe (tenant_id, sku)`);
    problems = reviewProblems((await pg.query(UNREVIEWED_SQL)).rows, parseReview(DOC));
    expect(problems).toEqual([]);
    await pg.exec(`DROP TABLE p15c_gate_probe`);
  });

  it('a changed definition, a stale row and an unreviewable class each fail', () => {
    const reviewed = parseReview(DOC);
    const live = [...reviewed.entries()].map(([index_name, r]: any) => ({ index_name, table_name: r.table, def: r.def }));
    expect(reviewProblems(live, reviewed)).toEqual([]);
    const changed = live.map((r) => r.index_name === 'support_tickets_ticket_number_key' ? { ...r, def: '(lower(ticket_number))' } : r);
    expect(reviewProblems(changed, reviewed)).toEqual([expect.stringMatching(/^CHANGED {2}support_tickets\.support_tickets_ticket_number_key/)]);
    expect(reviewProblems(live.filter((r) => r.index_name !== 'revenue_agreements_code_key'), reviewed)).toEqual([expect.stringMatching(/^STALE {2}revenue_agreements\.revenue_agreements_code_key/)]);
    const bad = new Map(reviewed); bad.set('revenue_agreements_code_key', { ...(reviewed.get('revenue_agreements_code_key') as any), cls: 'SHOULD BE TENANT-SCOPED' });
    expect(reviewProblems(live, bad)).toEqual([expect.stringMatching(/^CLASS {2}revenue_agreements_code_key/)]);
  });
});
