/* verify-daily-followups.ts — proves the Daily Follow-Up Queue backend over real Postgres (PGlite) by instantiating
 * the service + Kysely repository directly (no HTTP/DI). Covers the specs' backend test matrix: generation from
 * completed service lines, the MAIN-TECH rule (one task per line owned by the line's technician; ticket-level helper
 * gets no duplicate), exclusion of cancelled/unpaid/removed lines, dedup on re-run, tenant + branch isolation, the
 * branch-timezone business-date (UTC instant -> correct local day across the midnight-UTC boundary), send -> customer
 * notification, no-app -> customer_not_available, skip, customer-only visibility (sent only), reply/rebook, settings
 * save, and the scheduler gate (runDueBranches before/after 8pm local). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyDailyFollowUpRepository } from '../../../modules/communications/src/end-of-day-followups/end-of-day-followups.kysely.repository';
import { DailyFollowUpService } from '../../../modules/communications/src/end-of-day-followups/end-of-day-followups.service';
import { FollowUpError, type FollowUpContext } from '../../../modules/communications/src/end-of-day-followups/end-of-day-followups.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throwsFU = async (n: string, fn: () => Promise<any>, code: string) => {
  try { await fn(); ok(n, false, 'did not throw'); }
  catch (e: any) { ok(n, e instanceof FollowUpError && e.code === code, e instanceof FollowUpError ? e.code : (e?.message || 'non-FU error')); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5482;

  // ---- ids (hex-only for PGlite) ----
  const T1 = '00000000-0000-0000-0000-0000000a0001', T2 = '00000000-0000-0000-0000-0000000a0002';
  const B1 = '00000000-0000-0000-0000-0000000b0001', B2 = '00000000-0000-0000-0000-0000000b0002', B3 = '00000000-0000-0000-0000-0000000b0003';
  // tech users
  const U_LINH = '00000000-0000-0000-0000-0000000c0001', U_TONY = '00000000-0000-0000-0000-0000000c0002', U_B3T = '00000000-0000-0000-0000-0000000c0003', U_T2T = '00000000-0000-0000-0000-0000000c0004';
  // customer users (Olivia has app; Sophia has none)
  const U_OLIVIA = '00000000-0000-0000-0000-0000000c0101', U_B3C = '00000000-0000-0000-0000-0000000c0102', U_T2C = '00000000-0000-0000-0000-0000000c0103';
  const U_MGR = '00000000-0000-0000-0000-0000000c01ff', U_MGR2 = '00000000-0000-0000-0000-0000000c01fe';
  // technicians
  const TE_LINH = '00000000-0000-0000-0000-0000000e0001', TE_TONY = '00000000-0000-0000-0000-0000000e0002', TE_B3 = '00000000-0000-0000-0000-0000000e0003', TE_T2 = '00000000-0000-0000-0000-0000000e0004';
  // customers
  const CR_OLIVIA = '00000000-0000-0000-0000-0000000d0001', CR_SOPHIA = '00000000-0000-0000-0000-0000000d0002', CR_B3 = '00000000-0000-0000-0000-0000000d0003', CR_T2 = '00000000-0000-0000-0000-0000000d0004';
  // tickets
  const TK_MAIN = '00000000-0000-0000-0000-0000000f0001', TK_SOPHIA = '00000000-0000-0000-0000-0000000f0002', TK_CANC = '00000000-0000-0000-0000-0000000f0003', TK_UNPAID = '00000000-0000-0000-0000-0000000f0004', TK_DST = '00000000-0000-0000-0000-0000000f0005', TK_VOIDLN = '00000000-0000-0000-0000-0000000f0006', TK_T2 = '00000000-0000-0000-0000-0000000f0007', TK_B3 = '00000000-0000-0000-0000-0000000f0008';
  const SVC = '00000000-0000-0000-0000-000000010001';

  // ---- timestamps (2026, EDT = UTC-4) ----
  const D1_1630Z = '2026-06-10T20:30:00.000Z'; // 16:30 ET on 2026-06-10
  const D1_1700Z = '2026-06-10T21:00:00.000Z'; // 17:00 ET on 2026-06-10
  const DST_Z = '2026-06-11T01:30:00.000Z';     // 21:30 ET on 2026-06-10 (UTC date is 06-11, ET date is 06-10)
  const D2_1630Z = '2026-06-12T20:30:00.000Z'; // 16:30 ET on 2026-06-12
  const NOW_MAIN = new Date('2026-06-10T22:00:00.000Z'); // 18:00 ET on 2026-06-10 -> business date 2026-06-10
  const NOW_BEFORE = new Date('2026-06-12T23:00:00.000Z'); // 19:00 ET on 2026-06-12 (< 20:00)
  const NOW_AFTER = new Date('2026-06-13T00:30:00.000Z');  // 20:30 ET on 2026-06-12 (>= 20:00) -> business date 2026-06-12
  const D1 = '2026-06-10', D2 = '2026-06-12';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES
    ('${T1}','Luxe','Luxe Nails & Spa','luxe','LUXE'),('${T2}','Other','Other Salon','other','OTHR')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES
    ('${B1}','${T1}','Cherry Hill','active'),('${B3}','${T1}','Marlton','active'),('${B2}','${T2}','Uptown','active')`);
  await db.exec(`INSERT INTO store_hours_settings (tenant_id, branch_id, timezone) VALUES
    ('${T1}','${B1}','America/New_York'),('${T1}','${B3}','America/New_York'),('${T2}','${B2}','America/New_York')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES
    ('${U_LINH}','${T1}','${B1}','Linh','Tran','Linh Tran','linh@x.com','active','TECHNICIAN'),
    ('${U_TONY}','${T1}','${B1}','Tony','Vo','Tony Vo','tony@x.com','active','TECHNICIAN'),
    ('${U_B3T}','${T1}','${B3}','Bea','Ng','Bea Ng','bea@x.com','active','TECHNICIAN'),
    ('${U_T2T}','${T2}','${B2}','Tara','Po','Tara Po','tara@x.com','active','TECHNICIAN'),
    ('${U_OLIVIA}','${T1}','${B1}','Olivia','Brown','Olivia Brown','olivia@x.com','active','CUSTOMER'),
    ('${U_B3C}','${T1}','${B3}','Bob','Cee','Bob Cee','bob@x.com','active','CUSTOMER'),
    ('${U_T2C}','${T2}','${B2}','Cara','Tu','Cara Tu','cara@x.com','active','CUSTOMER'),
    ('${U_MGR}','${T1}','${B1}','Mona','Manager','Mona Manager','mona@x.com','active','OWNER'),
    ('${U_MGR2}','${T2}','${B2}','Otto','Owner','Otto Owner','otto@x.com','active','OWNER')`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status, user_id) VALUES
    ('${CR_OLIVIA}','${T1}','${B1}','Olivia','Brown','Olivia Brown','+15551110001','(555) 111-0001','active','${U_OLIVIA}'),
    ('${CR_SOPHIA}','${T1}','${B1}','Sophia','Lee','Sophia Lee','+15551110002','(555) 111-0002','active',NULL),
    ('${CR_B3}','${T1}','${B3}','Bob','Cee','Bob Cee','+15551110003','(555) 111-0003','active','${U_B3C}'),
    ('${CR_T2}','${T2}','${B2}','Cara','Tu','Cara Tu','+15551110004','(555) 111-0004','active','${U_T2C}')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${TE_LINH}','${T1}','${B1}','${U_LINH}','Linh','Tran','Linh Tran','available','percent',40,true),
    ('${TE_TONY}','${T1}','${B1}','${U_TONY}','Tony','Vo','Tony Vo','available','percent',40,true),
    ('${TE_B3}','${T1}','${B3}','${U_B3T}','Bea','Ng','Bea Ng','available','percent',40,true),
    ('${TE_T2}','${T2}','${B2}','${U_T2T}','Tara','Po','Tara Po','available','percent',40,true)`);

  const mkTicket = (id: string, tenant: string, branch: string, cust: string, status: string, paidAt: string | null, helper: string | null, num: string) =>
    `INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at, helper_technician_id, ticket_number) VALUES
     ('${id}','${tenant}','${branch}','${cust}','${status}',6000,0,0,6000,0,${paidAt ? `'${paidAt}'` : 'NULL'},${helper ? `'${helper}'` : 'NULL'},'${num}')`;
  await db.exec(mkTicket(TK_MAIN, T1, B1, CR_OLIVIA, 'paid', D1_1630Z, TE_TONY, 'TKT-1001'));   // helper Tony at ticket level
  await db.exec(mkTicket(TK_SOPHIA, T1, B1, CR_SOPHIA, 'paid', D1_1630Z, null, 'TKT-1002'));    // customer has NO app
  await db.exec(mkTicket(TK_CANC, T1, B1, CR_OLIVIA, 'cancelled', null, null, 'TKT-1003'));     // excluded (cancelled)
  await db.exec(mkTicket(TK_UNPAID, T1, B1, CR_OLIVIA, 'serving', null, null, 'TKT-1004'));     // excluded (not completed)
  await db.exec(mkTicket(TK_DST, T1, B1, CR_OLIVIA, 'paid', DST_Z, null, 'TKT-1005'));          // completion ET date = D1
  await db.exec(mkTicket(TK_VOIDLN, T1, B1, CR_OLIVIA, 'paid', D1_1630Z, null, 'TKT-1006'));    // line removed -> excluded
  await db.exec(mkTicket(TK_T2, T2, B2, CR_T2, 'paid', D1_1630Z, null, 'TKT-2001'));            // other tenant
  await db.exec(mkTicket(TK_B3, T1, B3, CR_B3, 'paid', D2_1630Z, null, 'TKT-3001'));            // other branch, D2

  const mkLine = (tenant: string, branch: string, ticket: string, tech: string | null, name: string, status: string, completedAt: string | null, removed = false) =>
    `INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent, completed_at, removed_at) VALUES
     (gen_random_uuid(),'${tenant}','${branch}','${ticket}','${SVC}',${tech ? `'${tech}'` : 'NULL'},'${name}',6000,60,'percent',40,6000,'${status}',100,${completedAt ? `'${completedAt}'` : 'NULL'},${removed ? 'now()' : 'NULL'})`;
  // TK_MAIN: line1 main=Linh, line2 main=Tony (helper of line1 is the ticket-level Tony, who must NOT own line1)
  await db.exec(mkLine(T1, B1, TK_MAIN, TE_LINH, 'Acrylic Full Set', 'completed', D1_1630Z));
  await db.exec(mkLine(T1, B1, TK_MAIN, TE_TONY, 'Nail Art', 'completed', D1_1700Z));
  await db.exec(mkLine(T1, B1, TK_SOPHIA, TE_LINH, 'Gel Manicure', 'completed', D1_1630Z));
  await db.exec(mkLine(T1, B1, TK_CANC, TE_LINH, 'Pedicure', 'completed', D1_1630Z));     // ticket cancelled -> excluded
  await db.exec(mkLine(T1, B1, TK_UNPAID, TE_LINH, 'Fill', 'completed', D1_1630Z));       // ticket serving -> excluded
  await db.exec(mkLine(T1, B1, TK_DST, TE_LINH, 'Chrome Design', 'completed', DST_Z));    // ET date D1
  await db.exec(mkLine(T1, B1, TK_VOIDLN, TE_LINH, 'Removed Svc', 'completed', D1_1630Z, true)); // removed -> excluded
  await db.exec(mkLine(T2, B2, TK_T2, TE_T2, 'Gel X', 'completed', D1_1630Z));            // other tenant
  await db.exec(mkLine(T1, B3, TK_B3, TE_B3, 'Dip Powder', 'completed', D2_1630Z));       // other branch, D2

  // --- B4 + actors, used only by the realtime-emit test below ---
  const B4 = '00000000-0000-0000-0000-0000000b0004';
  const U_B4T = '00000000-0000-0000-0000-0000000c0005', U_B4C = '00000000-0000-0000-0000-0000000c0104';
  const TE_B4 = '00000000-0000-0000-0000-0000000e0005', CR_B4 = '00000000-0000-0000-0000-0000000d0005', TK_B4b = '00000000-0000-0000-0000-0000000f0009';
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B4}','${T1}','Voorhees','inactive')`); // inactive → the runDueBranches sweep skips it, leaving it ungenerated for the emit test
  await db.exec(`INSERT INTO store_hours_settings (tenant_id, branch_id, timezone) VALUES ('${T1}','${B4}','America/New_York')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES
    ('${U_B4T}','${T1}','${B4}','Dana','Ng','Dana Ng','dana@x.com','active','TECHNICIAN'),
    ('${U_B4C}','${T1}','${B4}','Eve','Cust','Eve Cust','eve@x.com','active','CUSTOMER')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${TE_B4}','${T1}','${B4}','${U_B4T}','Dana','Ng','Dana Ng','available','percent',40,true)`);
  await db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status, user_id) VALUES
    ('${CR_B4}','${T1}','${B4}','Eve','Cust','Eve Cust','+15551110005','(555) 111-0005','active','${U_B4C}')`);
  await db.exec(mkTicket(TK_B4b, T1, B4, CR_B4, 'paid', D2_1630Z, null, 'TKT-4001'));
  await db.exec(mkLine(T1, B4, TK_B4b, TE_B4, 'Gel Fill', 'completed', D2_1630Z));

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new DailyFollowUpService(new KyselyDailyFollowUpRepository(k));

  const C = (tenantId: string, branchId: string, userId: string, role: string): FollowUpContext => ({ tenantId, branchId, userId, role, permissions: [] });
  const linh = C(T1, B1, U_LINH, 'TECHNICIAN');
  const tony = C(T1, B1, U_TONY, 'TECHNICIAN');
  const mgr = C(T1, B1, U_MGR, 'OWNER');
  const mgr2 = C(T2, B2, U_MGR2, 'OWNER');
  const olivia = C(T1, B1, U_OLIVIA, 'CUSTOMER');
  const cntTasks = async (where: Record<string, string>) => {
    let q = k.selectFrom('service_follow_up_tasks').select(k.fn.countAll<string>().as('n')).where('deleted_at', 'is', null);
    for (const [col, val] of Object.entries(where)) q = q.where(col as any, '=', val);
    const r: any = await q.executeTakeFirst(); return Number(r.n);
  };

  try {
    // ===== generation =====
    const g1 = await svc.generateForBranch(T1, B1, { now: NOW_MAIN, triggerSource: 'manual' });
    ok('generates for branch B1 on business date D1', g1.businessDate === D1, g1.businessDate);
    ok('creates exactly 4 tasks (2 main-ticket lines + sophia + dst; excludes cancelled/unpaid/removed)', g1.created === 4, `created=${g1.created}`);

    // ===== main-tech rule =====
    const linhList = await svc.techList(linh, { date: D1 });
    const tonyList = await svc.techList(tony, { date: D1 });
    ok('Linh owns 3 tasks (Acrylic line + Gel Manicure + Chrome Design)', linhList.tasks.length === 3, `len=${linhList.tasks.length}`);
    ok('Tony owns exactly 1 task', tonyList.tasks.length === 1, `len=${tonyList.tasks.length}`);
    ok('MAIN-TECH RULE: Tony\'s only task is Nail Art (his line), NOT the Acrylic line he merely helped on',
      tonyList.tasks.length === 1 && tonyList.tasks[0].serviceName === 'Nail Art' && !tonyList.tasks.some((t) => t.serviceName === 'Acrylic Full Set'));
    ok('helper Tony has NO task for the Acrylic Full Set line',
      !(await k.selectFrom('service_follow_up_tasks').select('id').where('technician_id', '=', TE_TONY).where('service_name_snapshot', '=', 'Acrylic Full Set').executeTakeFirst()));
    ok('Linh\'s tasks include Acrylic Full Set (he is main on that line)', linhList.tasks.some((t) => t.serviceName === 'Acrylic Full Set'));

    // ===== exclusions =====
    ok('cancelled ticket line excluded', !linhList.tasks.some((t) => t.serviceName === 'Pedicure'));
    ok('unpaid/serving ticket line excluded', !linhList.tasks.some((t) => t.serviceName === 'Fill'));
    ok('removed service line excluded', !linhList.tasks.some((t) => t.serviceName === 'Removed Svc'));

    // ===== timezone / business date =====
    ok('DST line (UTC 06-11 01:30 = ET 06-10 21:30) attributed to business date D1',
      linhList.tasks.some((t) => t.serviceName === 'Chrome Design' && t.businessDate === D1));

    // ===== dedup =====
    const g2 = await svc.generateForBranch(T1, B1, { now: NOW_MAIN, triggerSource: 'manual', force: true });
    ok('re-run (forced) creates 0 duplicate tasks', g2.created === 0, `created=${g2.created}`);
    ok('still exactly 4 tasks for B1', (await cntTasks({ branch_id: B1 })) === 4, String(await cntTasks({ branch_id: B1 })));

    // ===== manager view + isolation =====
    const mgrList = await svc.managerList(mgr, { date: D1 });
    ok('manager sees all 4 branch tasks', mgrList.tasks.length === 4, `len=${mgrList.tasks.length}`);
    await svc.generateForBranch(T2, B2, { now: NOW_MAIN, triggerSource: 'manual' });
    const mgrListAfterT2 = await svc.managerList(mgr, { date: D1 });
    ok('TENANT ISOLATION: T1 manager still sees only 4 (no T2 tasks)', mgrListAfterT2.tasks.length === 4, `len=${mgrListAfterT2.tasks.length}`);
    const mgr2List = await svc.managerList(mgr2, { date: D1 });
    ok('TENANT ISOLATION: T2 manager sees only its own task', mgr2List.tasks.length === 1 && mgr2List.tasks[0].technicianName === 'Tara Po');
    ok('BRANCH ISOLATION: Linh (B1) sees no B3 tasks before B3 generates', !linhList.tasks.some((t) => t.serviceName === 'Dip Powder'));

    // ===== send (with app) =====
    const oliviaAcrylic = linhList.tasks.find((t) => t.serviceName === 'Acrylic Full Set')!;
    const sent = await svc.techSend(linh, oliviaAcrylic.id);
    ok('send marks task sent', sent.status === 'sent', sent.status);
    const notif: any = await k.selectFrom('customer_notifications').selectAll().where('customer_id', '=', CR_OLIVIA).where('type', '=', 'service_follow_up').executeTakeFirst();
    ok('send creates a customer_notifications row for Olivia', !!notif && notif.reference === oliviaAcrylic.id);
    ok('notification title names the technician', !!notif && /Linh Tran/.test(notif.title), notif?.title);

    // ===== send (no app) =====
    const sophiaTask = linhList.tasks.find((t) => t.serviceName === 'Gel Manicure')!;
    const sentNoApp = await svc.techSend(linh, sophiaTask.id);
    ok('send to customer without app -> customer_not_available', sentNoApp.status === 'customer_not_available', sentNoApp.status);
    ok('no notification row created for no-app customer', !(await k.selectFrom('customer_notifications').select('id').where('customer_id', '=', CR_SOPHIA).executeTakeFirst()));

    // ===== skip + edit =====
    const dstTask = linhList.tasks.find((t) => t.serviceName === 'Chrome Design')!;
    const skipped = await svc.techSkip(linh, dstTask.id, 'customer asked not to be contacted');
    ok('skip marks task skipped with reason', skipped.status === 'skipped' && skipped.skipReason === 'customer asked not to be contacted');
    await throwsFU('cannot skip an already-sent task', () => svc.techSkip(linh, oliviaAcrylic.id), 'invalid_state');

    // ===== cross-tech / cross-scope guards =====
    await throwsFU('tech cannot fetch another tech\'s task', () => svc.techGet(tony, oliviaAcrylic.id), 'forbidden');
    await throwsFU('tech list errors when account is not a technician', () => svc.techList(C(T1, B1, U_MGR, 'OWNER'), {}), 'not_technician');

    // ===== customer visibility =====
    const custList = await svc.customerList(olivia);
    ok('customer sees only their SENT follow-up (the Acrylic one)', custList.length === 1 && custList[0].serviceName === 'Acrylic Full Set');
    ok('customer does NOT see pending/skipped tasks', !custList.some((t) => ['pending', 'skipped'].includes(t.status)));
    const custGet = await svc.customerGet(olivia, oliviaAcrylic.id);
    ok('customer can open their sent follow-up', custGet.id === oliviaAcrylic.id);
    const viewed: any = await k.selectFrom('service_follow_up_tasks').select('customer_viewed_at').where('id', '=', oliviaAcrylic.id).executeTakeFirst();
    ok('opening marks customer_viewed_at', !!viewed.customer_viewed_at);
    await throwsFU('customer cannot open a task that was never sent to them', () => svc.customerGet(olivia, sophiaTask.id), 'not_found');

    // ===== reply + rebook =====
    const replied = await svc.customerReply(olivia, oliviaAcrylic.id, 'Thank you, see you soon!');
    ok('customer reply sets status customer_replied', replied.status === 'customer_replied', replied.status);
    const rebook = await svc.customerRebook(olivia, oliviaAcrylic.id);
    ok('rebook returns preselect with tenant/branch/tech/service', rebook.tenantId === T1 && rebook.branchId === B1 && rebook.technicianId === TE_LINH && rebook.serviceId === SVC);

    // ===== settings =====
    const saved = await svc.saveSettings(mgr, { generationTime: '21:30', enabled: false, allowCustomerReplies: false });
    ok('settings save persists generationTime + enabled + allowCustomerReplies', saved.generationTime === '21:30' && saved.enabled === false && saved.allowCustomerReplies === false);
    const reread = await svc.getSettings(mgr);
    ok('settings re-read reflects saved values', reread.generationTime === '21:30' && reread.enabled === false);
    await throwsFU('invalid generationTime rejected', () => svc.saveSettings(mgr, { generationTime: '9pm' }), 'validation');
    // re-enable B1 so it is not skipped by the scheduler in later manual checks (cleanliness)
    await svc.saveSettings(mgr, { enabled: true, generationTime: '20:00', allowCustomerReplies: true });

    // ===== manager approval workflow =====
    await svc.saveSettings(mgr, { requireManagerApproval: true });
    const nailArt = tonyList.tasks[0]; // Tony's only task (Nail Art), still pending; customer Olivia has an app
    const held = await svc.techSend(tony, nailArt.id);
    ok('with approval required, tech send HOLDS the task for approval (not sent)', held.status === 'pending_manager_approval', held.status);
    ok('held task creates NO customer notification yet', !(await k.selectFrom('customer_notifications').select('id').where('reference', '=', nailArt.id).executeTakeFirst()));
    const approved = await svc.managerApprove(mgr, nailArt.id);
    ok('manager approve delivers the held follow-up (sent)', approved.status === 'sent', approved.status);
    ok('approval creates the customer notification', !!(await k.selectFrom('customer_notifications').select('id').where('reference', '=', nailArt.id).executeTakeFirst()));
    ok('re-approving an already-sent task is idempotent', (await svc.managerApprove(mgr, nailArt.id)).status === 'sent');
    await throwsFU('cannot approve a skipped task', () => svc.managerApprove(mgr, dstTask.id), 'invalid_state');
    await svc.saveSettings(mgr, { requireManagerApproval: false });

    // ===== scheduler gate (runDueBranches) =====
    const before = await svc.runDueBranches(NOW_BEFORE); // 19:00 ET -> nothing should generate (all branches ET, < 20:00)
    ok('runDueBranches before 8pm local does not generate for B3/D2', !(await new KyselyDailyFollowUpRepository(k).runExists(T1, B3, D2)));
    ok('B3 has no tasks before its generation time', (await cntTasks({ branch_id: B3 })) === 0, String(await cntTasks({ branch_id: B3 })));
    const after = await svc.runDueBranches(NOW_AFTER);  // 20:30 ET on D2 -> B3 generates
    ok('runDueBranches after 8pm local generated a run for B3/D2', await new KyselyDailyFollowUpRepository(k).runExists(T1, B3, D2));
    ok('B3 now has its 1 completed-line task', (await cntTasks({ branch_id: B3 })) === 1, String(await cntTasks({ branch_id: B3 })));
    ok('scheduler ran at least the B3 branch after 8pm', after.branchesRun >= 1, `branchesRun=${after.branchesRun}`);

    // ===== auto-expire stale pending tasks (24h) =====
    const realNow = new Date(); // align with DB now() used for created_at
    const mgrB3 = C(T1, B3, U_MGR, 'OWNER');
    // B3's Dip Powder task is fresh + pending → a sweep must NOT touch it
    await svc.expireStaleTasks(realNow);
    ok('fresh pending task is NOT auto-expired', (await cntTasks({ branch_id: B3 })) === 1, String(await cntTasks({ branch_id: B3 })));
    // backdate it past 24h → swept out of the queue
    await k.updateTable('service_follow_up_tasks').set({ created_at: sql`now() - interval '25 hours'` } as any).where('branch_id', '=', B3).where('status', '=', 'pending').execute();
    const exp = await svc.expireStaleTasks(realNow);
    ok('a pending task older than 24h is auto-expired', exp.expired >= 1, `expired=${exp.expired}`);
    ok('expired task is gone from the branch queue', (await cntTasks({ branch_id: B3 })) === 0, String(await cntTasks({ branch_id: B3 })));
    const expiredRow: any = await k.selectFrom('service_follow_up_tasks').select(['status', 'deleted_at']).where('branch_id', '=', B3).where('ticket_id', '=', TK_B3).executeTakeFirst();
    ok('expired task is soft-deleted with status=expired', expiredRow?.status === 'expired' && !!expiredRow?.deleted_at);
    // a task the tech already handled (here: sent, then replied by the customer) is never expired, even if old
    await k.updateTable('service_follow_up_tasks').set({ created_at: sql`now() - interval '48 hours'` } as any).where('id', '=', oliviaAcrylic.id).execute();
    await svc.expireStaleTasks(realNow);
    const acr: any = await k.selectFrom('service_follow_up_tasks').select(['status', 'deleted_at']).where('id', '=', oliviaAcrylic.id).executeTakeFirst();
    ok('an old, already-handled task is never auto-expired', acr?.status === 'customer_replied' && !acr?.deleted_at, `status=${acr?.status} deleted=${!!acr?.deleted_at}`);
    // disabling the window (0) prevents expiry; re-enabling resumes it
    const STALE_LINE = '00000000-0000-0000-0000-0000000f00b3';
    await k.insertInto('service_follow_up_tasks').values({
      tenant_id: T1, branch_id: B3, business_date: D2, customer_id: CR_B3, technician_id: TE_B3, ticket_id: TK_B3,
      ticket_service_line_id: STALE_LINE, service_name_snapshot: 'Stale Svc', customer_name_snapshot: 'Bob Cee',
      technician_name_snapshot: 'Bea Ng', suggested_message: 'x', status: 'pending', created_at: sql`now() - interval '30 hours'`,
    } as any).execute();
    await svc.saveSettings(mgrB3, { autoExpirePendingHours: 0 });
    await svc.expireStaleTasks(realNow);
    ok('auto-expire OFF (0h) keeps even a 30h-old pending task', (await cntTasks({ branch_id: B3 })) === 1, String(await cntTasks({ branch_id: B3 })));
    await svc.saveSettings(mgrB3, { autoExpirePendingHours: 24 });
    await svc.expireStaleTasks(realNow);
    ok('re-enabling auto-expire removes the stale task', (await cntTasks({ branch_id: B3 })) === 0, String(await cntTasks({ branch_id: B3 })));

    // ===== stage-2 hard purge of long-expired tasks =====
    const totalB3 = async () => { const r: any = await k.selectFrom('service_follow_up_tasks').select(k.fn.countAll<string>().as('n')).where('branch_id', '=', B3).executeTakeFirst(); return Number(r.n); };
    const beforePurge = await totalB3(); // expired rows are soft-deleted but still physically present
    ok('expired rows still physically exist before purge', beforePurge >= 1, `rows=${beforePurge}`);
    await svc.purgeExpiredTasks(realNow, 30);
    ok('recently-expired tasks are kept within the 30-day retention', (await totalB3()) === beforePurge, `rows=${await totalB3()}`);
    // age the soft-deletions past retention → hard-purged
    await k.updateTable('service_follow_up_tasks').set({ deleted_at: sql`now() - interval '31 days'` } as any).where('branch_id', '=', B3).where('status', '=', 'expired').execute();
    const purged = await svc.purgeExpiredTasks(realNow, 30);
    ok('tasks soft-deleted beyond retention are hard-purged', purged.purged >= 1, `purged=${purged.purged}`);
    ok('purged rows are physically gone from the database', (await totalB3()) === 0, `rows=${await totalB3()}`);
    // purge disabled (0 days) is a no-op even for very old rows
    await k.insertInto('service_follow_up_tasks').values({
      tenant_id: T1, branch_id: B3, business_date: D2, customer_id: CR_B3, technician_id: TE_B3, ticket_id: TK_B3,
      ticket_service_line_id: '00000000-0000-0000-0000-0000000f00c3', service_name_snapshot: 'Old', customer_name_snapshot: 'Bob Cee',
      technician_name_snapshot: 'Bea Ng', suggested_message: 'x', status: 'expired', deleted_at: sql`now() - interval '90 days'`,
    } as any).execute();
    await svc.purgeExpiredTasks(realNow, 0);
    ok('purge disabled (0) keeps even very old expired rows', (await totalB3()) === 1, `rows=${await totalB3()}`);

    // ===== generation run + notification bookkeeping =====
    const run: any = await k.selectFrom('daily_follow_up_generation_runs').selectAll().where('branch_id', '=', B1).where('business_date', '=', D1).executeTakeFirst();
    ok('a completed generation run is recorded for B1/D1', !!run && run.run_status === 'completed');
    const techNotif: any = await k.selectFrom('technician_notifications').select('id').where('technician_id', '=', TE_LINH).where('type', '=', 'daily_followup_ready').executeTakeFirst();
    ok('technician received a "list ready" notification', !!techNotif);

    // ===== realtime emits fire on generate / send (fake emitter records rooms+events) =====
    const emitLog: { kind: string; room: string; event: string }[] = [];
    const fakeEmitter: any = {
      toTenant: (c: any, event: string) => emitLog.push({ kind: 'tenant', room: `${c.tenantId}:${c.branchId}`, event }),
      toTechnician: (id: string, event: string) => emitLog.push({ kind: 'tech', room: id, event }),
      toCustomer: (id: string, event: string) => emitLog.push({ kind: 'customer', room: id, event }),
      toTicket: () => {}, toCustomerDisplay: () => {}, toOwner: () => {},
    };
    const svcRT = new DailyFollowUpService(new KyselyDailyFollowUpRepository(k), fakeEmitter);
    const mgrB4 = C(T1, B4, U_MGR, 'OWNER');
    const genRT = await svcRT.generateForBranch(T1, B4, { now: NOW_AFTER, triggerSource: 'manual' });
    ok('generation emits daily_follow_up_tasks_created to the branch room', emitLog.some((e) => e.kind === 'tenant' && e.room === `${T1}:${B4}` && e.event === 'daily_follow_up_tasks_created'), `created=${genRT.created}`);
    ok('generation emits to the affected technician room', emitLog.some((e) => e.kind === 'tech' && e.room === TE_B4 && e.event === 'daily_follow_up_tasks_created'));
    const b4Task = (await svcRT.managerList(mgrB4, {})).tasks.find((t) => t.serviceName === 'Gel Fill')!;
    emitLog.length = 0;
    await svcRT.managerSend(mgrB4, b4Task.id);
    ok('send emits follow_up_task_updated to the branch room', emitLog.some((e) => e.kind === 'tenant' && e.room === `${T1}:${B4}` && e.event === 'follow_up_task_updated'));
    ok('send emits customer_follow_up_received to the customer room only', emitLog.some((e) => e.kind === 'customer' && e.room === CR_B4 && e.event === 'customer_follow_up_received'));

  } catch (e: any) {
    ok('harness completed without throwing', false, e?.stack || e?.message || String(e));
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
