/** ai-revenue-core.spec.ts — idempotent record (no double-count), summary math (today/week/byKind), tenant isolation. */
import { summarizeRevenue, type RevenueAttributionRow } from './ai-revenue.dto';
import { InMemoryAiRevenueRepo } from './ai-revenue.repository';
import { AiRevenueService } from './ai-revenue.service';

let pass = 0, fail = 0;
function check(n: string, c: boolean): void { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } }
const now = new Date().toISOString();

async function main(): Promise<void> {
  console.log('\n== idempotent attribution (no double-count) ==');
  const repo = new InMemoryAiRevenueRepo(); const svc = new AiRevenueService(repo);
  const a = await svc.record('t1', 'b1', { dedupeKey: 'line_9', source: 'ai_booking', kind: 'upsell', amountCents: 1500 });
  const b = await svc.record('t1', 'b1', { dedupeKey: 'line_9', source: 'ai_booking', kind: 'upsell', amountCents: 1500 });
  check('same dedupe key not double-counted', a.deduped === false && b.deduped === true && repo.rows.length === 1);

  console.log('\n== summary math (integer cents) ==');
  const rows: RevenueAttributionRow[] = [
    { id: '1', tenantId: 't1', branchId: 'b1', dedupeKey: 'a', source: 'ai', kind: 'upsell', amountCents: 1500, acceptedAt: now } as RevenueAttributionRow,
    { id: '2', tenantId: 't1', branchId: 'b1', dedupeKey: 'b', source: 'ai', kind: 'retail', amountCents: 990, acceptedAt: now } as RevenueAttributionRow,
  ];
  const s = summarizeRevenue(rows);
  check('todayCents = 2490', s.todayCents === 2490);
  check('byKind upsell = 1500', s.byKindToday.upsell === 1500);
  check('byKind retail = 990', s.byKindToday.retail === 990);

  console.log('\n== empty -> true zero ==');
  check('empty todayCents = 0', summarizeRevenue([]).todayCents === 0);

  console.log('\n== amount validation + tenant isolation ==');
  let threw = false; try { await svc.record('t1', 'b1', { dedupeKey: 'x', source: 'ai', amountCents: -5 }); } catch { threw = true; }
  check('negative amount rejected', threw);
  await svc.record('t2', null, { dedupeKey: 'line_9', source: 'ai', amountCents: 700 });
  const s1 = await repo.summary({ tenantId: 't1', branchId: 'b1' });
  const s2 = await repo.summary({ tenantId: 't2', branchId: null });
  check('t1 excludes t2 revenue', s1.todayCents === 1500 && s2.todayCents === 700);

  console.log(`\nai-revenue-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
