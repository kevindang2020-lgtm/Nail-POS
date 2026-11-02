// AdminLayout.wiring.test.ts — locks the Super Admin sidebar ↔ route wiring model (codebase-audit pass 2026-07-09).
// The tenant POS side has tenant-nav.wiring.test.ts; this is its Super Admin counterpart. It fails if any nav item
// (or child) points at a path that no <Route> in App.tsx can render — the "dead sidebar link" failure mode — or if
// a nav destination is duplicated. It reads App.tsx via fs (same approach as the tenant test) so it stays honest
// about what the router actually registers rather than a hand-maintained list.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV_GROUPS } from './AdminLayout';

// vitest cwd = apps/admin-web. Collect every registered route path (element routes AND <Navigate> redirects both
// count as "the router can render this path"). App.tsx nests all sections under <Route path="/"> with RELATIVE
// child paths, so normalise each to an absolute '/'-prefixed path for comparison with the nav's absolute `to`.
const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const routePaths = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== '/' && p !== '*')
  .map((p) => '/' + p.replace(/^\//, ''));

// Every nav destination: top-level items + their children. `to` keeps its query string for resolution/uniqueness
// (so "/staff?role=manager" and "/staff?role=technician" are correctly distinct deep links); a separate `path`
// strips the query for route resolution. `label` is the full breadcrumb so identical repeated entries are catchable.
function navDestinations(): { label: string; to: string; path: string }[] {
  const out: { label: string; to: string; path: string }[] = [];
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (!it.disabled) out.push({ label: it.label, to: it.to, path: it.to.split('?')[0] });
      for (const c of it.children ?? []) out.push({ label: `${it.label} > ${c.label}`, to: c.to, path: c.to.split('?')[0] });
    }
  }
  return out;
}

// A nav path resolves if some route matches it segment-for-segment, where a route segment beginning ':' (a param,
// e.g. customer-data-oversight/:view) matches any single nav segment. This is exactly how react-router resolves
// deep links like /customer-data-oversight/consent-status against a ":view" catch-all.
function resolves(navPath: string): boolean {
  const nav = navPath.split('/').filter(Boolean);
  return routePaths.some((rp) => {
    const seg = rp.split('/').filter(Boolean);
    if (seg.length !== nav.length) return false;
    return seg.every((s, i) => s.startsWith(':') || s === nav[i]);
  });
}

describe('Super Admin sidebar ↔ route wiring invariants', () => {
  it('every nav item and child points at a route App.tsx can render (no dead links)', () => {
    const dead = navDestinations().filter((d) => !resolves(d.path)).map((d) => `${d.label} -> ${d.to}`);
    expect(dead).toEqual([]);
  });

  // A parent header and its "Overview/All" first child legitimately share a section-root path, and query-param
  // deep links (/staff?role=manager vs /staff?role=technician) are distinct on purpose. A true duplicate is the
  // SAME (label, to) pair appearing twice — a copy-paste error. That is what this guards against.
  it('no identical (label, to) sidebar entry appears twice (no accidental duplicate items)', () => {
    const keys = navDestinations().map((d) => `${d.label}|${d.to}`);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    expect(dupes).toEqual([]);
  });

  it('App.tsx registers no duplicate route path (no double-registration)', () => {
    const dupes = [...new Set(routePaths.filter((p, i) => routePaths.indexOf(p) !== i))];
    expect(dupes).toEqual([]);
  });

  it('every nav destination is an absolute path', () => {
    const relative = navDestinations().filter((d) => !d.to.startsWith('/')).map((d) => d.label);
    expect(relative).toEqual([]);
  });
});
