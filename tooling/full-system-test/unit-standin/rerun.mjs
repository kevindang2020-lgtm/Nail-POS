// rerun.mjs — second pass over every sweep file that did not PASS, the way vitest itself runs it: NODE_ENV=test and the
// spec's package directory as cwd (vitest runs per workspace package). Writes rerun.tsv (same columns as sweep-live.tsv).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const HARNESS = new URL('./', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.env.OUT || process.cwd();   // where sweep-live.tsv / rerun.tsv are written
const rows = readFileSync(`${OUT}/sweep-live.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const files = rows.filter((r) => ['FAIL', 'ENV_FAIL', 'ENV_LOAD', 'LOAD', 'TIMEOUT'].includes(r[0]) && !/pgtest|postgres-race/.test(r[1])).map((r) => r[1]);
writeFileSync(`${OUT}/rerun.tsv`, '');
const ENV = /(selectFrom|insertInto|updateTable|deleteFrom|selectNoFrom|withRecursive|transaction|executeQuery|getExecutor|withSchema|schema|fn|dynamic|with)\b[^\n]*is not a function|HARNESS:|Cannot read properties of undefined \(reading '(selectFrom|insertInto|updateTable|deleteFrom|transaction|fn|execute)'\)|Reflect\.(getMetadata|defineMetadata|getMetadataKeys)|mock(Clear|Reset|RejectedValue|ResolvedValueOnce|ReturnValueOnce|ImplementationOnce)\b[^\n]*is not a function|Cannot find module '[^']*\.tsx?'|ERR_MODULE_NOT_FOUND[^\n]*(\.tsx|ProfileAvatar)|Kysely/;
let i = 0; const PAR = Number(process.env.PAR || 3);
function one(f) {
  return new Promise((res) => {
    const pkg = f.split('/').slice(0, 2).join('/'); const t0 = Date.now();
    const p = spawn('bash', [`${HARNESS}/run.sh`, REPO, `${REPO}/${f}`], { cwd: `${REPO}/${pkg}`, env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC' } });
    let s = ''; p.stdout.on('data', (d) => { s += d; }); p.stderr.on('data', (d) => { s += d; });
    const k = setTimeout(() => p.kill('SIGKILL'), 90_000);
    p.on('close', (code, sig) => {
      clearTimeout(k);
      let m = /: (\d+) passed, (\d+) failed \(of (\d+)\)/.exec(s);
      if (!m) { const own = /(\d+) passed, (\d+) failed/.exec(s) || /(\d+)\s*\/\s*(\d+) passed/.exec(s); if (own) m = own[0].includes('/') ? [own[0], own[1], String(+own[2] - +own[1]), own[2]] : [own[0], own[1], own[2], String(+own[1] + +own[2])]; }
      let st = sig ? 'TIMEOUT' : m ? (Number(m[2]) ? 'FAIL' : 'PASS') : 'LOAD';
      if (m && !Number(m[3])) st = 'EMPTY';
      const fails = [...s.matchAll(/✗ [^\n]*\n\s+([^\n]*)/g)].map((x) => x[1]);
      if (st === 'FAIL' && fails.length && fails.every((x) => ENV.test(x))) st = 'ENV_FAIL';
      if (st === 'LOAD' && ENV.test(s)) st = 'ENV_LOAD';
      const why = st === 'PASS' ? '' : (fails[0] ?? s.match(/(Cannot find (module|package)[^\n]*|SyntaxError[^\n]*|ERR_[A-Z_]+[^\n]*|Error:[^\n]*)/)?.[0] ?? '').slice(0, 220);
      appendFileSync(`${OUT}/rerun.tsv`, [st, f, m ? m[1] : 0, m ? m[2] : 0, m ? m[3] : 0, Date.now() - t0, why, fails.join(' ⏐ ').slice(0, 1500)].join('\t') + '\n');
      res();
    });
  });
}
async function worker() { while (i < files.length) await one(files[i++]); }
await Promise.all(Array.from({ length: PAR }, worker));
console.log('rerun', files.length);
