// permission-check.mjs — every @RequirePermission must exist in the catalog.
//
// ══ THE FAILURE MODE ══════════════════════════════════════════════════════════════════════════════════════
//
//     @RequirePermission('pos.customers.phone.manual_confirm')
//
//     RolePermissionGuard:  if (!hasPermission(req.ctx, key)) throw new ForbiddenException(...)
//
// `hasPermission` resolves the key against `ROLE_PERMISSIONS`. If the key is **not in the catalog**, it matches
// nothing — for **every role, including the owner.**
//
// So a typo'd or never-registered permission does not fail loudly. It produces a route that **denies everyone,
// permanently.** The feature is built, tested, wired, reachable — and **nobody on earth can open it.** The owner
// clicks the sidebar item and gets "Missing permission", and there is no role you can grant to fix it.
//
// `tsc` cannot see it: the key is a string. The unit tests cannot see it: they mock the guard. And it looks
// exactly like a permissions misconfiguration at the tenant, so the first thing anyone does is check the tenant.
//
// The inverse also matters and is checked: a permission in the catalog that NO route uses is dead weight in every
// role-editing screen a salon owner has to reason about.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(new URL('../src', import.meta.url).pathname);

// Constitution 13: domain modules live in modules/*/src and are part of the API's surface — a gate that walked only
// apps/api/src would lose sight of a controller or repository the moment it moved. Every root is walked.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();


const codeLines = (s) =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

// ── the catalog ─────────────────────────────────────────────────────────────────────────────────────────
const PKG = join(SRC, '..', '..', '..', 'packages', 'permissions', 'src');   // Constitution 13: catalog + kernel live in packages/permissions
const rbac = codeLines(readFileSync(join(PKG, 'rbac.ts'), 'utf8'));
const m = /export const PERMISSIONS\s*=\s*\[([\s\S]*?)\]/.exec(rbac);
if (!m) {
  console.error('Could not read PERMISSIONS from packages/permissions/src/rbac.ts — refusing to report OK on a catalog I cannot see.');
  process.exit(2);
}
const catalog = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

// ── every guarded route ─────────────────────────────────────────────────────────────────────────────────
const used = new Map();   // permission -> [files]
for (const f of [SRC, ...MODULE_SRC_ROOTS].flatMap((r) => walk(r))) {
  const src = codeLines(readFileSync(f, 'utf8'));
  for (const p of src.matchAll(/@RequirePermission\(\s*'([^']+)'\s*\)/g)) {
    if (!used.has(p[1])) used.set(p[1], []);
    used.get(p[1]).push(f.replace(SRC + '/', ''));
  }
}

// ── resolve the way the GUARD does ──────────────────────────────────────────────────────────────────────
//
// My first version compared each @RequirePermission key literally against the catalog and reported **151 routes
// that deny everyone.** It was wrong, and spectacularly so — it would have sent somebody chasing 151 phantom bugs
// through the core of the product.
//
// `hasPermission` does NOT require the granular key to be in the catalog. A granular `pos.<domain>.<action>` key is
// mapped by `requiredCapability()` to a COARSE capability — `pos.ai_analytics.view` → `ai_analytics.view` — and it
// is the COARSE key that must exist. An owner's token carries every coarse capability, which is why no OWNER
// shortcut is needed.
//
// So the real question is not "is this string in the list". It is: **does it resolve to something in the list.**
const sec = codeLines(readFileSync(join(PKG, 'security-core.ts'), 'utf8'));

