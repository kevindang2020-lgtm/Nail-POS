// extra.mjs — the Discounts part of the catalog harness (Oct 29 2026; Membership runs on the customers harness, which
// already seeds memberships: SERVER=tooling/customers-one-screen/live-server.mjs). Seeds the photo's coupon (••••NG20, 20 %
// off, $10 minimum, no end date, 0 used, Active) plus enough coupons and confirmed redemptions to page every list, and
// serves the REAL DiscountsScreenController (routes read from its decorators). Fixtures only — no real customer or code.
import { hashCode, codeHint } from '../../modules/deals/src/engine/coupons.ts';
import { DiscountsScreenController, DiscountsScreenRepository } from '../../modules/deals/src/salon-promotions/discounts-screen.ts';
import { PILOT, BRANCH, BRANCH2, OTHER, BRANCH_O, OWNER_USER, TECH, id } from './seed.mjs';
import { CatalogScreensController } from '../../modules/catalog/src/catalog-screens/catalog-screens.controller.ts';
import { CatalogScreensRepository } from '../../modules/catalog/src/catalog-screens/catalog-screens.repository.ts';
import { ServicesController } from '../../modules/catalog/src/services/services.controller.ts';
import { ServicesService } from '../../modules/catalog/src/services/services.service.ts';
import { KyselyServicesRepository } from '../../modules/catalog/src/services/services.kysely.repository.ts';
import { BundlesController } from '../../modules/deals/src/bundles/bundles.controller.ts';
import { BundlesService } from '../../modules/deals/src/bundles/bundles.service.ts';
import { teamSeed, teamRoutes } from './team-extra.mjs';
import { commsSeed, commsRoutes, commsSql } from './comms-extra.mjs';
import { aiUsageSeed, aiUsageRoutes, aiUsageSql } from './aiusage-extra.mjs';
import { healthSeed, healthRoutes, healthSql } from './health-extra.mjs';
import { inboxSeed, inboxRoutes, inboxSql } from './inbox-extra.mjs';
import { InMemoryBundlesRepository } from '../../modules/deals/src/bundles/bundles.repository.ts';

