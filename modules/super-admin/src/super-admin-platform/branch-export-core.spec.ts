/**
 * branch-export-core.spec.ts — verifies the pure CSV builder, formula-injection guard, and column mapping.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { rowsToCsv, guardCell, escapeCsv, EXPORT_COLUMNS } from './branch-export-core';
import type { BranchDirRow } from './branch-directory-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const row = (o: Partial<BranchDirRow>): BranchDirRow => ({
  id: 'b1', name: 'Downtown', tenantId: 't1', tenantName: 'Luxe', city: 'Camden', state: 'NJ', status: 'active',
  manager: 'Sam Green', staff: 5, todaysAppts: 12, revenueMtdCents: 123456, devices: 3, openTickets: 1, queueWaiting: 2, healthScore: 88, ...o,
});

function main(): void {
  console.log('\n== formula-injection guard ==');
  check('prefixes leading =', guardCell('=cmd()') === "'=cmd()");
  check('prefixes leading +', guardCell('+1') === "'+1");
  check('prefixes leading -', guardCell('-2') === "'-2");
  check('prefixes leading @', guardCell('@x') === "'@x");
  check('leaves normal text', guardCell('Downtown') === 'Downtown');

  console.log('\n== csv escaping ==');
  check('quotes commas', escapeCsv('Camden, NJ') === '"Camden, NJ"');
  check('escapes quotes', escapeCsv('a"b') === '"a""b"');
  check('guards then quotes formula+comma', escapeCsv('=a,b') === '"\'=a,b"');

  console.log('\n== full csv ==');
  {
    const csv = rowsToCsv([row({}), row({ id: 'b2', name: '=Evil', revenueMtdCents: 5000, healthScore: null })]);
    const lines = csv.split('\n');
    check('header present', lines[0] === EXPORT_COLUMNS.map((c) => c.header).join(','));
    check('header has Revenue MTD (USD)', /Revenue MTD \(USD\)/.test(lines[0]));
    check('row count = 2 + header', lines.length === 3);
    check('revenue cents → dollars', lines[1].includes('1234.56'));
    check('null health → empty cell', lines[2].endsWith(',')); // trailing health col empty
    check('formula name neutralized', lines[2].includes("'=Evil"));
    check('no token/secret columns', !/token|secret|password|pin|card/i.test(lines[0]));
  }

  console.log(`\nbranch-export-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
