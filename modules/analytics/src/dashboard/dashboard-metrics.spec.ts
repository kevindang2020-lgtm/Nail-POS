// dashboard-metrics.spec.ts — runnable (esbuild→node) assertions for the §20 derived-metric helpers.
import { averageTicketCents, rebookRatePercent, utilizationPercent, onDutyPercent, trendPercent } from './dashboard.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

ok('avg ticket = revenue / count', averageTicketCents(78500, 10) === 7850);
ok('avg ticket zero-count safe', averageTicketCents(5000, 0) === 0);
ok('avg ticket rounds', averageTicketCents(10000, 3) === 3333);

ok('rebook rate %', rebookRatePercent(34, 50) === 68);
ok('rebook rate zero-eligible safe', rebookRatePercent(5, 0) === 0);

ok('utilization %', utilizationPercent(330, 400) === 83);
ok('utilization capped at 100', utilizationPercent(500, 400) === 100);
ok('utilization zero-available safe', utilizationPercent(100, 0) === 0);

ok('on-duty %', onDutyPercent(8, 12) === 67);
ok('on-duty zero-scheduled safe', onDutyPercent(5, 0) === 0);

// trend % must never divide by zero (defined new-growth state)
ok('trend normal', trendPercent(118, 100) === 18);
ok('trend from zero is not Infinity', Number.isFinite(trendPercent(50, 0)));

console.log(`dashboard-metrics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
