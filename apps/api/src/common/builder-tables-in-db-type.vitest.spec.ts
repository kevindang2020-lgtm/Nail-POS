// builder-tables-in-db-type.vitest.spec — every Kysely builder call names a table that the DB type declares.
//
// Why (Nov 5 2026): platform_notice_targets & co. were used through db.deleteFrom / selectFrom but never added to
// packages/database kysely.types.ts. TypeScript then tries the unknown name against all ~750 table names and their
// "x as y" alias forms, and `npm run build:modules` spent 20+ minutes on the communications module (it never finished in
// CI-sized sandboxes). A missing table is a type hole AND a build-time bomb, so it fails here in milliseconds instead.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
// Deliberately absent: owner_notifications — the developer's parallel table was never reproduced (see
// in-app-notification.consumer.ts); the analytics reads go through `as any` and a best-effort catch.
const ALLOWED_MISSING = new Set(['owner_notifications']);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

describe('Kysely builder tables are declared in DB', () => {
  it('no selectFrom / insertInto / updateTable / deleteFrom on a table missing from kysely.types.ts', () => {
    const types = readFileSync(join(ROOT, 'packages/database/src/kysely.types.ts'), 'utf8');
    const body = types.slice(types.indexOf('export interface DB {'));
    const declared = new Set([...body.slice(0, body.indexOf('\n}')).matchAll(/\b([a-z_][a-z0-9_]*)\s*:/g)].map((m) => m[1]));
    expect(declared.size).toBeGreaterThan(100);
    const missing: string[] = [];
    const roots = ['modules', 'packages', 'apps/api/src'].map((r) => join(ROOT, r));
    for (const root of roots) for (const f of walk(root)) {
      if (!f.includes('/src/') && !f.startsWith(join(ROOT, 'apps/api/src'))) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\.(?:selectFrom|insertInto|deleteFrom|updateTable|mergeInto)\(\s*'([a-z_][a-z0-9_]*)(?: as [a-z_]+)?'/g)) {
        if (!declared.has(m[1]) && !ALLOWED_MISSING.has(m[1])) missing.push(`${m[1]}  (${relative(ROOT, f)})`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
