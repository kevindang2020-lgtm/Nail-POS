// check-migration-safety.vitest.spec — B-15 (Oct 20 2026): the migration-safety gate catches what DEPLOYMENT.md only asked for.
import { describe, it, expect } from 'vitest';
import { scan, evaluate, dropIsProven, scanAll, loadAllowlist } from '../../scripts/check-migration-safety.mjs';

const rules = (sql: string) => scan('900_x.sql', sql).map((o: any) => o.rule + (o.object ? ':' + o.object : ''));

describe('check:migration-safety — what counts as destructive', () => {
  it('D1 DROP TABLE, D2 DROP COLUMN, D3 RENAME, D4 SET NOT NULL, D5 TYPE, D7 TRUNCATE / bare DELETE / NOT NULL add without default', () => {
    expect(rules(`DROP TABLE IF EXISTS old_t;`)).toEqual(['D1:old_t']);
    expect(rules(`ALTER TABLE t DROP COLUMN IF EXISTS c;`)).toEqual(['D2:c']);
    expect(rules(`ALTER TABLE t RENAME COLUMN a TO b;\nALTER TABLE t RENAME TO t2;`)).toEqual(['D3:a', 'D3:t2']);
    expect(rules(`ALTER TABLE t ALTER COLUMN c SET NOT NULL;`)).toEqual(['D4:c']);
    expect(rules(`ALTER TABLE t ALTER COLUMN c TYPE text USING c::text;\nALTER TABLE t ALTER COLUMN d SET DATA TYPE int;`)).toEqual(['D5:c', 'D5:d']);
    expect(rules(`TRUNCATE t;\nDELETE FROM t;\nALTER TABLE t ADD COLUMN c text NOT NULL;`)).toEqual(['D7:t', 'D7:t', 'D7:c']);
  });
  it('not destructive: a comment, DROP IF EXISTS of a trigger / index / constraint, a NOT NULL add WITH a default, a DELETE with a WHERE', () => {
    expect(rules(`-- DROP TABLE t (prose)\nDROP TRIGGER IF EXISTS trg ON t;\nDROP INDEX IF EXISTS i;\nALTER TABLE t DROP CONSTRAINT IF EXISTS k;\nALTER TABLE t ADD COLUMN c text NOT NULL DEFAULT 'x';\nDELETE FROM t WHERE id = 1;`)).toEqual([]);
  });
  it('D6: a file that CREATEs / ADDs the replacement AND drops the source (541)', () => {
    expect(rules(`CREATE TABLE new_t (id uuid);\nINSERT INTO new_t SELECT id FROM old_t;\nDROP TABLE old_t;`)).toEqual(['D1:old_t', 'D6:900_x.sql']);
    expect(rules(`ALTER TABLE t ADD COLUMN b text;\nALTER TABLE t DROP COLUMN a;`)).toEqual(['D2:a', 'D6:900_x.sql']);
  });
  it('D1 proof: an empty check that RAISEs, or an archive (INSERT … SELECT FROM the table), BEFORE the drop', () => {
    expect(dropIsProven(`DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM old_t; IF n > 0 THEN RAISE EXCEPTION 'not empty'; END IF; END $$;\nDROP TABLE old_t;`, 'old_t')).toBe(true);
    expect(dropIsProven(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM old_t) THEN RAISE EXCEPTION 'x'; END IF; END $$;\nDROP TABLE old_t;`, 'old_t')).toBe(true);
    expect(dropIsProven(`INSERT INTO archive_t (id) SELECT id FROM old_t;\nDROP TABLE old_t;`, 'old_t')).toBe(true);
    expect(dropIsProven(`DROP TABLE old_t;\nINSERT INTO archive_t (id) SELECT id FROM old_t;`, 'old_t')).toBe(false);   // after the drop is no proof
    expect(dropIsProven(`DROP TABLE IF EXISTS old_t;`, 'old_t')).toBe(false);
  });
});

describe('check:migration-safety — the review', () => {
  const findings = (sql: string, file = '900_new.sql') => scan(file, sql).map((o: any) => ({ file, ...o }));
  it('a NEW migration with an unreviewed destructive statement fails; reviewed with a reason and the rule capped, it passes', () => {
    const f = findings(`ALTER TABLE t ALTER COLUMN c SET NOT NULL;`);
    expect(evaluate(f, {}).problems).toHaveLength(1);
    expect(evaluate(f, { '900_new.sql': { rules: { D4: 1 }, reason: 'backfilled in 899' } }).problems).toEqual([]);
    expect(evaluate(f, { '900_new.sql': { rules: { D4: 1 }, reason: '' } }).problems).toHaveLength(1);                 // no reason = not reviewed
    expect(evaluate(f, { '900_new.sql': { rules: { D2: 1 }, reason: 'x' } }).problems[0]).toMatch(/rule D4 not listed/);
  });
  it('an entry covering more statements than it records fails (a second destructive statement needs its own review)', () => {
    const f = findings(`ALTER TABLE t ALTER COLUMN a SET NOT NULL;\nALTER TABLE t ALTER COLUMN b SET NOT NULL;`);
    expect(evaluate(f, { '900_new.sql': { rules: { D4: 1 }, reason: 'x' } }).problems[0]).toMatch(/records 1, found 2/);
  });
  it('a DROP TABLE without an in-file proof fails even when reviewed — unless the entry attests archived / provenEmpty', () => {
    const f = findings(`DROP TABLE IF EXISTS old_t;`);
    expect(evaluate(f, { '900_new.sql': { rules: { D1: 1 }, reason: 'unused' } }).problems[0]).toMatch(/no empty check or archive/);
    expect(evaluate(f, { '900_new.sql': { rules: { D1: 1 }, reason: 'archived to S3 on …', archived: true } }).problems).toEqual([]);
    const proven = findings(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM old_t) THEN RAISE EXCEPTION 'x'; END IF; END $$;\nDROP TABLE old_t;`);
    expect(evaluate(proven, { '900_new.sql': { rules: { D1: 1 }, reason: 'unused, proven empty' } }).problems).toEqual([]);
  });
  it('the committed tree: every destructive statement reviewed, nothing stale (the baseline is exact)', () => {
    const r = evaluate(scanAll(), loadAllowlist());
    expect(r.problems).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});
