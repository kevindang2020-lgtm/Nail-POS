/* audit-dead-client-methods.js — THE THIRD LAYER.
 *
 * == THE BLIND SPOT BETWEEN THE OTHER TWO ==================================================================
 *
 * There are three links in the chain from a screen to a route, and until now only two of them were checked:
 *
 *     screen  ──?──>  api client method  ──crosswire──>  route
 *             ^^^^^                      <──unreached──
 *             THIS ONE
 *
 *   • check:crosswire   — a client method that calls a route which does not exist    (a call that 404s)
 *   • check:unreached   — a route that no client method calls                        (a route nobody can reach)
 *   • THIS              — a client method that NO SCREEN calls                       (a feature with no button)
 *
 * The gap is not theoretical. `customerApi.privacyExport()` has existed for as long as the customer app has:
 *
 *     privacyExport: () => api.get<unknown>('/customer/me/privacy-export'),
 *
 * `check:crosswire` was happy — the route exists. `check:unreached` was happy — the route HAS a caller. And no
 * screen in the customer app ever called `privacyExport()`. So the route had a caller and the caller had no
 * button, and the practical fact on the ground was that **not one user of this platform could download their own
 * personal data**, while the server sat there able to hand it over. Both audits, green, the whole time.
 *
 * A method declared and never called is a feature that was built, tested, and then never given a way in.
 *
 * == HOW IT DECIDES ========================================================================================
 *
 * A method is CALLED if its name appears anywhere in the app outside the api/ directory and outside tests —
 * as `thing.method(`, or as a bare identifier (destructured: `const { privacyExport } = customerApi`), or
 * passed by reference (`onClick={api.refresh}`). That is deliberately generous: this audit would rather miss a
 * dead method than accuse a live one. Six of the seven bugs found in the sibling audits were the checker being
 * wrong, not the code.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const APPS = [
  'admin-web', 'customer-web', 'manager-pay-web', 'owner-web', 'pos-web', 'tech-web', 'customer-display',
  'go-check-in-kiosk',   // go-check-in-admin removed in Phase 15 (Oct 10 2026)
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'dist') continue; walk(p, out); }
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const dead = [];
let totalMethods = 0;

for (const app of APPS) {
  const src = path.join(ROOT, app, 'src');
  const files = walk(src);
  if (!files.length) continue;

  // Everything that is NOT an api-client file and NOT a test — i.e. the places a method could be called FROM.
  const consumerText = files
    .filter((f) => !/[/\\]api[/\\]/.test(f) && !/\.(spec|test)\.tsx?$/.test(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  for (const f of files.filter((f) => /[/\\]api[/\\].*\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f))) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);

    // export const somethingApi = { … };   — take the object body and read its top-level method names.
    const objRe = /export\s+const\s+([A-Za-z_$][\w$]*Api)\s*=\s*\{/g;
    let om;
    while ((om = objRe.exec(text))) {
      const objName = om[1];
      let i = objRe.lastIndex, depth = 1;
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
      }
      const body = text.slice(objRe.lastIndex, i - 1);

      // top-level `name: (` or `name(` — nested object keys sit deeper and are skipped by the depth guard
      let d = 0;
      const methodRe = /(^|[\n,{])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(/g;
      let mm;
      while ((mm = methodRe.exec(body))) {
        const before = body.slice(0, mm.index);
        d = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
        if (d !== 0) continue;                    // nested — not a method on this api object
        const name = mm[2];
        totalMethods++;

        // A DOT before the name always means USAGE — a declaration (`pauseGateway: (id) => …`) has no dot.
        //
        // The first version carried a negative lookahead for `:` here, meant to skip declarations. It skipped a
        // real usage instead:
        //
        //     const fn = action === 'pause' ? superAdminApi.pauseGateway : superAdminApi.resumeGateway;
        //
        // …passed by REFERENCE inside a ternary, so the next non-space character is the ternary's colon. The
        // lookahead threw it out and the audit called a live method dead. The lookahead was never needed: the
        // dot does that job on its own.
        const called =
          new RegExp(`\\.\\s*${name}\\b`).test(consumerText) ||                 // api.method( … or api.method as a value
          new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*${objName}`).test(consumerText); // destructured

        if (!called) dead.push({ app, obj: objName, name, file: rel });
      }
    }
  }
}

// ── the ledger ────────────────────────────────────────────────────────────────────────────────────────────
const BASELINE_FILE = path.join(__dirname, 'dead-client-methods.baseline.json');
const BASELINE = new Set(fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : []);
const key = (d) => `${d.app} ${d.obj}.${d.name}`;

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(dead.map(key).sort(), null, 2) + '\n');
  console.log(`baseline rewritten: ${dead.length} client methods with no caller.`);
  process.exit(0);
}

const failures = dead.filter((d) => !BASELINE.has(key(d)));

console.log('=== DEAD CLIENT METHODS — a feature with no button ===\n');
console.log(`api client methods:      ${totalMethods}`);
console.log(`   called by a screen:   ${totalMethods - dead.length}`);
console.log(`   NO SCREEN CALLS THEM: ${dead.length}`);
console.log(`      on the ledger:     ${dead.length - failures.length}`);
console.log(`      NEWLY DEAD:        ${failures.length}\n`);

if (failures.length) {
  console.log('These api client methods are declared and NOTHING CALLS THEM. Whatever they were for, a user');
  console.log('cannot get to it. Wire a caller, or delete the method.\n');
  for (const d of failures) console.log(`   ${d.app.padEnd(16)} ${d.obj}.${d.name}   (${d.file})`);
  console.log('');
  process.exit(1);
}

console.log('OK — no NEW dead client methods.');
console.log(`   ${dead.length} on the ledger — LEADS, not findings. The matcher is deliberately generous (it would`);
console.log('   rather miss a dead method than accuse a live one). Open each one before deleting it.');
if (process.argv.includes('--verbose')) {
  console.log('\n── the ledger ──');
  for (const d of dead) console.log(`   ${d.app.padEnd(16)} ${d.obj}.${d.name}`);
}
