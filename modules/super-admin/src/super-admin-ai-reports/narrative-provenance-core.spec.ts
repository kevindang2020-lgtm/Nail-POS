import { promptHash, canActivateVersion, canVersionTransition, resolveActiveVersion, buildProvenance } from './narrative-provenance-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// prompt hash deterministic + sensitive
eq(promptHash('summarize the report'), promptHash('summarize the report'), 'hash stable');
ok(promptHash('a') !== promptHash('b'), 'different prompt → different hash');
ok(/^ph_[0-9a-f]{8}$/.test(promptHash('x')), 'hash format');
// version transitions
ok(canActivateVersion('draft') && !canActivateVersion('active'), 'activate only draft');
ok(canVersionTransition('draft', 'active') && canVersionTransition('active', 'retired') && !canVersionTransition('retired', 'active'), 'transitions');
// active resolution
{ const vs = [{ id: 'v1', modelName: 'm', promptVersion: '1', status: 'retired' }, { id: 'v2', modelName: 'm', promptVersion: '2', status: 'active' }, { id: 'v3', modelName: 'other', promptVersion: '1', status: 'active' }];
  eq(resolveActiveVersion(vs, 'm')?.id, 'v2', 'active for model m'); eq(resolveActiveVersion(vs, 'none'), null, 'no active → null'); }
// provenance
{ const p = buildProvenance({ templateId: 't1', templateVersion: 2, modelVersionId: 'v2', grounding: { allGrounded: true, offendingCount: 0 } });
  eq(p, { templateId: 't1', templateVersion: 2, modelVersionId: 'v2', allGrounded: true, groundingOk: true, offendingCount: 0 }, 'clean provenance groundingOk'); }
{ const p = buildProvenance({ templateId: 't1', templateVersion: 2, modelVersionId: 'v2', grounding: { allGrounded: false, offendingCount: 3 } });
  ok(p.groundingOk === false && p.offendingCount === 3 && p.allGrounded === false, 'violation provenance not ok'); }
console.log(`narrative-provenance-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
