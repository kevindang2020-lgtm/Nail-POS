/* audit-unreached-routes.js — THE MIRROR OF check:crosswire.
 *
 * == THE BLIND SPOT THIS CLOSES ===========================================================================
 *
 * `check:crosswire` asks: does every frontend call hit a real route? It catches the call that 404s.
 *
 * It cannot catch the opposite, and the opposite is the one this codebase keeps producing:
 *
 *     GET/PATCH /pos/technicians/:id/app-access
 *     GET/PATCH /pos/technicians/:id/permissions
 *     GET/PATCH /pos/technicians/:id/skills
 *
 * Six live, guarded, permission-checked routes. `posTechniciansApi` had no method for any of them. NOTHING IN
 * ANY FRONTEND HAS EVER CALLED THEM. The backend was rewritten to persist what they accept — and it landed
 * somewhere no manager could reach, because the screen to reach it from did not exist.
 *
 * Built, tested, never wired. Every gate was green the whole time: tsc passed, the tests passed, check:crosswire
 * passed, check:public passed, check:perms passed. A route with no caller is invisible to all of them.
 *
 * So this asks the other question: WHICH ROUTES DOES NOBODY CALL?
 *
 * == WHY IT REPORTS RATHER THAN SHOUTS ====================================================================
 *
 * Plenty of routes legitimately have no frontend caller — webhooks, scheduled jobs, health probes, the public
 * booking API, native-shell-only endpoints. A checker that flags those is a checker that cries wolf, and one
 * that cries wolf gets ignored on the day it is right. So it CLASSIFIES: routes that plainly serve a machine are
 * reported and passed over; routes on a surface a human uses — /pos, /tech, /owner — are the ones it will fail on.
 */
const fs = require('fs');
const path = require('path');
const { routes } = require('./audit-routes.js');

const ROOT = path.resolve(__dirname, '../../');   // scripts/ -> apps/api -> apps

// The extractor lives in ONE place now — shared with audit-crosswire, which had drifted from this file's copy
// in seven separate ways. See scripts/frontend-calls.js for the full list; every one of them was a way of not
// seeing a call that was really there.
const { extractFrontendCalls, callMatchesRoute } = require('./frontend-calls');

const calls = extractFrontendCalls();
const reached = (route) => calls.some((c) => callMatchesRoute(c, route));

// ── who is a route FOR? ───────────────────────────────────────────────────────────────────────────────────
//
// A machine surface with no frontend caller is normal and expected. A HUMAN surface with no frontend caller is a
// screen that does not exist — the bug this file was written for.
const MACHINE = [
  /^webhooks?\//, /^public\//, /^jobs?\//, /^health/, /^metrics$/, /^internal\//, /^ai\/webhook/, /^messaging\/(inbound|status)/,
  /^payments?\/(webhook|callback)/, /^twilio\//, /^fiserv\//, /^clover\//, /^cardpointe\//, /^_/,
];
const isMachine = (p) => MACHINE.some((re) => re.test(p.replace(/^\/+/, '')));

// The surfaces a person uses. An unreached route here means nobody can get to it.
const HUMAN = /^\/(pos|tech|owner)\//;

const unreached = routes.filter((r) => !reached(r));
const machine = unreached.filter((r) => isMachine(r.path));
const human = unreached.filter((r) => !isMachine(r.path) && HUMAN.test(r.path));
const other = unreached.filter((r) => !isMachine(r.path) && !HUMAN.test(r.path));

