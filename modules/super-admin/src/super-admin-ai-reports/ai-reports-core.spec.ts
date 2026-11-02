import { classifyReportCategory, assembleReportsByType, assembleAiReportKpis, pct } from './ai-reports-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// category mapping (real report_key values)
eq(classifyReportCategory('sales'), 'Revenue', 'sales→Revenue');
eq(classifyReportCategory('customer_retention'), 'Customer', 'retention→Customer');
eq(classifyReportCategory('technician_performance'), 'Operations', 'tech→Operations');
eq(classifyReportCategory('system_risk'), 'Risk & Compliance', 'risk→R&C');
eq(classifyReportCategory('mystery'), 'Other', 'unknown→Other');
// reports-by-type reconciles
{ const m = assembleReportsByType([{ reportKey: 'sales', count: 100 }, { reportKey: 'sales_summary', count: 28 }, { reportKey: 'services', count: 60 }, { reportKey: 'customer', count: 40 }, { reportKey: 'mystery', count: 12 }]);
  eq(m.total, 240, 'total = sum'); const rev = m.segments.find((s) => s.label === 'Revenue'); eq(rev?.value, 128, 'sales+sales_summary merged to 128'); ok(m.segments.every((s) => s.sharePct >= 0), 'shares computed'); }
{ const m = assembleReportsByType([]); eq(m.total, 0, 'empty total 0'); }
// KPIs: real four resolve, other eight honest gaps with notes
{ const k = assembleAiReportKpis({ reportsGeneratedToday: 84, onDemandReports: 28, weeklyReportsSent: 612, monthlyReportsSent: 2348 });
  eq(k.reportsGeneratedToday, { value: 84, available: true, note: 'Report exports created today' }, 'today real');
  eq(k.weeklyReportsSent.value, 612, 'weekly real');
  ok(k.scheduledReports.available === false && !!k.scheduledReports.note, 'scheduled gap w/ note');
  ok(k.failedReports.available === false, 'failed gap');
  ok(k.deliverySuccessRate.available === false, 'delivery rate gap');
  ok(k.avgGenerationTime.available === false, 'gen time gap');
  ok(k.reportTemplates.available === false, 'templates gap');
  ok(k.riskReportsOpen.available === false, 'risk gap'); }
eq(pct(128, 240), 53.3, 'pct rounded'); eq(pct(1, 0), 0, 'no div by zero');

// repointed KPIs (engine tables) + new mixes
import { assembleDeliveryStatusMix, assembleSourceMix } from './ai-reports-core';
{ const k = assembleAiReportKpis({ reportsGeneratedToday: 84, onDemandReports: 28, weeklyReportsSent: 612, monthlyReportsSent: 2348, scheduledReports: 12, failedReports: 3, avgGenerationTimeSec: 138, deliverySuccessRate: 98.7 });
  ok(k.scheduledReports.available === true && k.scheduledReports.value === 12, 'scheduled now real');
  ok(k.failedReports.available === true && k.failedReports.value === 3, 'failed now real');
  ok(k.avgGenerationTime.available === true && k.avgGenerationTime.value === 138, 'avg gen now real');
  ok(k.deliverySuccessRate.available === true && k.deliverySuccessRate.value === 98.7, 'delivery rate now real');
  ok(k.activeRecipients.available === false, 'active recipients still gap');
  ok(k.reportTemplates.available === false, 'templates still gap'); }
{ const m = assembleDeliveryStatusMix({ delivered: 628, failed: 5, bounced: 2, pending: 3 }); eq(m.total, 638, 'delivery mix total'); ok(m.segments.find((s)=>s.label==='Delivered')!.value===628, 'delivered seg'); }
{ const m = assembleDeliveryStatusMix({ delivered: 0, failed: 0, bounced: 0, pending: 0 }); eq(m.total, 0, 'empty delivery mix'); }
{ const s2 = assembleSourceMix({ scheduled: 40, onDemand: 12 }); eq(s2.total, 52, 'source mix total'); }

console.log(`ai-reports-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
