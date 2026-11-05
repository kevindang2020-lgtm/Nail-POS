/**
 * help-engagement-core.spec.ts — pure, DB-free checks for the engagement write helpers: comment sanitation
 * (trim, 2000-char cap, empty→null) and playback-position clamping (non-negative integer seconds). The
 * idempotent view dedupe + upserts themselves are SQL exercised against live Postgres.
 */
import { sanitizeComment, clampSeconds } from './help.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== sanitizeComment ==');
  check('trims whitespace', sanitizeComment('  hi  ') === 'hi');
  check('empty → null', sanitizeComment('   ') === null);
  check('non-string → null', sanitizeComment(undefined) === null);
  check('caps at 2000 chars', (sanitizeComment('x'.repeat(5000)) || '').length === 2000);

  console.log('\n== clampSeconds ==');
  check('floors positive', clampSeconds(42.9) === 42);
  check('negative → 0', clampSeconds(-5) === 0);
  check('NaN → 0', clampSeconds('abc') === 0);
  check('zero stays 0', clampSeconds(0) === 0);

  console.log('\nhelp-engagement-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