export async function extraSeed(pg, db) {
  const q = (s, p = []) => pg.query(s, p);
  const CAT = id('d1970000', 1);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, PILOT, BRANCH]);
  const SVC = { gel: id('d2970000', 1), pedi: id('d2970000', 2) };
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$3,$4,$5,'Gel Manicure',45,4500), ($2,$3,$4,$5,'Spa Pedicure',50,5500)`, [SVC.gel, SVC.pedi, PILOT, BRANCH, CAT]);
  const NAMES = ['Mai Le', 'mai le', 'Tina Vo', 'Ana Ho', 'Kim Do', 'Lan Nguyen', 'Rosa Tran', 'Jenny Pham', 'Linh Bui', 'Hoa Dang', 'Vy Ngo', 'Thu Lam'];
  const cust = [];
  for (let i = 0; i < NAMES.length; i++) {
    const cid = id('d3970000', i + 1); const [f, l] = NAMES[i].split(' '); const ph = `856555${String(1200 + i).padStart(4, '0')}`;
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [cid, PILOT, BRANCH, f, l, NAMES[i], '+1' + ph, `(${ph.slice(0, 3)}) ${ph.slice(3, 6)}-${ph.slice(6)}`]);
    cust.push(cid);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Elsewhere','Mai Elsewhere','+18565551200')`, [id('d3970000', 99), OTHER, BRANCH_O]);
  let n = 0;
  const coupon = async (code, f) => {
    const did = id('d4970000', ++n);
    await q(`insert into deals (id, tenant_id, branch_id, owner_type, kind, title, short_description, discount_type, discount_percent, discount_cents, min_spend_cents, status, starts_at, ends_at, max_redemptions, redemption_count, max_discount_cents, max_per_customer, stackable, requires_code, created_by_user_id, created_at, updated_at)
      values ($1,$2,null,'salon','coupon',$3,$4,$5,$6,$7,$8,$9, ${f.starts ?? 'null'}, ${f.ends ?? 'null'}, $10, $11, $12, $13, true, true, $14, now() - make_interval(days => $15), now() - make_interval(days => $15))`,
    [did, f.tenant ?? PILOT, f.title, f.desc ?? null, f.type ?? 'percent', (f.type ?? 'percent') === 'percent' ? f.pct ?? 10 : null, f.type === 'fixed' ? f.cents : null, f.min ?? null, f.status ?? 'active', f.max ?? null, f.count ?? 0, f.cap ?? null, f.perCustomer ?? null, OWNER_USER, f.days ?? n]);
    await q(`insert into deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, status) values ($1,$2,$3,$4,'active')`, [f.tenant ?? PILOT, did, hashCode(f.tenant ?? PILOT, code), codeHint(code)]);
    await q(`insert into deal_versions (deal_id, tenant_id, version, terms, changed_by_user_id) values ($1,$2,1,$3::jsonb,$4)`, [did, f.tenant ?? PILOT, JSON.stringify({ title: f.title, discountType: f.type ?? 'percent', discountPercent: f.pct ?? null, discountCents: f.cents ?? null, minSpendCents: f.min ?? null }), OWNER_USER]);
    return did;
  };
  // the photo's coupon: masked ••••NG20 · 20 % off · $20.00 on $100 · $10.00 minimum · No end date · 0 used · Active
  const photo = await coupon('SPRING20', { title: 'Spring Glow', desc: '20% off any service', pct: 20, min: 1000, days: 0 });
  const pedi = await coupon('PEDI15', { title: 'Pedicure Week', pct: 15, ends: "now() + interval '4 days'", max: 50, count: 9, perCustomer: 1, days: 12 });
  const five = await coupon('FIVEOFF', { title: 'Five Dollars Off', type: 'fixed', cents: 500, min: 3000, count: 4, days: 20 });
  const sched = await coupon('HOLIDAY25', { title: 'Holiday Treat', pct: 25, starts: "now() + interval '10 days'", ends: "now() + interval '40 days'", days: 2 });
  await coupon('WINTER10', { title: 'Winter Ten', pct: 10, status: 'paused', days: 30 });
  await coupon('SUMMER30', { title: 'Summer Splash', pct: 30, ends: "now() - interval '20 days'", days: 120 });
  const vip = await coupon('VIP50', { title: 'VIP Half Off', pct: 50, max: 3, count: 3, cap: 3000, days: 60 });
  await coupon('BIG25OFF', { title: 'Big Spender', type: 'fixed', cents: 2500, min: 15000, days: 25 });
  await coupon('DRAFT05', { title: 'Next Month Draft', pct: 5, status: 'draft', days: 1 });
  for (let i = 0; i < 10; i++) await coupon(`PROMO${i}A${i}`, { title: `Referral Reward ${i + 1}`, type: i % 2 ? 'fixed' : 'percent', pct: 10 + i, cents: 300 + i * 100, days: 40 + i });
  await q(`insert into deal_services (deal_id, service_id, tenant_id) values ($1,$2,$3)`, [pedi, SVC.pedi, PILOT]);
  await coupon('SPRING20', { tenant: OTHER, title: 'Other Salon Spring', pct: 20 });
  // tickets + the ledger: confirmed (paid), one applied to an unpaid ticket, one reversed by a refund
  const ticket = async (k, c, sub, total, status = 'paid') => { const tid = id('d5970000', k); await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, subtotal_cents, total_cents, status, primary_technician_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tid, PILOT, BRANCH, c, 3000 + k, sub, total, status, TECH.anna]); return tid; };
  let r = 0;
  const red = async (deal, c, cents, status, hoursAgo, sub = 6000) => {
    const tid = await ticket(r + 1, c, sub, sub - cents, status === 'applied' ? 'ready_checkout' : 'paid');
    await q(`insert into deal_redemptions (id, deal_id, tenant_id, branch_id, customer_id, ticket_id, technician_id, amount_discounted_cents, deal_version, status, kind, applied_by_user_id, applied_at, redeemed_at, reversed_at, reversed_cents, reversal_reason, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'coupon',$10, now() - make_interval(hours => $11), ${status === 'applied' ? 'null' : 'now() - make_interval(hours => $11)'}, ${status === 'reversed' ? 'now() - make_interval(hours => $11) + interval \'1 hour\'' : 'null'}, ${status === 'reversed' ? cents : 0}, ${status === 'reversed' ? "'refund'" : 'null'}, now() - make_interval(hours => $11))`,
    [id('d6970000', ++r), deal, PILOT, BRANCH, c, tid, TECH.anna, cents, status, OWNER_USER, hoursAgo]);
  };
  for (let i = 0; i < 9; i++) await red(pedi, cust[i % cust.length], 825, 'redeemed', 3 + i * 20, 5500);
  for (let i = 0; i < 4; i++) await red(five, cust[(i + 4) % cust.length], 500, 'redeemed', 30 + i * 50, 4500);
  for (let i = 0; i < 3; i++) await red(vip, cust[(i + 7) % cust.length], 3000, 'redeemed', 200 + i * 30, 8000);   // capped at $30 of 50 %
  await red(five, cust[1], 500, 'applied', 1, 4500);
  await red(pedi, cust[2], 825, 'reversed', 400, 5500);
  return { coupons: n, redemptions: r, photoCoupon: photo, scheduled: sched, ...(await catalogSeed(pg, cust)), ...(await teamSeed(pg)), ...(await commsSeed(pg, db)), ...(await aiUsageSeed(pg)), ...(await healthSeed(db)), ...(await inboxSeed(pg)) };
}