const mapOf = (name) => {
  const mm = new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\}`).exec(sec);
  const out = new Map();
  if (mm) for (const e of mm[1].matchAll(/["']?([A-Za-z0-9_.]+)["']?\s*:\s*["']([^"']+)["']/g)) out.set(e[1], e[2]);
  if (!out.size && name !== 'COARSE_DOMAIN') {
    // Refuse to run blind. If the rulebook cannot be read, saying OK is a lie.
    console.error(`Could not parse ${name} from security-core.ts — refusing to report on rules I cannot see.`);
    process.exit(2);
  }
  return out;
};
const setOf = (name) => {
  const mm = new RegExp(`const ${name}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]`).exec(sec);
  // BOTH quote styles. `VIEW_ACTIONS = new Set(["view", "export", ...])` uses double quotes, and my first version
  // only matched single — so VIEW_ACTIONS came out EMPTY, every action fell to the MANAGE branch, and five
  // perfectly good routes were reported as denying everyone. A checker that mis-parses the rulebook produces
  // confident nonsense about the code that follows it.
  return new Set(mm ? [...mm[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []);
};

const COARSE_DOMAIN = mapOf('COARSE_DOMAIN');
const VIEW_CAP = mapOf('VIEW_CAP');
const MANAGE_CAP = mapOf('MANAGE_CAP');
const VIEW_ACTIONS = setOf('VIEW_ACTIONS');

// The guard's explicit (domain, action) → capability exceptions, read from the same source — e.g. pos.deals.apply →
// deals.apply (BUILD_PLAN Phase 5). Without these the checker resolved such a key by the generic rule and reported a
// route the guard really does open as denying everyone (or, worse, the reverse).
const EXCEPTIONS = new Map();
for (const e of sec.matchAll(/if \(rawDomain === "([\w]+)" && action === "([\w.]+)"\) return "([\w.]+)"/g)) EXCEPTIONS.set(`${e[1]}.${e[2]}`, e[3]);
for (const e of sec.matchAll(/if \(rawDomain === "([\w]+)" && \[([^\]]+)\]\.includes\(action\)\)\s*\{?\s*return "([\w.]+)"/g))
  for (const a of e[2].matchAll(/"([\w.]+)"/g)) EXCEPTIONS.set(`${e[1]}.${a[1]}`, e[3]);
for (const e of sec.matchAll(/if \(rawDomain === "([\w]+)" && \(([^)]*)\)\) return "([\w.]+)"/g))
  for (const a of e[2].matchAll(/action === "([\w.]+)"/g)) EXCEPTIONS.set(`${e[1]}.${a[1]}`, e[3]);

function requiredCapability(key) {
  if (!key.startsWith('pos.')) return key;
  const rest = key.slice(4);
  const dot = rest.indexOf('.');
  if (dot < 0) return key;
  const rawDomain = rest.slice(0, dot);
  const action = rest.slice(dot + 1);
  if (EXCEPTIONS.has(`${rawDomain}.${action}`)) return EXCEPTIONS.get(`${rawDomain}.${action}`);
  const domain = COARSE_DOMAIN.get(rawDomain) ?? rawDomain;
  if (VIEW_ACTIONS.has(action)) {
    if (rawDomain === 'reports' && action === 'export') return 'reports.export';
    return VIEW_CAP.get(domain) ?? domain + '.view';
  }
  return MANAGE_CAP.get(domain) ?? domain + '.manage';
}

// A key is fine if it is in the catalog directly, OR resolves to a coarse capability that is.
const unknown = [...used.entries()].filter(([k]) => !catalog.has(k) && !catalog.has(requiredCapability(k)));

// ── BUILD_PLAN Phase 9: SERVICE-level keys ──────────────────────────────────────────────────────────────
//
// The same failure, one layer down. A service that says `if (!hasPermission(ctx, 'compensation.manage')) throw` — or
// `perms.includes('ai.control.manage')`, or `this.need(ctx, 'pos.pricing.override')` — refuses every role on earth when
// the key is in no catalog: five such keys sat in services for months (Constitution 2 audit, bug 6), each one a feature
// that only the OWNER shortcut next to it kept alive. Every literal key handed to a permission helper in a service,
// repository or guard must resolve exactly like a route key. (tooling/permissions/scan-permission-keys.mjs says which
// call shapes count; the technician-override vocabulary `pos.tech.*` is its own closed list and is not checked here.)
const { scanKeyUsages } = await import(new URL('../../../tooling/permissions/scan-permission-keys.mjs', import.meta.url).href);
const usage = scanKeyUsages(join(SRC, '..', '..', '..'));
const unknownService = [...usage.service.entries()].filter(([k]) => !catalog.has(k) && !catalog.has(requiredCapability(k)));
const resolved = new Set([...used.keys()].map(requiredCapability));
const unused = [...catalog].filter((k) => !used.has(k) && !resolved.has(k));

// ── the SECOND failure mode, and the dangerous one ──────────────────────────────────────────────────────
//
// `requiredCapability()` NEVER fails. Any action it does not recognise falls through to the MANAGE branch:
//
//     pos.reports.view   →  reports.view      (correct — a read-only screen)
//     pos.reports.veiw   →  reports.MANAGE    (a typo — and now the screen demands MANAGE)
//
// So a typo in a VIEW action does not deny everyone and does not error. It **silently upgrades the requirement
// from view to manage** — and every read-only user who could legitimately see that screen is locked out of it,
// with a "Missing permission" they cannot fix by any grant short of full manage.
//
// That is worse than the domain typo, because the domain typo at least fails for EVERYONE and gets noticed on the
// first click. This one fails only for the people with the least power to report it.
// `show` is NOT in this list, deliberately. It matched `no_show` — marking an appointment as a no-show, which is a
// WRITE, and `booking.manage` is exactly the right requirement for it. My first version flagged both no-show routes
// as "read actions locked out of their own screen", which is nonsense: they are not read actions at all.
//
// A checker that cannot tell `no_show` from `show` will produce confident nonsense, and the person reading it will
// stop reading it.
const VIEWISH = /(^|_)(view|read|list|browse)s?$/i;
const suspiciousViews = [...used.entries()].filter(([k]) => {
  if (!k.startsWith('pos.')) return false;
  const rest = k.slice(4);
  const dot = rest.indexOf('.');
  if (dot < 0) return false;
  const action = rest.slice(dot + 1);
  // Looks like a read action, but is NOT one the resolver recognises → it silently becomes `.manage`.
  return VIEWISH.test(action) && !VIEW_ACTIONS.has(action);
});

console.log(`permissions in catalog: ${catalog.size}`);
console.log(`permissions used on routes: ${used.size}`);
console.log(`permission keys checked in services: ${usage.service.size}`);

if (unknownService.length) {
  console.log(`\n${'='.repeat(96)}`);
  console.log(`UNKNOWN SERVICE-LEVEL PERMISSIONS: ${unknownService.length} — these checks DENY EVERYONE, including the owner`);
  console.log('='.repeat(96));
  for (const [k, files] of unknownService) {
    console.log(`\n  '${k}'  — not in the catalog (and no catalog capability it maps to)`);
    for (const f of files) console.log(`     ${f}`);
  }
  console.log('\nRegister the key in packages/permissions/src/rbac.ts with the grants the check means, or use the catalog key it should be.');
  process.exit(1);
}

if (unknown.length) {
  console.log(`\n${'='.repeat(96)}`);
  console.log(`UNKNOWN PERMISSIONS: ${unknown.length} — these routes DENY EVERYONE, including the owner`);
  console.log('='.repeat(96));
  for (const [k, files] of unknown) {
    console.log(`\n  '${k}'  — not in the catalog`);
    for (const f of [...new Set(files)]) console.log(`     ${f}`);
  }
  console.log('\nhasPermission() matches nothing for a key that is not in ROLE_PERMISSIONS — for EVERY role.');
  console.log('The feature is built, wired and reachable, and no role on earth can open it.');
  process.exit(1);
}

if (suspiciousViews.length) {
  console.log(`\n${'='.repeat(96)}`);
  console.log(`READ ACTIONS THAT SILENTLY DEMAND MANAGE: ${suspiciousViews.length}`);
  console.log('='.repeat(96));
  for (const [k, files] of suspiciousViews) {
    console.log(`\n  '${k}'  → resolves to ${requiredCapability(k)}`);
    console.log(`     It LOOKS like a read action, but is not in VIEW_ACTIONS, so it falls through to MANAGE.`);
    console.log(`     Every read-only user is locked out of this screen.`);
    for (const f of [...new Set(files)]) console.log(`     ${f}`);
  }
  process.exit(1);
}

// Not a failure — dead catalog entries are clutter in a salon owner's role editor, not a broken route. Reported so
// somebody can decide, not so a build can fail on it.
if (unused.length) {
  console.log(`\n  NOTE — ${unused.length} permission(s) in the catalog that no route uses:`);
  for (const k of unused.slice(0, 12)) console.log(`     ${k}`);
  if (unused.length > 12) console.log(`     … and ${unused.length - 12} more`);
  console.log('  (clutter in the role editor a salon owner has to reason about — not a broken route)');
}

console.log('\nOK — every @RequirePermission and every service-level permission key exists in the catalog.');
process.exit(0);
