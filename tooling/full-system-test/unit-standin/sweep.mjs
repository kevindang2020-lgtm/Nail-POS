// sweep.mjs — run every backend / package unit-test file (*.test.ts, *.spec.ts; not .tsx UI tests) through the stand-in
// harness (Node --experimental-strip-types + vitest shim + stubs for packages missing from node_modules). Classifies each
// file: PASS (all its tests passed), FAIL (a test assertion failed), LOAD (could not load — a missing package / syntax the
// stripper cannot run / a pgtest needing PGlite), TIMEOUT. Writes sweep.json + sweep.tsv.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const HARNESS = new URL('./', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.env.OUT || process.cwd();   // where sweep-live.tsv / rerun.tsv are written
const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n')
  .filter((f) => /\.(test|spec)\.ts$/.test(f) && !/(^|\/)(e2e|browser-tests|playwright)\//.test(f) && !/\.e2e\./.test(f));
const PRI = ['modules/checkout/','modules/payments/','modules/workforce/','modules/queue/','modules/booking/','modules/gift-cards/','modules/identity/','modules/tenants/','modules/appointments/','modules/customers/','modules/memberships/','modules/communications/','packages/','modules/'];
const rank = (f) => { const i = PRI.findIndex((p) => f.startsWith(p)); return i < 0 ? 99 : i; };
files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
writeFileSync(`${OUT}/sweep-live.tsv`, '');
const PAR = Number(process.env.PAR || 6), TMO = Number(process.env.TMO || 90_000);
const out = []; let i = 0;
function one(f) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn('bash', [`${HARNESS}/run.sh`, REPO, `${REPO}/${f}`], { cwd: REPO, env: { ...process.env, FST_PG_PORT: '55432' } });
    let s = ''; p.stdout.on('data', (d) => { s += d; }); p.stderr.on('data', (d) => { s += d; });
    const k = setTimeout(() => p.kill('SIGKILL'), TMO);
    p.on('close', (code, sig) => {
      clearTimeout(k);
      let m = /: (\d+) passed, (\d+) failed \(of (\d+)\)/.exec(s);
      if (!m) { const own = /(\d+)\s*\/\s*(\d+) passed/.exec(s); if (own) m = [own[0], own[1], String(+own[2] - +own[1]), own[2]]; }
      let st = sig ? 'TIMEOUT' : m ? (Number(m[2]) ? 'FAIL' : code === 0 ? 'PASS' : 'FAIL') : 'LOAD';
      if (m && !Number(m[3])) st = 'EMPTY';
      const ENV = /(selectFrom|insertInto|updateTable|deleteFrom|selectNoFrom|withRecursive|replaceInto|mergeInto|transaction|executeQuery|getExecutor|withSchema|schema|introspection|fn|dynamic|with)\b[^\n]*is not a function|HARNESS:|Cannot read properties of undefined \(reading '(selectFrom|insertInto|updateTable|deleteFrom|transaction|fn|execute)'\)|class constructors? (must be invoked|cannot be invoked)|Kysely/;
      const failMsgs = [...s.matchAll(/✗ [^\n]*\n\s+([^\n]*)/g)].map((x) => x[1]);
      if (st === 'FAIL' && failMsgs.length && failMsgs.every((x) => ENV.test(x))) st = 'ENV_FAIL';
      if (st === 'LOAD' && ENV.test(s)) st = 'ENV_LOAD';
      const why = st === 'PASS' ? '' : (s.match(/(Cannot find (module|package)[^\n]*|SyntaxError[^\n]*|ERR_[A-Z_]+[^\n]*|✗[^\n]*|AssertionError[^\n]*|Error:[^\n]*)/)?.[0] ?? s.trim().split('\n').pop() ?? '').slice(0, 220);
      out.push({ f, st, pass: m ? +m[1] : 0, failed: m ? +m[2] : 0, total: m ? +m[3] : 0, ms: Date.now() - t0, why });
      appendFileSync(`${OUT}/sweep-live.tsv`, [out.at(-1).st, f, out.at(-1).pass, out.at(-1).failed, out.at(-1).total, out.at(-1).ms, out.at(-1).why].join('\t') + '\n');
      res();
    });
  });
}
async function worker() { while (i < files.length) { const f = files[i++]; await one(f); if (out.length % 100 === 0) console.log(`${out.length}/${files.length}`); } }
await Promise.all(Array.from({ length: PAR }, worker));
out.sort((a, b) => a.f.localeCompare(b.f));
writeFileSync(`${OUT}/sweep.json`, JSON.stringify(out, null, 1));
writeFileSync(`${OUT}/sweep.tsv`, out.map((o) => [o.st, o.f, o.pass, o.failed, o.total, o.ms, o.why].join('\t')).join('\n'));
const c = {}; for (const o of out) c[o.st] = (c[o.st] ?? 0) + 1;
const tests = out.reduce((a, o) => ({ p: a.p + o.pass, f: a.f + o.failed }), { p: 0, f: 0 });
console.log('files', files.length, JSON.stringify(c), 'tests passed', tests.p, 'failed', tests.f);