/** Services & Products · Categories · Pricing · Add-Ons (Oct 30 2026): reshape the services the other seeds made into the
 *  photo's catalog — 6 services ($398 → average $66.33, lowest $45, highest $150), categories Nails 4 · CD 4432 1 · CD 6805 1,
 *  "French tips" ($10, +10 min, taxable) on Gel Manicure, Classic Pedicure, Haircut and Hair Coloring (4 offerings of ONE
 *  add-on) — plus Voorhees' own Gel Manicure at $60 (the branch panel), and paid tickets with service, add-on and retail lines
 *  so the realized KPIs and charts have something true to show. Fixtures only. */
async function catalogSeed(pg, cust) {
  const q = (s, p = []) => pg.query(s, p);
  const NAILS = id('c6970000', 1), CD4432 = id('d1970000', 1), CD6805 = id('d1970000', 2);
  const GEL = id('c7970000', 1), PEDI = id('c7970000', 2), CUT = id('c7970000', 3), M4432 = id('d2970000', 1), SPA = id('d2970000', 2), COLOR = id('d2970000', 3), M6805 = id('d2970000', 4);
  await q(`update service_categories set name = 'CD 4432', sort_order = 2 where id = $1`, [CD4432]);
  await q(`update service_categories set sort_order = 1 where id = $1`, [NAILS]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values ($1,$2,$3,'CD 6805',3)`, [CD6805, PILOT, BRANCH]);
  const set = (sid, cat, name, mins, cents, days, online = true) => q(`update services set category_id = $2, name = $3, duration_minutes = $4, price_cents = $5, status = 'active', online_booking_enabled = $6,
    created_at = now() - make_interval(days => $7), updated_at = now() - make_interval(days => $7) where id = $1`, [sid, cat, name, mins, cents, online, days]);
  await set(GEL, NAILS, 'Gel Manicure', 45, 5500, 60); await set(PEDI, NAILS, 'Classic Pedicure', 50, 4800, 50); await set(CUT, NAILS, 'Haircut', 30, 4500, 20, false);
  await set(M4432, CD4432, 'CD Mani 4432', 30, 5000, 40);
  await q(`update services set status = 'archived', archived_at = now() - interval '5 days' where id = $1`, [SPA]);   // the discounts seed's Spa Pedicure, retired
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, online_booking_enabled, created_at, updated_at) values
    ($1,$3,$4,$5,'Hair Coloring',120,15000,'active',true, now() - interval '10 days', now() - interval '10 days'), ($2,$3,$4,$6,'CD Mani 6805',30,5000,'active',true, now() - interval '30 days', now() - interval '30 days')`, [COLOR, M6805, PILOT, BRANCH, NAILS, CD6805]);
  // Voorhees keeps its own rows (services.branch_id is required): its Gel Manicure is $60
  const VN = id('d1970000', 9);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [VN, PILOT, BRANCH2]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,6000,'active')`, [id('d2970000', 9), PILOT, BRANCH2, VN]);
  for (const sid of [GEL, PEDI, CUT, COLOR]) await q(`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active) values ($1,$2,$3,'ao_french','French tips',1000,10,true,true)`, [PILOT, BRANCH, sid]);
  for (const [tech, sid, primary] of [[TECH.anna, GEL, true], [TECH.bao, GEL, false], [TECH.anna, PEDI, true], [TECH.chi, CUT, true]]) await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,$5)`, [PILOT, BRANCH, tech, sid, primary]);
  // paid tickets: service · add-on · retail lines (the realized-sales ledger); one open ticket that must not count
  const T = [[GEL, 'Gel Manicure', 5500, true, true, 1], [PEDI, 'Classic Pedicure', 4800, true, false, 2], [COLOR, 'Hair Coloring', 15000, false, false, 3], [GEL, 'Gel Manicure', 5500, true, false, 26],
    [M4432, 'CD Mani 4432', 5000, false, true, 4], [CUT, 'Haircut', 4500, true, false, 6], [GEL, 'Gel Manicure', 5500, false, false, 8], [PEDI, 'Classic Pedicure', 4800, false, true, 0]];
  let k = 0;
  for (const [sid, name, cents, addOn, retail, daysAgo] of T) {
    const tid = id('d8970000', ++k); const cat = sid === M4432 ? 'CD 4432' : 'Nails';
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, paid_at, subtotal_cents, total_cents, primary_technician_id) values ($1,$2,$3,$4,$5,'paid', now() - make_interval(days => $6) - interval '1 minute', $7, $7, $8)`,
      [tid, PILOT, BRANCH, cust[k % cust.length], 4100 + k, daysAgo, cents, TECH.anna]);
    const line = (lsid, lname, lcat, lc, kind, isAdd, m) => q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, category_snapshot, is_add_on, line_kind, quantity, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11,1,'done')`, [PILOT, BRANCH, tid, lsid ?? '00000000-0000-0000-0000-000000000000', TECH.anna, lname, lc, m, lcat, isAdd, kind]);
    await line(sid, name, cat, cents, 'service', false, 45);
    if (addOn) await line(null, 'French tips', 'Nails', 1000, 'add_on', true, 10);
    if (retail) await line(null, k % 2 ? 'Cuticle Oil' : 'Hand Cream', null, k % 2 ? 1200 : 1800, 'retail', false, 0);
  }
  const open = id('d8970000', 99);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, subtotal_cents, total_cents) values ($1,$2,$3,$4,4199,'in_service',5500,5500)`, [open, PILOT, BRANCH, cust[0]]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, category_snapshot, is_add_on, line_kind, quantity, status) values ($1,$2,$3,$4,'Gel Manicure',5500,45,5500,'Nails',false,'service',1,'in_progress')`, [PILOT, BRANCH, open, GEL]);
  // the other salon's look-alike (never shows)
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d1970000', 8), OTHER, BRANCH_O]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,9900)`, [id('d2970000', 8), OTHER, BRANCH_O, id('d1970000', 8)]);
  return { catalogServices: 6, catalogTickets: k };
}

