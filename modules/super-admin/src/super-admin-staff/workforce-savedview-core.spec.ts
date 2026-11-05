import { normalizeViewFilters, validateSavedView, parseViewFilters, SAVED_VIEW_MAX_NAME } from './workforce-savedview-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// normalization: whitelist + coerce + drop unknowns/empties
eq(normalizeViewFilters({ role: 'technician', status: '', junk: 'x', dir: 'desc', pageSize: 25 }), { role: 'technician', dir: 'desc', pageSize: 25 }, 'whitelist + drop empty/unknown');
eq(normalizeViewFilters({ dir: 'sideways' }), { dir: 'asc' }, 'invalid dir → asc');
eq(normalizeViewFilters({ pageSize: 999 }), {}, 'invalid pageSize dropped');
eq(normalizeViewFilters({ search: '  ann  ' }), { search: 'ann' }, 'search trimmed');
eq(normalizeViewFilters(null), {}, 'null → empty');
eq(normalizeViewFilters('nope'), {}, 'non-object → empty');

// validation
ok(!validateSavedView({ filters: {} }).ok, 'missing name rejected');
ok(!validateSavedView({ name: '   ' }).ok, 'blank name rejected');
ok(!validateSavedView({ name: 'x'.repeat(SAVED_VIEW_MAX_NAME + 1) }).ok, 'over-long name rejected');
{ const v = validateSavedView({ name: '  Active techs  ', filters: { role: 'technician', junk: 1 }, isDefault: true });
  ok(v.ok, 'valid view accepted'); if (v.ok) { eq(v.name, 'Active techs', 'name trimmed'); eq(v.filters, { role: 'technician' }, 'filters normalized'); ok(v.isDefault === true, 'isDefault honored'); } }
{ const v = validateSavedView({ name: 'X' }); ok(v.ok && v.isDefault === false, 'isDefault defaults false'); }

// parse guard
eq(parseViewFilters('{"role":"manager","x":1}'), { role: 'manager' }, 'parse + normalize stored json');
eq(parseViewFilters('not json'), {}, 'malformed json → empty');
eq(parseViewFilters(null), {}, 'null json → empty');

console.log(`workforce-savedview-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
