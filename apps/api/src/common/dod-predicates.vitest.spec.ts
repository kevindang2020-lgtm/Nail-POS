// dod-predicates — BUILD_PLAN Phase 14: every Definition-of-Done line (Constitution 7 §303, 11 §396, 12 §324) is a
// predicate over EVIDENCE in the tree, and this proves it line by line, for all three scripts (statuses: DONE, HOSTING,
// DECIDED — Phase 15 —, PARTIAL, NOT DONE):
//   1. the script names each line's evidence (DOD_TRACE=1 prints the files the predicate read — scripts/dod-lib.mjs);
//   2. a scratch tree holding ONLY that evidence gives the line the same status it has in the real tree (the predicate
//      is satisfiable by exactly what it names — nothing else in the repository props it up);
//   3. removing any ONE of those files flips the line to NOT DONE (for an either/or predicate — `a || b` in the
//      source — removing all of them does). A line that cannot fail, a bare `true`, has no evidence and fails step 3.
// The copy-tree approach (DOD_ROOT) runs the real scripts unmodified; nothing is mocked.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const run = promisify(execFile);
const API = join(__dirname, '..', '..');
const SCRIPTS = ['observability-dod-check.mjs', 'security-dod-check.mjs', 'control-plane-dod-check.mjs'] as const;
type Line = { status: string; name: string; files: string[] };

async function lines(script: string, root?: string): Promise<Line[]> {
  const env = { ...process.env, DOD_TRACE: '1', ...(root ? { DOD_ROOT: join(root, 'apps', 'api') } : {}) };
  delete (env as any).DOD_VERBOSE;
  // a scratch tree is missing most files: the script prints BROKEN CHECK and exits 1 — the lines are still printed
  const out = await run('node', [join(API, 'scripts', script)], { env, cwd: API, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout, (e) => String(e.stdout ?? ''));
  const res: Line[] = []; const rows = out.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const m = /^(DONE|HOSTING|DECIDED|PARTIAL|NOT DONE)\s+(.+?)(?: {2}— .*)?$/.exec(rows[i]);
    if (!m) continue;
    const f = /^\s+files: (.*)$/.exec(rows[i + 1] ?? '');
    res.push({ status: m[1], name: m[2], files: f ? JSON.parse(f[1]) : [] });
  }
  return res;
}
/** a scratch repository holding only `files` (paths relative to apps/api, as the scripts name them) */
function scratch(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dod-'));
  mkdirSync(join(root, 'apps', 'api'), { recursive: true });
  for (const f of files) {
    const src = join(API, f), dst = join(root, 'apps', 'api', f);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: statSync(src).isDirectory() });
  }
  return root;
}
const statusIn = async (script: string, name: string, files: string[]) => {
  const root = scratch(files);
  try { return (await lines(script, root)).find((l) => l.name === name)?.status; } finally { rmSync(root, { recursive: true, force: true }); }
};
/** run `fn` over `xs` with at most `n` in flight (each case spawns node) */
async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); })); }

for (const script of SCRIPTS) {
  describe(`${script} — every line is evidence that can be removed`, () => {
    let real: Line[] = [];
    const src = readFileSync(join(API, 'scripts', script), 'utf8');
    beforeAll(async () => { real = await lines(script); }, 120_000);

    it('prints every line with the evidence its predicate read', () => {
      expect(real.length).toBe(script.startsWith('observability') ? 76 : script.startsWith('security') ? 82 : 73);
      const none = real.filter((l) => l.files.length === 0).map((l) => l.name);
      expect(none, 'a line with no evidence is an assertion, not a check').toEqual([]);
    });

    // BUILD_PLAN Phase 15: a DECIDED line names its decision, and the decision's RECORD is among its evidence (a decision
    // that exists only in the script's note is an assertion). PARTIAL lines are gone from all three scripts.
    it('every DECIDED line carries its decision record as evidence; no PARTIAL line remains', () => {
      const undocumented = real.filter((l) => l.status === 'DECIDED' && !l.files.some((f) => /AUDIT\.md$|DECISIONS?.*\.md$/.test(f))).map((l) => l.name);
      expect(undocumented).toEqual([]);
      expect(real.filter((l) => l.status === 'PARTIAL').map((l) => l.name)).toEqual([]);
      if (script.startsWith('control-plane')) expect(real.filter((l) => l.status === 'DECIDED').map((l) => l.name).sort()).toEqual(['Platform API separated under /platform', 'Super Admin frontend modularized']);
    });

    it('each passing line holds on its own evidence alone, and flips to NOT DONE when that evidence is removed', async () => {
      const failures: string[] = [];
      await pool(real.filter((l) => l.status !== 'NOT DONE'), 6, async (l) => {
        const alone = await statusIn(script, l.name, l.files);
        if (alone !== l.status) { failures.push(`${l.name}: ${l.status} in the tree but ${alone} on its own evidence ${JSON.stringify(l.files)}`); return; }
        const either = new RegExp(`'${l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^\\n]*\\|\\|`).test(src);
        if (either) {
          const none = await statusIn(script, l.name, []);
          if (none !== 'NOT DONE') failures.push(`${l.name}: still ${none} with all of its evidence removed`);
          return;
        }
        for (const f of l.files) {
          const without = await statusIn(script, l.name, l.files.filter((x) => x !== f));
          if (without !== 'NOT DONE') failures.push(`${l.name}: still ${without} without ${f}`);
        }
      });
      expect(failures).toEqual([]);
    }, 600_000);
  });
}
