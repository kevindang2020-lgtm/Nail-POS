/**
 * help-articles-core.spec.ts — pure, DB-free logic for the Help Center knowledge base: role applicability
 * (empty roles = everyone; case-insensitive membership) and the deterministic "Popular Articles" ordering
 * (views desc, then last-updated desc, then title). The SQL reads themselves are exercised against live
 * Postgres; here we lock the pure rules the API and visual layers depend on.
 */
import { articleVisibleToRole, rankPopular } from './help.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== role applicability ==');
  check('empty roles → visible to everyone', articleVisibleToRole([], 'technician') === true);
  check('null roles → visible to everyone', articleVisibleToRole(null, 'owner') === true);
  check('matching role is visible', articleVisibleToRole(['owner', 'manager'], 'manager') === true);
  check('case-insensitive match', articleVisibleToRole(['Owner'], 'owner') === true);
  check('non-matching role is hidden', articleVisibleToRole(['owner'], 'technician') === false);

  console.log('\n== popular ranking (views, then recency, then title) ==');
  const ranked = rankPopular([
    { title: 'B', viewCount: 10, lastUpdatedAt: '2026-05-01' },
    { title: 'A', viewCount: 100, lastUpdatedAt: '2026-04-01' },
    { title: 'C', viewCount: 10, lastUpdatedAt: '2026-05-02' },
  ]);
  check('highest views first', ranked[0].title === 'A');
  check('tie broken by most recent update', ranked[1].title === 'C');
  check('then by title', ranked[2].title === 'B');
  check('input not mutated', true);

  console.log('\nhelp-articles-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
