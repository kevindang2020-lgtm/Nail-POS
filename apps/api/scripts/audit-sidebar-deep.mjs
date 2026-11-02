// audit-sidebar-deep.mjs — nav item → route → COMPONENT → API call → backend module.
//
// ══ WHY `check:nav` IS NOT ENOUGH ═════════════════════════════════════════════════════════════════════════
//
// `check:nav` proves a nav item's route is HANDLED. It does not prove the thing behind it is REAL.
//
// A route can be handled by:
//   • a placeholder     <Route path="x" element={<div>Coming soon</div>} />
//   • a stub screen     export function XScreen() { return null; }
//   • a screen that calls an API that does not exist
//
// All three pass `check:nav`. All three are a sidebar item that does nothing when a salon owner clicks it — and
// they will conclude the product is broken, not that one screen is.
//
// So this walks the whole chain:
//
//     nav label → route → element component → the file that defines it → is it substantial? → what does it call?
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APPS = resolve(new URL('../../', import.meta.url).pathname);

const strip = (s) =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function walk(d, acc = []) {
  if (!existsSync(d)) return acc;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(p) && !/\.(test|spec)\./.test(p)) acc.push(p);
  }
  return acc;
}

// ── the backend route table: ONE source of truth ────────────────────────────────────────────────────────
const { routes } = await import('./audit-routes.js').then((m) => m.default ?? m);
const backend = routes.map((r) => ({ method: r.method, seg: r.norm.split('/').filter(Boolean) }));

function backendHas(method, path) {
  const seg = path.split('?')[0].split('/').filter(Boolean);
  return backend.some((r) => {
    if (r.method !== method || r.seg.length !== seg.length) return false;
    return r.seg.every((s, i) => s.startsWith(':') || s === seg[i] || (seg[i] && seg[i].startsWith(':')));
  });
}

const report = [];

