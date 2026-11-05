/**
 * branch-device-core.spec.ts — verifies pure device-allocation validation + the allocatable-category gate.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { validateAllocateDevice, isAllocatable, ALLOCATABLE_CATEGORIES } from './branch-device-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== allocatable categories ==');
  check('terminal allocatable', isAllocatable('terminal'));
  check('display allocatable', isAllocatable('display'));
  check('kiosk allocatable', isAllocatable('kiosk'));
  check('leased hardware NOT allocatable', !isAllocatable('hardware'));
  check('exactly 3 allocatable', ALLOCATABLE_CATEGORIES.length === 3);

  console.log('\n== validation ==');
  check('rejects empty', validateAllocateDevice({}).ok === false);
  check('rejects missing device', validateAllocateDevice({ category: 'terminal' }).ok === false);
  check('rejects hardware category', validateAllocateDevice({ deviceId: 'd1', category: 'hardware' }).ok === false);
  {
    const r = validateAllocateDevice({ deviceId: '  d-9 ', category: 'Display' });
    check('accepts + normalizes', r.ok === true);
    if (r.ok) { check('device trimmed', r.value.deviceId === 'd-9'); check('category lowercased', r.value.category === 'display'); }
  }

  console.log(`\nbranch-device-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
