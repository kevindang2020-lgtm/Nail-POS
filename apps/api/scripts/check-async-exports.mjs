// check-async-exports.mjs — BUILD_PLAN Phase 12 (Constitution 5 §32–33): every export GET that BUILDS a file is on the ONE
// async operation contract (@AsyncExport → 202 + status URL on request, the api.export worker, /…/operations).
//
// The candidates are the manifest's `GET …export… / …download… / …csv…` routes (the same set the contract names). Each
// one carries @AsyncExport, or is in async-exports.exempt.json with the reason it does not build a file (it streams a
// file that already exists, it is a list, or it is a pre-Phase-12 job route that the operations routes alias). An entry
// whose route is gone or became decorated fails too, so the exempt list stays true.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const gen = await import('./openapi.mjs');
const { routes } = require('./audit-routes.js');
export const EXEMPT_FILE = join(HERE, 'async-exports.exempt.json');

export const isCandidate = (r) => r.method === 'GET' && /(export|download|csv)/i.test(r.path);
export const asyncKindOf = (r) => /kind\s*:\s*['"`]([^'"`]+)['"`]/.exec(r.decorators.find((d) => d.name === 'AsyncExport')?.args ?? '')?.[1] ?? null;

export function evaluate(rs = routes, exempt = JSON.parse(readFileSync(EXEMPT_FILE, 'utf8')).routes ?? {}) {
  const cands = rs.filter(isCandidate).map((r) => ({ key: `${r.method} ${gen.openapiPath(r.path)}`, kind: asyncKindOf(r), file: r.file }));
  const decorated = cands.filter((c) => c.kind);
  const missing = cands.filter((c) => !c.kind && !exempt[c.key]).map((c) => `${c.key}  (${c.file})`);
  const keys = new Set(cands.map((c) => c.key));
  const stale = Object.keys(exempt).filter((k) => !keys.has(k) || decorated.some((d) => d.key === k));
  const kinds = decorated.map((d) => d.kind);
  const dupKinds = [...new Set(kinds.filter((k, i) => kinds.indexOf(k) !== i))];
  return { total: cands.length, decorated: decorated.length, exempt: Object.keys(exempt).length, missing, stale, dupKinds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = evaluate();
  console.log(`check:async-exports: ${r.decorated}/${r.total - r.exempt} file-building export routes on the async contract (${r.exempt} exempt: stored-file downloads, lists, aliased job routes)`);
  const list = (t, xs) => { if (xs.length) { console.error(`\n${t} (${xs.length}):`); for (const x of xs) console.error(`  ${x}`); } };
  list('NOT ON THE ASYNC CONTRACT — add @AsyncExport({ kind }) (or, if it builds no file, an exempt entry with the reason)', r.missing);
  list('Exempt entries whose route is gone or now decorated — remove them', r.stale);
  list('Two routes share one AsyncExport kind — kinds name ONE export', r.dupKinds);
  process.exit(r.missing.length + r.stale.length + r.dupKinds.length ? 1 : 0);
}
