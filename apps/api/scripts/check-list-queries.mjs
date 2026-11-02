#!/usr/bin/env node
// check-list-queries.mjs — check:list-queries (BUILD_PLAN Phase 12, Constitution 5 §47–§52, DoD #21 / #22 / #23).
//
// Every list handler — a registered GET that reads query parameters (scripts/lib/list-handlers.mjs) — declares a
// ListQuerySpec (`@ListQuery(spec)` on the method or `@ListQueries({ handler: spec })` on the controller), so its filters,
// sorts, search, page size and date-range cap are allow-listed and validated by the one parser (parseListQuery in
// @aipowersalon/database, run by the global ListQueryInterceptor). The only exceptions are in
// scripts/list-queries.allowlist.json, each with a kind and a reason: `not-a-list` (one resource whose query string
// carries a token or a protocol parameter, never a filter) or `fixed-size` (an enum / settings list). The allowlist
// only shrinks: an entry for a handler that now declares a spec, or that no longer exists, fails.
//
// For each declared handler whose reads the analyzer can see, this also fails when:
//   - the handler reads a query parameter the spec does not declare (a filter / sort / search / limit / range name or
//     `params`) — the allow-list must be the handler's real surface;
//   - the handler reads a from + to pair (or a look-back `days`) and the spec has no dateRange (every ranged query gets
//     a maxDays) or the bounds are declared as plain filters instead of the range;
//   - the spec names sort parameters but allows no sort field;
//   - the spec cannot be evaluated statically (it must be literals, same-file / relatively imported consts and spreads).
//
//   node scripts/check-list-queries.mjs            check (exit 1 on any failure) and print coverage
//   node scripts/check-list-queries.mjs --json     the per-handler table (for the reports)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listHandlers, acceptedNames, API } from './lib/list-handlers.mjs';

export const ALLOWLIST_FILE = join(API, 'scripts', 'list-queries.allowlist.json');
const FROM = ['from', 'dateFrom', 'startDate', 'fromDate'];
const TO = ['to', 'dateTo', 'endDate', 'toDate'];
const DAYS = ['days', 'rangeDays', 'sinceDays', 'lookbackDays', 'windowDays'];
const KINDS = new Set(['not-a-list', 'fixed-size']);

export function loadAllowlist(file = ALLOWLIST_FILE) {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')).entries ?? {};
}

/** Pure: the failures for a set of analysed handlers against an allowlist. */
export function evaluate(handlers, allow) {
  const failures = []; const seen = new Set();
  let adopted = 0, allowlisted = 0, opaque = 0;
  for (const h of handlers) {
    seen.add(h.key);
    const a = allow[h.key];
    if (a) {
      if (!KINDS.has(a.kind) || !String(a.reason || '').trim()) failures.push(`${h.key}: allowlist entry needs a kind (${[...KINDS].join(' | ')}) and a reason`);
      if (h.decl.declared) failures.push(`${h.key}: declares a spec AND is allowlisted — remove the allowlist entry (it only shrinks)`);
      allowlisted++; continue;
    }
    if (h.decl.unresolved) { failures.push(`${h.key} (${h.path}): its ListQuerySpec cannot be evaluated statically — use literals, consts and spreads`); continue; }
    if (!h.decl.declared) { failures.push(`${h.key} (GET ${h.path}): a list handler with no ListQuerySpec — declare @ListQuery / @ListQueries (or allowlist it with a reason)`); continue; }
    adopted++;
    const spec = h.decl.spec || {};
    if (Array.isArray(spec.sortParams) && spec.sortParams.length && !Object.keys(spec.sorts || {}).length) failures.push(`${h.key}: names sort parameters but allows no sort field`);
    if (h.reads.opaque) { opaque++; continue; }
    const ok = acceptedNames(spec);
    const missing = [...h.reads.names].filter((n) => !ok.has(n));
    if (missing.length) failures.push(`${h.key} (GET ${h.path}): reads ${missing.map((m) => '?' + m).join(', ')} but its spec does not declare ${missing.length > 1 ? 'them' : 'it'}`);
    const reads = [...h.reads.names];
    const pair = reads.some((n) => FROM.includes(n)) && reads.some((n) => TO.includes(n));
    const lookback = reads.some((n) => DAYS.includes(n) && !(spec.filters && n in spec.filters));
    const ranged = pair || lookback;
    if (ranged) {
      const dr = spec.dateRange;
      if (!dr || !(typeof dr.maxDays === 'number' || typeof dr.maxDays === 'string')) failures.push(`${h.key} (GET ${h.path}): a ranged query with no dateRange.maxDays`);
      else {
        const rangeNames = new Set(['from', 'to', ...(dr.from ?? []), ...(dr.to ?? []), ...(dr.days ?? [])]);
        const asFilters = reads.filter((n) => (FROM.includes(n) || TO.includes(n)) && !rangeNames.has(n));
        if (asFilters.length) failures.push(`${h.key}: ${asFilters.join(', ')} ${asFilters.length > 1 ? 'are' : 'is'} a range bound but not declared in dateRange`);
      }
    }
  }
  for (const k of Object.keys(allow)) if (!seen.has(k)) failures.push(`${k}: allowlisted but no such list handler — remove the entry (it only shrinks)`);
  return { failures, adopted, allowlisted, opaque, total: handlers.length };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const handlers = listHandlers();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(handlers.map((h) => ({ key: h.key, path: h.path, reads: [...h.reads.names], opaque: h.reads.opaque, declared: h.decl.declared, how: h.decl.how })), null, 1));
    process.exit(0);
  }
  const r = evaluate(handlers, loadAllowlist());
  for (const f of r.failures) console.log('FAIL ' + f);
  console.log(`check:list-queries — ${r.adopted}/${r.total} list handlers declare a ListQuerySpec (${r.opaque} of them hand the query on where the analyzer cannot follow — reviewed by hand), ${r.allowlisted} allowlisted (not a list / fixed size); ${r.failures.length} failure(s)`);
  process.exit(r.failures.length ? 1 : 0);
}
