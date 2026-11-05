/**
 * dashboard-core.spec.ts — runnable assertions (esbuild → node):
 *   dto helpers + toPosDashboardSummary projection + service over the in-memory repo (incl. tenant isolation).
 */
import {
  completedPercent, trendPercent, centsToUsd, paymentMixPercentages, toPosDashboardSummary,
  buildAiInsights, hourWindowLabel, clockLabel,
} from './dashboard.dto';
import { DashboardService } from './dashboard.service';
import { InMemoryDashboardRepo, DASHBOARD_SEED_TENANT, emptyDashboard } from './dashboard.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); }
}

async function main(): Promise<void> {
  console.log('\n== dto helpers ==');
  check('completedPercent(8/24) = 33', completedPercent(8, 24) === 33);
  check('trendPercent(118.6k vs 100k) = 18.6', trendPercent(118600, 100000) === 18.6);
  check('centsToUsd(4623180) = $46,231.80', centsToUsd(4623180) === '$46,231.80');
  const mix = paymentMixPercentages([{ method: 'card', amountCents: 3328600 }, { method: 'cash', amountCents: 924600 }, { method: 'other', amountCents: 369900 }]);
  check('paymentMix percents sum to 100', mix.reduce((a, m) => a + m.percent, 0) === 100);

  console.log('\n== AI Insights (buildAiInsights + labels) ==');
  check('clockLabel(13) = 1:00 PM', clockLabel(13) === '1:00 PM');
  check('clockLabel(9) = 9:00 AM', clockLabel(9) === '9:00 AM');
  check('clockLabel(0) = 12:00 AM', clockLabel(0) === '12:00 AM');
  check('hourWindowLabel(13,2) = 1:00 PM - 3:00 PM', hourWindowLabel(13, 2) === '1:00 PM - 3:00 PM');
  const allIns = buildAiInsights({ peakWindowLabel: '1:00 PM - 3:00 PM', peakServiceName: 'Acrylic Full Set', suggestExtraTech: true, staffingWindowLabel: '1:00 PM - 4:00 PM', missedCalls: 6, avgBookingValueCents: 9000, upsellEligible: 18, rebookingDue: 12, lowStockCount: 3 });
  check('builds all six insights in mockup order', allIns.length === 6 && allIns.map((x) => x.id).join(',') === 'peak_time,staffing,missed_calls,upsell,rebooking,low_stock');
  check('peak text matches reference', allIns[0].primary === 'Peak time today: 1:00 PM - 3:00 PM' && allIns[0].secondary === 'High demand for Acrylic Full Set.');
  check('staffing text matches reference', allIns[1].secondary === 'Between 1:00 PM - 4:00 PM to reduce wait time.');
  check('missed-calls value ~$540 + action', allIns[2].secondary === 'Potential bookings worth ~$540.' && allIns[2].action?.kind === 'missed_calls');
  check('upsell + rebooking text', allIns[3].secondary === '18 guests eligible for add-on services.' && allIns[4].primary === '12 customers due for rebooking');
  check('low-stock + View Inventory action', allIns[5].secondary === '3 products running low.' && allIns[5].action?.label === 'View Inventory');
  check('insights are conditional (only low-stock signal -> 1 row)', buildAiInsights({ lowStockCount: 2 }).length === 1);
  check('no insights when no signals (never fabricated)', buildAiInsights({}).length === 0);
  const seeded = await new InMemoryDashboardRepo().getAggregate({ tenantId: DASHBOARD_SEED_TENANT, branchId: null }, {});
  check('seeded fixture exposes all six AI insights', seeded.aiInsights.length === 6 && seeded.aiInsights[0].primary === 'Peak time today: 1:00 PM - 3:00 PM');
  check('other tenant sees zero AI insights (isolation)', (await new InMemoryDashboardRepo().getAggregate({ tenantId: 'other', branchId: null }, {})).aiInsights.length === 0);

  console.log('\n== mapper: empty aggregate -> valid summary ==');
  const empty = toPosDashboardSummary(emptyDashboard({ tenantId: 't', branchId: null }));
  check('empty summary kpis zeroed', empty.kpis.todayRevenueCents === 0 && empty.kpis.appointmentsToday === 0);
  check('empty summary arrays present', Array.isArray(empty.alerts) && Array.isArray(empty.topServices.items));

  console.log('\n== service: getState (tenant-scoped) ==');
  const svc = new DashboardService(new InMemoryDashboardRepo());
  const tc = (tenantId: string, role = 'RECEPTION') => ({ tenantId, branchId: 'br_cherryhill', userId: 'u1', role, permissions: ['pos.dashboard.view'] });

  const st = await svc.getState(tc(DASHBOARD_SEED_TENANT));
  check('seed tenant: revenue 846250', st.kpis.todayRevenueCents === 846250);
  check('seed tenant: 5 top services', st.topServices.length === 5);
  check('seed tenant: currentTicket present', !!st.currentTicket && st.currentTicket.ticketNumber === 'SD-1024');

  const other = await svc.getState(tc('some_other_tenant'));
  check('TENANT ISOLATION: other tenant zero revenue', other.kpis.todayRevenueCents === 0);
  check('TENANT ISOLATION: other tenant no top services', other.topServices.length === 0);

  console.log('\n== service: getSummary (spec §8 flat projection) ==');
  const sum = await svc.getSummary(tc(DASHBOARD_SEED_TENANT));
  check('summary kpis.appointmentsToday = 24', sum.kpis.appointmentsToday === 24);
  check('summary kpis.totalTechsOnSchedule = 16', sum.kpis.totalTechsOnSchedule === 16);
  check('summary operations.noShows = 1', sum.operations.noShows === 1);
  check('summary operations.openTickets = serving+checkout = 28', sum.operations.openTickets === 28);
  check('summary appointments.upcoming mapped', sum.appointments.upcoming.length > 0 && sum.appointments.upcoming[0].customerName === 'Sophia Nguyen');
  check('summary paymentMix card 72 / other 8', sum.paymentMix.cardPercent === 72 && sum.paymentMix.otherPercent === 8);
  check('summary revenueTrend 7 points', sum.revenueTrend.points.length === 7);
  check('summary topServices names + serviceId slug', sum.topServices.items[0].name === 'Acrylic Full Set' && sum.topServices.items[0].serviceId === 'acrylic-full-set');
  check('summary insights.busiestTimeToday set', sum.insights.busiestTimeToday === '2PM - 6PM');
  check('summary insights.staffOnBreakCount = 5', sum.insights.staffOnBreakCount === 5);
  check('summary moduleStatus honest (In Progress + reasons)', !!sum.moduleStatus && sum.moduleStatus.status === 'In Progress' && sum.moduleStatus.missingReasons.length > 0);

  console.log('\n== service: slice endpoints ==');
  check('getKpis flat', (await svc.getKpis(tc(DASHBOARD_SEED_TENANT))).onlineBookings === 27);
  check('getQueue waiting = 14', (await svc.getQueue(tc(DASHBOARD_SEED_TENANT))).waiting === 14);
  check('getCheckout readyForPayment = 6', (await svc.getCheckout(tc(DASHBOARD_SEED_TENANT))).readyForPayment === 6);
  check('getAlerts array', Array.isArray(await svc.getAlerts(tc(DASHBOARD_SEED_TENANT))));

  console.log('\n== access control (defense-in-depth) ==');
  let b1 = false; try { await svc.getState(tc(DASHBOARD_SEED_TENANT, 'CUSTOMER')); } catch (e) { b1 = true; }
  check('CUSTOMER blocked at service', b1);
  let b2 = false; try { await svc.getState(tc(DASHBOARD_SEED_TENANT, 'SUPER_ADMIN')); } catch (e) { b2 = true; }
  check('SUPER_ADMIN blocked from tenant dashboard', b2);

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
