/**
 * help-videos-core.spec.ts — pure, DB-free checks that the video library reuses the same role-applicability
 * and popular-ranking rules as articles, applied to video-shaped rows (a video carries viewCount, lastUpdated,
 * title-equivalent). The SQL reads run against live Postgres; here we lock the shared rules videos depend on.
 */
import { articleVisibleToRole, rankPopular } from './help.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== video role applicability (shared rule) ==');
  check('empty roles → all roles see the video', articleVisibleToRole([], 'receptionist') === true);
  check('targeted role sees it', articleVisibleToRole(['owner'], 'owner') === true);
  check('non-targeted role does not', articleVisibleToRole(['owner'], 'technician') === false);

  console.log('\n== popular video ordering (shared rule) ==');
  const ranked = rankPopular([
    { title: 'Reports Overview', viewCount: 5, lastUpdatedAt: '2026-05-01' },
    { title: 'Getting Started', viewCount: 50, lastUpdatedAt: '2026-04-01' },
  ]);
  check('most-watched first', ranked[0].title === 'Getting Started');

  console.log('\nhelp-videos-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