// ── the BASELINE: routes that were already dead when this checker was written ─────────────────────────────
//
// There were 365 of them. That is not a list anybody has read, and calling it "reviewed" would be a lie — so it
// is called DEBT, which is what it is. Roughly a third of the /pos, /tech and /owner route surface is code that
// was built, tested, guarded, permission-checked, and that no screen has ever called.
//
// This checker cannot fix that, and neither could one session. What it can do is make the number VISIBLE and
// make it one-way: a route that is dead today stays on the ledger, and a route that goes dead TOMORROW fails the
// build. Delete a route or wire a caller and the ledger shrinks — running with --update rewrites it.
//
// Same shape as check:tenant's reviewed baseline, and for the same reason: a checker that fails on 365
// pre-existing findings is a checker somebody deletes on their first bad afternoon.
// ══ HOW MUCH TO TRUST THIS FILE ═══════════════════════════════════════════════════════════════════════════
//
// Not as much as you would like. Building it, the extractor was WRONG FIVE TIMES, and each fix moved the number:
//
//   365 →  a base-path constant (`const CO = '/pos/checkout'`) collapsed into one wildcard segment
//   337 →  a whole call STYLE unseen: bare `http<T>(path, { method })` instead of `api.post(path)` — 16 api files
//   294 →  a base path hidden INSIDE the helper (`const BASE = ORIGIN + '/pos/queue'; http('/kpis')`)
//   301 →  a generic matcher `<[\s\S]*?>` that spanned newlines and swallowed real call sites whole
//   294 →  …and the fix for that broke multi-line generics, so it had to be `<[^()]*?>`
//
// `audit-crosswire` shares at least two of those flaws, which means its "0 orphaned" is over a SUBSET of calls.
//
// So the baseline below is a SNAPSHOT, NOT A VERDICT. Entries in it have not all been verified by a human, and
// some are certainly still false positives from a call style nobody has hit yet. What has been verified by hand:
//
//   REAL   /pos/technicians/:id/app-access|permissions|skills  (six routes — wired this session; now reached)
//   REAL   /pos/ai-inventory/recipes, /positions               (posAiInventoryApi calls only 4 other routes)
//   REAL   /owner/me/privacy-export, /tech/me/privacy-export   (only customer-web calls its own variant)
//   REAL   /pos/deposit-reconciliation/fee-schedules
//
// TREAT EVERY ENTRY AS A LEAD, NOT A FINDING. Verify before you delete anything.
//
// What the gate is still good for, and why it is worth keeping: a route appearing here that was NOT here before
// means either a genuinely new dead route, or a call style the extractor has never seen. Both are worth a look,
// and the baseline absorbs the noise so the signal is the DELTA.
const BASELINE_FILE = path.join(__dirname, 'unreached-routes.baseline.json');
const BASELINE = new Set(fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : []);

const key = (r) => `${r.method} ${r.path}`;

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(human.map(key).sort(), null, 2) + '\n');
  console.log(`baseline rewritten: ${human.length} unreached human-facing routes recorded as debt.`);
  process.exit(0);
}

const failures = human.filter((r) => !BASELINE.has(key(r)));
const paid = [...BASELINE].filter((k) => !human.some((r) => key(r) === k));

console.log('=== UNREACHED ROUTES — the mirror of check:crosswire ===\n');
console.log(`backend routes:            ${routes.length}`);
console.log(`frontend calls (9 apps):   ${calls.length}`);
console.log(`   reached by a frontend:  ${routes.length - unreached.length}`);
console.log(`   UNREACHED:              ${unreached.length}`);
console.log(`      machine surfaces (webhooks/jobs/public — expected):  ${machine.length}`);
console.log(`      other (super-admin, customer, native-only):          ${other.length}`);
console.log(`      ── HUMAN surfaces (/pos, /tech, /owner):             ${human.length}`);
console.log(`            on the debt ledger:  ${human.length - failures.length}`);
console.log(`            NEWLY DEAD:          ${failures.length}\n`);
if (paid.length) console.log(`   ${paid.length} route(s) came OFF the ledger — wired or deleted. Run --update to record it.\n`);

if (failures.length) {
  console.log('NEW dead routes. These are live, guarded, permission-checked — and NO SCREEN IN ANY APP CALLS THEM.');
  console.log('A person cannot reach them. Wire a caller, or delete the route.\n');
  for (const r of failures) console.log(`   ${r.method.padEnd(6)} ${r.path}`);
  console.log('');
  process.exit(1);
}

console.log(`OK — no NEW unreached routes.`);
console.log(`   ${human.length} on the ledger — LEADS, not findings. The extractor was wrong 5 times while this`);
console.log('   was written; some entries are certainly still false positives. Verify by hand before deleting.');
console.log('   The signal is the DELTA: a route appearing here that was not here before is worth a look.');
if (other.length) console.log(`   (${other.length} unreached elsewhere: super-admin/customer/native — listed with --verbose)`);
if (process.argv.includes('--verbose')) {
  console.log('\n── unreached, other surfaces ──');
  for (const r of other) console.log(`   ${r.method.padEnd(6)} ${r.path}`);
}