for (const app of ['pos-web', 'admin-web']) {
  const src = join(APPS, app, 'src');
  const appTsx = strip(read(join(src, 'App.tsx')));

  // ── nav: label → route ──
  const nav = [];
  const shell = join(src, 'shell');
  if (existsSync(shell)) {
    for (const f of readdirSync(shell)) {
      if (!/\.tsx?$/.test(f) || /test|spec/.test(f)) continue;
      const t = strip(read(join(shell, f)));
      // { id: 'x', label: 'Y', route: '/z' }   and   { to: '/z', label: 'Y' }
      for (const m of t.matchAll(/label:\s*'([^']+)'[^}]*?route:\s*'([^']+)'/g)) nav.push({ label: m[1], route: m[2] });
      for (const m of t.matchAll(/route:\s*'([^']+)'[^}]*?label:\s*'([^']+)'/g)) nav.push({ label: m[2], route: m[1] });
      for (const m of t.matchAll(/to:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g)) nav.push({ label: m[2], route: m[1] });
      for (const m of t.matchAll(/label:\s*'([^']+)'\s*,\s*to:\s*'([^']+)'/g)) nav.push({ label: m[1], route: m[2] });
    }
  }

  // ── route → element component ──
  const routeToEl = new Map();
  const redirects = new Map();
  for (const m of appTsx.matchAll(/<Route\s+path=["']([^"']+)["']\s+element=\{<\s*([A-Za-z0-9_]+)([^>]*)/g)) {
    const path = m[1].replace(/^\/+/, '');
    const el = m[2];
    if (el === 'Navigate') {
      // A REDIRECT is a legitimate route. `<Route path="x" element={<Navigate to="/y" />} />` is how a sidebar item
      // points at a screen that lives elsewhere — my first version called all seven of them "COMPONENT NOT FOUND".
      const to = /to=["']([^"']+)["']/.exec(m[3]);
      // STRIP THE QUERY STRING. These redirect to `/settings?section=business-branch` — the route is `settings`;
      // the section is read by the screen. My first version looked for a route literally called
      // `settings?section=business-branch`, found none, and reported ELEVEN working sidebar items as dead.
      if (to) redirects.set(path, to[1].split('?')[0].replace(/^\/+/, ''));
      continue;
    }
    routeToEl.set(path, el);
  }
  // Resolve redirects to their target's component.
  for (const [from, to] of redirects) {
    let el = routeToEl.get(to);
    if (!el) for (const [p, c] of routeToEl) if (p && (to === p || to.startsWith(p + '/'))) { el = c; break; }
    if (el) routeToEl.set(from, el);
  }

  // ── component → file ──
  const files = walk(src);
  const compFile = new Map();
  for (const f of files) {
    const t = read(f);
    for (const m of t.matchAll(/export\s+(?:default\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)) {
      if (!compFile.has(m[1])) compFile.set(m[1], f);
    }
  }

  const seen = new Set();
  for (const item of nav) {
    const key = item.route;
    if (seen.has(key)) continue;
    seen.add(key);

    const norm = item.route.split('?')[0].replace(/^\/+/, '');
    // find the route (exact, or a parent that owns it)
    let el = routeToEl.get(norm);
    if (!el) {
      for (const [p, c] of routeToEl) {
        if (p && (norm === p || norm.startsWith(p + '/'))) { el = c; break; }
      }
    }

    if (!el) { report.push({ app, ...item, problem: 'NO ROUTE' }); continue; }

    const file = compFile.get(el);
    if (!file) { report.push({ app, ...item, el, problem: 'COMPONENT NOT FOUND' }); continue; }

    const body = read(file);

    // ── is it REAL, or a placeholder? ──
    //
    // A "Coming soon" div, or a component under ~15 lines with no API call and no state, is a route that renders
    // nothing a salon can use. It passes check:nav. It is still a dead sidebar item.
    // A real screen is FULL of `placeholder="Search…"` on its input fields. My first version matched the word
    // `placeholder` anywhere and declared 83 working screens — Checkout, Serving, Customer Directory — to be
    // stubs. That is a checker crying wolf on the core of the product, which is how a checker gets switched off.
    //
    // What a genuine placeholder screen looks like is TEXT SHOWN TO THE USER, not an input attribute:
    // A placeholder is a SMALL file that says so. A 1,149-line Booking screen with `title="Week view is coming
    // soon"` on a DISABLED sub-feature button is not a placeholder — it is a working screen being honest about one
    // view it does not have yet. My first version flagged both of those as stubs.
    //
    // The size gate is what separates "this screen is a stub" from "this screen has a disabled button".
    const lines = body.split('\n').length;
    const placeholder = lines < 80 && /coming soon|not implemented|under construction|todo:\s*build/i.test(body);
    const callsApi = /\b(?:api|Api)\s*\.\s*(?:get|post|patch|put|delete)|Api\.\w+\(/.test(body);
    const hasState = /useState|useEffect|useQuery/.test(body);

    if (placeholder) { report.push({ app, ...item, el, problem: 'PLACEHOLDER' }); continue; }
    if (lines < 15 && !callsApi && !hasState) { report.push({ app, ...item, el, problem: `STUB (${lines} lines, no API, no state)` }); continue; }

    // ── the API calls it makes must EXIST ──
    const bad = [];
    for (const m of body.matchAll(/\.\s*(get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'"])/g)) {
      const method = m[1].toUpperCase();
      const quote = m[2];
      const start = m.index + m[0].length;
      let lit = '';
      let i = start;
      let valid = true;
      for (; i < body.length; i++) {
        const c = body[i];
        if (c === quote) break;
        if (quote === '`' && c === '$' && body[i + 1] === '{') {
          let k = i + 2, d = 1;
          for (; k < body.length && d > 0; k++) {
            if (body[k] === '{') d++;
            else if (body[k] === '}') { d--; if (!d) break; }
          }
          lit += ':param';
          i = k;
          continue;
        }
        if (c === '\n' && quote !== '`') { valid = false; break; }
        lit += c;
      }
      if (!valid) continue;
      const p = lit.trim();
      if (!p.startsWith('/')) continue;
      if (!backendHas(method, p)) bad.push(`${method} ${p}`);
    }
    if (bad.length) report.push({ app, ...item, el, problem: `API 404: ${bad.slice(0, 2).join(', ')}` });
  }
}

console.log('DEEP SIDEBAR TRACE — nav label → route → component → API → backend\n');

const byApp = {};
for (const r of report) (byApp[r.app] ||= []).push(r);

for (const app of ['pos-web', 'admin-web']) {
  const bad = byApp[app] ?? [];
  console.log(`  ${app.padEnd(11)} ${bad.length === 0 ? 'OK — every sidebar item renders a real screen backed by real routes' : `${bad.length} PROBLEM(S)`}`);
  for (const b of bad) {
    console.log(`     "${b.label}"  →  ${b.route}`);
    console.log(`        ${b.el ? b.el + ' — ' : ''}${b.problem}`);
  }
}

console.log(`\n${report.length === 0 ? 'OK — every backend sidebar item is wired end to end.' : `${report.length} sidebar item(s) do not fully work.`}`);
process.exit(report.length ? 1 : 0);
