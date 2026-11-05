/**
 * overview-core.spec.ts — runnable assertions (esbuild → node):
 *   dto helpers + toPosOverviewState projection + service over the in-memory repo (incl. tenant isolation).
 */
import {
  centsToUsd, changePercent, completedPercent, paymentMixPercentages, busiestWindow, toPosOverviewState,
} from './overview.dto';
import { OverviewService } from './overview.service';
import { InMemoryOverviewRepo, OVERVIEW_SEED_TENANT } from './overview.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); }
}

async function main(): Promise<void> {
  console.log('\n== dto helpers ==');
  check('centsToUsd(4623180) = $46,231.80', centsToUsd(4623180) === '$46,231.80');
  check('changePercent(118.6k vs 100k) = 18.6', changePercent(118600, 100000) === 18.6);
  check('completedPercent(8/24) = 33', completedPercent(8, 24) === 33);
  const mix = paymentMixPercentages([{ method: 'card', amountCents: 609300 }, { method: 'cash', amountCents: 169250 }, { method: 'gift_card', amountCents: 67700 }]);
  check('paymentMix percents sum to 100', mix.reduce((a, m) => a + m.percent, 0) === 100);
  check('busiestWindow([14,14,15]) = "2PM - 6PM"', busiestWindow([14, 14, 15]) === '2PM - 6PM');

  console.log('\n== service: getState (tenant-scoped) ==');
  const svc = new OverviewService(new InMemoryOverviewRepo());
  const tc = (tenantId: string, role = 'RECEPTION') => ({ tenantId, branchId: 'br_cherryhill', userId: 'u1', role, permissions: ['pos.overview.view'] });

  const st = await svc.getState(tc(OVERVIEW_SEED_TENANT));
  check('seed tenant: today revenue 846250', st.kpis.todayRevenue.amountCents === 846250);
  check('seed tenant: 5 top services', st.analytics.topServices.length === 5);
  check('seed tenant: client satisfaction 4.8', st.kpis.clientSatisfaction.rating === 4.8);
  check('seed tenant: today check-ins 32', st.kpis.todayCheckIns.count === 32);
  check('seed tenant: walk-ins today 11', st.kpis.walkInsToday.count === 11);
  check('seed tenant: average ticket $82.61', st.kpis.averageTicket.amountCents === 8261);

  const other = await svc.getState(tc('some_other_tenant'));
  check('TENANT ISOLATION: other tenant sees zero revenue', other.kpis.todayRevenue.amountCents === 0);
  check('TENANT ISOLATION: other tenant sees no top services', other.analytics.topServices.length === 0);
  check('TENANT ISOLATION: other tenant sees zero check-ins', other.kpis.todayCheckIns.count === 0 && other.kpis.averageTicket.amountCents === 0);

  console.log('\n== service: getSummary (spec §8 projection) ==');
  const sum = await svc.getSummary(tc(OVERVIEW_SEED_TENANT));
  check('summary kpis.todayRevenueCents = 846250', sum.kpis.todayRevenueCents === 846250);
  check('summary kpis.activeTechs = 10', sum.kpis.activeTechs === 10 && sum.kpis.totalTechsOnSchedule === 16);
  check('summary paymentMix card 72%', sum.paymentMix.cardPercent === 72);
  check('summary paymentMix other = gift_card 8%', sum.paymentMix.otherPercent === 8 && sum.paymentMix.otherAmountCents === 67700);
  check('summary revenueTrend has 7 points with labels', sum.revenueTrend.points.length === 7 && sum.revenueTrend.points[0].label === '2026-05-30');
  check('summary topServices names mapped', sum.topServices.items[0].name === 'Acrylic Full Set');
  check('summary insights.busiestTimeToday = 2PM - 6PM', sum.insights.busiestTimeToday === '2PM - 6PM');
  check('summary insights.staffOnBreakCount = 5', sum.insights.staffOnBreakCount === 5);
  check('summary moduleStatus present + honest (In Progress)', !!sum.moduleStatus && sum.moduleStatus.status === 'In Progress' && sum.moduleStatus.missingReasons.length > 0);
  check('summary checkout.paidTickets sourced (41)', sum.checkout.paidTickets === 41);
  check('summary checkout.tipsTodayCents sourced (62400)', sum.checkout.tipsTodayCents === 62400);
  check('summary queue.longestWaitMinutes sourced (28)', sum.queue.longestWaitMinutes === 28);
  check('summary no longer lists paidTickets/tips/longestWait as missing', !sum.moduleStatus.missingReasons.some((r) => /paidTickets|tipsTodayCents|longestWaitMinutes/.test(r)));

  console.log('\n== service: slice endpoints ==');
  check('getKpis returns flat kpis', (await svc.getKpis(tc(OVERVIEW_SEED_TENANT))).onlineBookings === 27);
  check('getTopTechnicians returns 5', (await svc.getTopTechnicians(tc(OVERVIEW_SEED_TENANT))).length === 5);
  check('getAlerts returns array', Array.isArray(await svc.getAlerts(tc(OVERVIEW_SEED_TENANT))));

  console.log('\n== access control (defense-in-depth) ==');
  let blocked = false;
  try { await svc.getState(tc(OVERVIEW_SEED_TENANT, 'CUSTOMER')); } catch (e) { blocked = true; }
  check('CUSTOMER role blocked at service layer', blocked);
  let blockedSa = false;
  try { await svc.getState(tc(OVERVIEW_SEED_TENANT, 'SUPER_ADMIN')); } catch (e) { blockedSa = true; }
  check('SUPER_ADMIN blocked from tenant overview', blockedSa);

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
