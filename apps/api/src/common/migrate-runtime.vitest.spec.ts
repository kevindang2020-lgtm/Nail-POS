// migrate-runtime.vitest.spec.ts — BUILD_PLAN Phase 10: the production container can actually run the migration runner
// and the DB pre-flight. The runtime stage of the Dockerfile copies files one by one; when migrate.mjs started importing
// ../db/migration-sql.mjs (Phase 10) the image would have died on start with ERR_MODULE_NOT_FOUND before any migration
// ran. Every relative import of the start-up scripts must be copied into the runtime stage, and both deploy start
// commands must run the pre-flight before migrating.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const API = resolve(__dirname, '..', '..');
const ROOT = resolve(API, '..', '..');
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));   // the last stage is the runtime image

/** Relative imports of a script, followed transitively (only files inside apps/api). */
function closure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import\s[^'"]*from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) closure(resolve(dirname(file), m[1]), seen);
  return seen;
}

describe('runtime image carries the start-up scripts', () => {
  for (const script of ['scripts/migrate.mjs', 'scripts/db-preflight.mjs']) {
    it(`${script} and everything it imports are copied into the runtime stage`, () => {
      for (const f of closure(join(API, script))) {
        const rel = relative(API, f);
        expect(runtime, `Dockerfile runtime stage does not copy apps/api/${rel}`).toMatch(new RegExp(`COPY --from=build /app/apps/api/${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`));
      }
    });
  }
  // Phase 11 (E4): the Railway PRE-DEPLOY step runs the pre-flight then the migrations once per release; the image CMD
  // does the same only behind MIGRATE_ON_START=1 (container-image.vitest.spec.ts holds the rest of that contract).
  it('the pre-deploy command and the opt-in CMD path run the pre-flight, then migrate', () => {
    const want = /node scripts\/db-preflight\.mjs && node scripts\/migrate\.mjs/;
    expect(dockerfile).toMatch(want);
    expect(JSON.parse(readFileSync(join(ROOT, 'railway.json'), 'utf8')).deploy.preDeployCommand.join(' ')).toMatch(want);
  });
});
