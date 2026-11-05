// audit-sidebars.mjs — every nav item in every app must reach a real screen.
//
// ══ THE BUG THIS CATCHES ══════════════════════════════════════════════════════════════════════════════════
//
// A sidebar entry whose route nothing handles is a dead link: the user clicks it and gets a blank page, or the
// router's fallback, and quietly concludes the feature does not work. It is the front-end twin of the bug that has
// dominated this codebase — **built, tested, never wired.**
//
// It cannot be caught by `tsc` (the route is a string) and it cannot be caught by a unit test (the nav and the
// router are tested separately, and both pass).
//
// The five apps route three different ways, so this handles all three rather than pretending they are the same:
//
//   pos-web · admin-web · customer-web   → react-router  <Route path="..." />
//   owner-web · tech-web                 → tab routers   (tab === 'x')
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Path-independent: resolve the apps dir relative to THIS file, so it works in CI and on any checkout.
const APPS = resolve(new URL('../../', import.meta.url).pathname);

const codeLines = (s) =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

function read(p) { return existsSync(p) ? codeLines(readFileSync(p, 'utf8')) : ''; }

/**
 * Where a nav actually lives differs per app, and my first version only looked in `shell/*nav*`.
 *
 * It therefore found 0-6 nav items in four of the five apps and cheerfully reported "OK" — a checker that is not
 * looking, reporting green. That is the same failure I called out in `check:di` earlier today, and I nearly shipped
 * it twice.
 *
 * So: read the WHOLE shell directory (Layouts hold the nav in owner/customer/admin) plus App.tsx.
 */
function findNav(app) {
  const shell = join(APPS, app, 'src/shell');
  let src = '';
  if (existsSync(shell)) {
    for (const f of readdirSync(shell)) {
      if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
      if (/test|spec/.test(f)) continue;
      src += '\n' + read(join(shell, f));
    }
  }
  return src;
}

const results = [];

for (const app of ['pos-web', 'owner-web', 'admin-web', 'customer-web', 'tech-web', 'manager-pay-web']) {
  const appTsx = read(join(APPS, app, 'src/App.tsx'));
  const nav = findNav(app) || appTsx;

  // ── what the NAV offers ──
  //   route: '/x'      (pos-web, owner-web style)
  //   to="/x"          (link style)
  //   tab: 'x'         (tab routers)
  const navRoutes = new Set();
  for (const m of nav.matchAll(/route:\s*'([^']+)'/g)) navRoutes.add(m[1]);
  for (const m of nav.matchAll(/to=["']([^"']+)["']/g)) navRoutes.add(m[1]);
  // `{ to: '/x', label: '...' }` — how admin-web, customer-web and owner-web declare their nav ARRAYS. My first
  // version only matched the JSX attribute `to="..."`, so it found ONE item across three apps and reported OK.
  for (const m of nav.matchAll(/\bto:\s*['"]([^'"]+)['"]/g)) navRoutes.add(m[1]);
  const navTabs = new Set();
  for (const m of nav.matchAll(/\btab:\s*'([^']+)'/g)) navTabs.add(m[1]);
  // The tab-router apps declare their tabs as a TYPE UNION:
  //     export type TechTab = 'home' | 'schedule' | 'tickets' | 'earnings' | 'more';
  // That IS the nav contract — every member must be handled, or a tab is a blank screen.
  for (const m of nav.matchAll(/export type \w*Tab\s*=\s*([^;]+);/g)) {
    for (const v of m[1].matchAll(/'([^']+)'/g)) navTabs.add(v[1]);
  }

  // ── what the ROUTER handles ──
  const routerPaths = new Set();
  for (const m of appTsx.matchAll(/<Route\s+path=["']([^"']+)["']/g)) routerPaths.add(m[1]);
  const routerTabs = new Set();
  for (const m of appTsx.matchAll(/tab\s*===\s*'([^']+)'/g)) routerTabs.add(m[1]);
  for (const m of appTsx.matchAll(/case\s+'([^']+)'/g)) routerTabs.add(m[1]);

  const usesTabs = routerTabs.size > routerPaths.size;

  // Does the tab router have a DEFAULT branch?
  //
  //     else if (tab === 'earnings') screen = <TechEarningsScreen />;
  //     else screen = <MoreScreen />;                                  ← this handles everything else
  //
  // My first version only looked for an explicit `tab === 'more'` and declared the More tab DEAD. It is not — it is
  // handled by the fallthrough, which is a perfectly ordinary way to write a router.
  //
  // That is the THIRD time one of my own checkers has cried wolf on correct code today, and it is the failure that
  // matters most: a checker people learn to ignore is how the real findings get through with the noise.
  const hasDefault = /\belse\s+screen\s*=/.test(appTsx) || /\bdefault\s*:/.test(appTsx);

  const dead = [];

  if (!usesTabs) {
    // A nav route is satisfied if the router declares it, allowing for a leading slash and a nested-route prefix.
    const norm = (p) => p.replace(/^\/+/, '').replace(/\/+$/, '');
    const handled = new Set([...routerPaths].map(norm));
    for (const r of navRoutes) {
      if (r.startsWith('http') || r === '#' || r === '') continue;
      // Strip the QUERY STRING. `/tenant/inventory?tab=alerts` is the SAME route as `/tenant/inventory` — the tab
      // is read by the screen, not the router. Flagging those is crying wolf on correct code.
      const n = norm(r.split('?')[0]);
      if (!n) continue;
      // Exact, or the router declares a parent that renders an index/child for it.
      const ok = handled.has(n) || [...handled].some((h) => h && (n === h || n.startsWith(h + '/')));
      if (!ok) dead.push(r);
    }
  } else {
    for (const t of navTabs) {
      // A default branch catches every tab the router does not name explicitly.
      if (!routerTabs.has(t) && !hasDefault) dead.push(`tab:${t}`);
    }
  }

  results.push({
    app,
    style: usesTabs ? 'tab router' : 'react-router',
    navItems: usesTabs ? navTabs.size : navRoutes.size,
    handled: usesTabs ? routerTabs.size : routerPaths.size,
    dead,
  });
}

console.log('SIDEBAR / NAV WIRING — every nav item must reach a real screen\n');

let total = 0;
for (const r of results) {
  const status = r.dead.length ? `${r.dead.length} DEAD` : 'OK';
  console.log(`  ${r.app.padEnd(13)} ${r.style.padEnd(13)} nav:${String(r.navItems).padStart(3)}  routes:${String(r.handled).padStart(4)}   ${status}`);
  for (const d of r.dead) console.log(`       DEAD → ${d}`);
  total += r.dead.length;
}

console.log(`\n${total === 0 ? 'OK — every nav item in every app reaches a real screen.' : `${total} DEAD NAV ITEMS — these are blank pages a user can click.`}`);
process.exit(total ? 1 : 0);