export const extra = {
  routes: (db, routesOf) => [
    ...routesOf('modules/deals/src/salon-promotions/discounts-screen.ts', '/pos/discounts', new DiscountsScreenController(new DiscountsScreenRepository(db))),
    ...routesOf('modules/catalog/src/catalog-screens/catalog-screens.controller.ts', '/pos/catalog', new CatalogScreensController(new CatalogScreensRepository(db))),
    ...routesOf('modules/catalog/src/services/services.controller.ts', '/pos/services', new ServicesController(new ServicesService(new KyselyServicesRepository(db)))),
    ...teamRoutes(db, routesOf),
    ...commsRoutes(db, routesOf),   // Phone & Messaging (comms-extra.mjs — a fake Twilio, never the network)
    ...aiUsageRoutes(db, routesOf),   // AI Usage & Limits (aiusage-extra.mjs — fixtures, no billing)
    ...inboxRoutes(db, routesOf),     // SMS Inbox (inbox-extra.mjs — real inbox + messenger + signed webhook, fake Twilio only)
    ...healthRoutes(db, routesOf),    // Setup Health (health-extra.mjs — reads the other sections' fixtures, no fakes of its own)
    ...routesOf('modules/deals/src/bundles/bundles.controller.ts', '/pos/bundles', new BundlesController(new BundlesService(new InMemoryBundlesRepository()))),
  ],
  // harness-only stand-ins, said so: AI menu insights (an LLM-backed module, not served here) answer "not enough data"; bundles
  // run on the module's in-memory adapter because the test database's Kysely stand-in has no query builder.
  route: (method, path) => (method === 'GET' && path === '/pos/menu-insights' ? { status: 200, body: { hasEnoughData: false, insights: [], coverage: {} } } : undefined),
  sql: (T, a) => ({ ...commsSql(T), ...aiUsageSql(T), ...healthSql(T), ...inboxSql(T), deals: [`select title, status, redemption_count from deals where tenant_id = $1 and kind = 'coupon' order by created_at desc`, [T]],
    services: [`select id, name, price_cents, duration_minutes, status, category_id from services where tenant_id = $1 order by created_at desc`, [T]],
    changes: [`select entity_type, field, old_value, new_value, reason, source from catalog_change_log where tenant_id = $1 order by changed_at desc limit 20`, [T]],
    addons: [`select add_on_key, name, service_id, price_cents, is_active from service_add_ons where tenant_id = $1 order by created_at desc`, [T]],
    bundles: [`select name, kind, price_cents, status from bundles where tenant_id = $1 order by created_at desc`, [T]] }),
};
