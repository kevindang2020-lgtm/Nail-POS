/* db-smoke.ts — exercises the staged Kysely adapters against the LIVE Postgres schema (no HTTP server).
 * Run: REPO_DRIVER=postgres DATABASE_URL=... npx tsx scripts/db-smoke.ts */
import { createDatabase } from '../../../packages/database/src/kysely.provider';
import { KyselyDashboardRepository } from '../../../modules/super-admin/src/super-admin-dashboard/dashboard.kysely.repository';
import { KyselyOverviewRepo } from '../../../modules/analytics/src/overview/overview.kysely.repository';
import { KyselyDashboardRepo } from '../../../modules/analytics/src/dashboard/dashboard.kysely.repository';
import { KyselyCheckInRepository } from '../../../modules/queue/src/check-in/check-in.kysely.repository';
import { KyselyCheckoutRepository } from '../../../modules/checkout/src/checkout/checkout.kysely.repository';
import { KyselyCustomersRepository } from '../../../modules/customers/src/customers/customers.kysely.repository';
import { KyselyQueueRepository } from '../../../modules/queue/src/queue/queue.kysely.repository';
import { KyselyReportsRepository } from '../../../modules/reports/src/reports/reports.kysely.repository';
import { KyselyServiceDoneRepository } from '../../../modules/queue/src/service-done/service-done.kysely.repository';
import { KyselyServicesRepository } from '../../../modules/catalog/src/services/services.kysely.repository';
import { KyselyServingRepository } from '../../../modules/queue/src/serving/serving.kysely.repository';
import { KyselySettingsRepository } from '../../../modules/tenants/src/settings/settings.kysely.repository';
import { KyselyTechApptRepository } from '../../../modules/appointments/src/tech-appointments/tech-appointments.kysely.repository';
import { KyselyTechQueueRepository } from '../../../modules/queue/src/tech-queue/tech-queue.kysely.repository';
import { KyselyTechRepository } from '../../../modules/queue/src/tech/tech.kysely.repository';
import { KyselyTechniciansRepository } from '../../../modules/workforce/src/technicians/technicians.kysely.repository';

const TENANT = '2ca344a7-a8c0-4e21-90de-1016c49bb539';
const BRANCH = '238fd817-671c-4e24-8b57-e3989a08e455';
const OWNER  = 'fee60126-ce61-4be0-9742-4195621ae066';
const ctx: any = { tenantId: TENANT, branchId: BRANCH, userId: OWNER, role: 'OWNER', permissions: [] };
const scope: any = { tenantId: TENANT, branchId: BRANCH };
const day = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0; const fails: string[] = [];
async function run(name: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); pass++; console.log(`✅ ${name}`); void r; }
  catch (e: any) { fail++; fails.push(name); console.log(`❌ ${name}: ${e?.message || e}`); }
}

(async () => {
  const db = createDatabase();
  if (!db) { console.log('NO DB'); process.exit(1); }
  await run('superAdminDashboard.getFacts',      () => new KyselyDashboardRepository(db).getFacts());
  await run('superAdminDashboard.getPlanPrices', () => new KyselyDashboardRepository(db).getPlanPrices());
  await run('posOverview.getAggregate',          () => new KyselyOverviewRepo(db).getAggregate(scope, { date: day } as any));
  await run('posDashboard.getAggregate',         () => new KyselyDashboardRepo(db).getAggregate(scope, { date: day } as any));
  await run('checkIn.customerDirectory',         () => new KyselyCheckInRepository(db).customerDirectory(ctx));
  await run('checkout.loadAll',                  () => new KyselyCheckoutRepository(db).loadAll(ctx));
  await run('checkout.payments',                 () => new KyselyCheckoutRepository(db).payments(ctx));
  await run('customers.load',                    () => new KyselyCustomersRepository(db).load(ctx));
  await run('queue.technicians',                 () => new KyselyQueueRepository(db).technicians(ctx));
  await run('reports.loadTx',                    () => new KyselyReportsRepository(db).loadTx(ctx, { from: '2026-01-01', to: '2026-12-31', granularity: 'day' } as any));
  await run('serviceDone.technicians',           () => new KyselyServiceDoneRepository(db).technicians(ctx));
  await run('services.cats',                     () => new KyselyServicesRepository(db).cats(ctx));
  await run('serving.loadAll',                   () => new KyselyServingRepository(db).loadAll(ctx));
  await run('settings.getRaw',                   () => new KyselySettingsRepository(db).getRaw(ctx));
  await run('techAppt.serviceCatalog',           () => new KyselyTechApptRepository(db).serviceCatalog(ctx));
  await run('techQueue.serviceCatalog',          () => new KyselyTechQueueRepository(db).serviceCatalog(ctx));
  await run('tech.resolveTechnicianId',          () => new KyselyTechRepository(db).resolveTechnicianId(ctx));
  await run('technicians.load',                  () => new KyselyTechniciansRepository(db).load(ctx));
  await db.destroy();
  console.log(`\n=== smoke: ${pass} passed, ${fail} failed ${fails.length ? '→ ' + fails.join(', ') : ''} ===`);
  process.exit(fail ? 2 : 0);
})();
