// list-queries-gate.vitest.spec.ts — BUILD_PLAN Phase 12: check:list-queries (scripts/check-list-queries.mjs) itself.
// Synthetic handlers prove each rule fails when it should; the real run proves every list handler in the tree passes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const API = join(__dirname, '..', '..', '..');
const load = () => import(join(API, 'scripts', 'check-list-queries.mjs'));
const h = (key: string, names: string[], decl: any, opaque = false) => ({ key, path: '/x', reads: { names: new Set(names), opaque, readsQuery: true }, decl });
const declared = (spec: any) => ({ declared: true, spec, how: 'class' });

describe('check:list-queries', () => {
  it('passes a handler whose spec declares everything it reads', async () => {
    const { evaluate } = await load();
    const r = evaluate([h('a', ['status', 'search', 'page', 'pageSize', 'dateFrom', 'dateTo'], declared({ filters: { status: { type: 'text' } }, search: { params: ['search'] }, params: ['page'], limitParams: ['pageSize'], dateRange: { maxDays: 90, from: ['dateFrom'], to: ['dateTo'] } }))], {});
    expect(r.failures).toEqual([]); expect(r.adopted).toBe(1);
  });
  it('fails a list handler with no spec', async () => {
    const { evaluate } = await load();
    expect(evaluate([h('a', ['status'], { declared: false })], {}).failures[0]).toMatch(/no ListQuerySpec/);
  });
  it('fails a read the spec does not declare', async () => {
    const { evaluate } = await load();
    expect(evaluate([h('a', ['status', 'secretColumn'], declared({ filters: { status: { type: 'text' } } }))], {}).failures[0]).toMatch(/\?secretColumn/);
  });
  it('fails a ranged query with no maxDays, and range bounds declared as filters', async () => {
    const { evaluate } = await load();
    expect(evaluate([h('a', ['from', 'to'], declared({}))], {}).failures[0]).toMatch(/no dateRange\.maxDays/);
    expect(evaluate([h('a', ['days'], declared({}))], {}).failures.join('\n')).toMatch(/no dateRange\.maxDays/);
    expect(evaluate([h('a', ['startDate', 'endDate'], declared({ filters: { startDate: { type: 'date' }, endDate: { type: 'date' } }, dateRange: { maxDays: 31 } }))], {}).failures[0]).toMatch(/not declared in dateRange/);
  });
  it('fails sort parameters with no sortable field, and an unevaluable spec', async () => {
    const { evaluate } = await load();
    expect(evaluate([h('a', ['sort'], declared({ sortParams: ['sort'], sorts: {} }))], {}).failures[0]).toMatch(/allows no sort field/);
    expect(evaluate([h('a', [], { declared: true, unresolved: true })], {}).failures[0]).toMatch(/cannot be evaluated/);
  });
  it('the allowlist needs a kind and reason, and only shrinks', async () => {
    const { evaluate } = await load();
    expect(evaluate([h('a', ['token'], { declared: false })], { a: { kind: 'not-a-list', reason: 'one resource' } }).failures).toEqual([]);
    expect(evaluate([h('a', ['token'], { declared: false })], { a: { kind: 'whatever', reason: '' } }).failures[0]).toMatch(/needs a kind/);
    expect(evaluate([h('a', [], declared({}))], { a: { kind: 'not-a-list', reason: 'x' } }).failures[0]).toMatch(/AND is allowlisted/);
    expect(evaluate([], { gone: { kind: 'not-a-list', reason: 'x' } }).failures[0]).toMatch(/no such list handler/);
  });
  it('an opaque handler (the query escapes the analyzer) still needs a spec, but its reads are not compared', async () => {
    const { evaluate } = await load();
    const r = evaluate([h('a', ['anything'], declared({}), true)], {});
    expect(r.failures).toEqual([]); expect(r.opaque).toBe(1);
  });
  it('the real tree passes', () => {
    const r = spawnSync('node', ['scripts/check-list-queries.mjs'], { cwd: API, encoding: 'utf8', timeout: 120_000 });
    expect(r.stdout).toMatch(/check:list-queries — \d+\/\d+ list handlers declare a ListQuerySpec/);
    expect(r.status, r.stdout.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 10).join('\n')).toBe(0);
  }, 120_000);
});
