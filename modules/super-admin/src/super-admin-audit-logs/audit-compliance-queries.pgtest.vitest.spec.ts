// audit-compliance-queries.pgtest — executes the three compliance repositories beside the audit log
// (legal holds, investigations, evidence packs) against the real migrated schema.
//
// These carry the highest consequence of anything in the silent-SQL report. A LEGAL HOLD that silently reports
// nothing does not merely look clean — it tells an operator that no hold is in force, which is exactly when
// data gets deleted. Same shape for open investigations and evidence packs: the empty answer is the
// reassuring one, and every read here is wrapped in a try/catch that returns [] or 0.
import { describe, it, expect, beforeAll } from 'vitest';
import { AuditLegalHoldsRepository } from './audit-legal-holds.kysely.repository';
import { AuditInvestigationsRepository } from './audit-investigations.kysely.repository';
import { AuditEvidenceRepository } from './audit-evidence.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let holds: AuditLegalHoldsRepository;
let cases: AuditInvestigationsRepository;
let evidence: AuditEvidenceRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  const db = kyselyFor(pg) as never;
  holds = new AuditLegalHoldsRepository(db);
  cases = new AuditInvestigationsRepository(db);
  evidence = new AuditEvidenceRepository(db);

  // CHECK constraints on every status/scope column below — the real schema refuses an invented value, which
  // is half the reason these run against migrations rather than a fake.
  await pg.exec(`
    INSERT INTO audit_legal_holds (hold_ref, scope_type, scope_value, reason, status)
    VALUES ('LH-2026-001', 'tenant', 'acme', 'Pending litigation', 'active');
  `);
  await pg.exec(`
    INSERT INTO audit_investigations (case_ref, title, severity, status)
    VALUES ('CASE-2026-001', 'Unusual export volume', 'high', 'open');
  `);
  await pg.exec(`
    INSERT INTO audit_evidence_packs (pack_ref, requested_by, checksum, event_count, status)
    VALUES ('EP-2026-001', 'Dana Reed', 'sha256:deadbeef', 42, 'ready');
  `);
});

describe('legal holds — "no hold in force" is when data gets deleted', () => {
  it('an active hold is LISTED', async () => {
    const r = await holds.list();
    expect(r.length).toBeGreaterThan(0);
    expect(r.map((h) => h.hold_ref)).toContain('LH-2026-001');
  });

  it('the active count is non-zero', async () => {
    expect(await holds.countActive()).toBeGreaterThan(0);
  });

  it('activeHolds reports the scope, so an operator can see WHAT is held', async () => {
    const r = await holds.activeHolds();
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].scope_type).toBe('tenant');
  });

  it('filtering by status still finds it — the optional predicate compiles', async () => {
    expect((await holds.list('active')).length).toBeGreaterThan(0);
  });

  it('a released filter excludes it, proving the filter is applied at all', async () => {
    expect(await holds.list('released')).toHaveLength(0);
  });
});

describe('investigations', () => {
  it('an open case is listed', async () => {
    const r = await cases.list();
    expect(r.map((c) => c.case_ref)).toContain('CASE-2026-001');
  });

  it('the open count is non-zero', async () => {
    expect(await cases.countOpen()).toBeGreaterThan(0);
  });

  it('recentOpen returns it', async () => {
    expect((await cases.recentOpen()).length).toBeGreaterThan(0);
  });

  it('get() by id returns the row, not null', async () => {
    const id = (await cases.list())[0].id;
    expect(await cases.get(id)).not.toBeNull();
  });
});

describe('evidence packs', () => {
  it('a ready pack is listed', async () => {
    const r = await evidence.list();
    expect(r.map((p) => p.pack_ref)).toContain('EP-2026-001');
  });

  it('the ready count is non-zero', async () => {
    expect(await evidence.countReady()).toBeGreaterThan(0);
  });

  it('the checksum survives the read — integrity re-verification depends on it', async () => {
    const p = (await evidence.list()).find((x) => x.pack_ref === 'EP-2026-001')!;
    expect(p.checksum).toBe('sha256:deadbeef');
  });

  it('get() by id returns the pack', async () => {
    const id = (await evidence.list())[0].id;
    expect(await evidence.get(id)).not.toBeNull();
  });
});
