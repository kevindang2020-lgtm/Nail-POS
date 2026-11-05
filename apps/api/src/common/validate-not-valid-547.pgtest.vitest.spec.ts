// validate-not-valid-547.pgtest — BUILD_PLAN Phase 10: migration 547 validates every constraint left NOT VALID by earlier
// phases; a constraint the existing data breaks stays NOT VALID and is recorded for retry instead of failing the deploy.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';

const SQL547 = readFileSync(join(MIGRATIONS_DIR, '547_validate_not_valid_constraints.sql'), 'utf8');
let pg: any;
const rows = async (s: string) => (await pg.query(s)).rows;
beforeAll(async () => { pg = await migratedPglite(); }, 120_000);

describe('547 — no NOT VALID constraint left behind', () => {
  it('a fresh database has every constraint validated and nothing deferred', async () => {
    expect(await rows(`select conname from pg_constraint where not convalidated`)).toEqual([]);
    expect(await rows(`select name from schema_deferred_constraints`)).toEqual([]);
  });
  it('validates a NOT VALID constraint the data satisfies, and defers (not fails) one the data breaks', async () => {
    await pg.exec(`create table p547_ok (n int); insert into p547_ok values (1);
      alter table p547_ok add constraint chk_p547_ok check (n > 0) not valid;
      create table p547_bad (n int); insert into p547_bad values (-1);
      alter table p547_bad add constraint chk_p547_bad check (n > 0) not valid;`);
    await pg.exec(SQL547);
    const v = await rows(`select conname, convalidated from pg_constraint where conname in ('chk_p547_ok','chk_p547_bad') order by conname`);
    expect(v).toEqual([{ conname: 'chk_p547_bad', convalidated: false }, { conname: 'chk_p547_ok', convalidated: true }]);
    const d = await rows(`select name, table_name, kind, retry_sql, reason from schema_deferred_constraints where resolved_at is null`);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: 'chk_p547_bad', table_name: 'p547_bad', kind: 'check_validation', retry_sql: 'ALTER TABLE p547_bad VALIDATE CONSTRAINT chk_p547_bad' });
    expect(d[0].reason).not.toMatch(/-1/);   // never the row contents
    // the bad row still cannot be joined by a NEW bad row — NOT VALID still enforces new writes
    await expect(pg.exec(`insert into p547_bad values (-2)`)).rejects.toThrow();
    // re-running is safe and does not duplicate the deferral
    await pg.exec(SQL547);
    expect(await rows(`select count(*)::int c from schema_deferred_constraints where name = 'chk_p547_bad'`)).toEqual([{ c: 1 }]);
  });
});
