// catalog-screens.pgtest — Services & Products · Service Categories · Service Pricing · Add-Ons (Oct 30 2026) against the
// REAL schema, seeded with the photographed catalog: six services (Gel Manicure 45m $55 · Classic Pedicure 50m $48 ·
// CD Mani 4432 30m $50 · CD Mani 6805 30m $50 · Haircut 30m $45 · Hair Coloring 120m $150), categories Nails 4 / CD 4432 1 /
// CD 6805 1, and "French tips" ($10, +10m, taxable) offered on Gel Manicure, Classic Pedicure, Haircut and Hair Coloring.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CatalogScreensRepository } from './catalog-screens.repository';
import { KyselyServicesRepository } from '../services/services.kysely.repository';

const P = 'ca7a0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.services.view'] };
const ctxAll = { ...ctx, branchId: '' };
const ctx2 = { ...ctx, tenantId: T2, branchId: BX };
const NAILS = id('c1'), CD4432 = id('c2'), CD6805 = id('c3'), EMPTY = id('c4');
const GEL = id('d1'), PEDI = id('d2'), M4432 = id('d3'), M6805 = id('d4'), CUT = id('d5'), COLOR = id('d6'), OLD = id('d7');
let pg: any; let repo: CatalogScreensRepository; let svcRepo: KyselyServicesRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','cat-a','CTA001','active'), ($2,'Other LLC','Other','cat-b','CTB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, created_at) values ($1,$3,'Main','active','America/New_York', now() - interval '2 days'), ($2,$3,'Uptown','active','America/New_York', now() - interval '1 day'), ($4,$5,'Elsewhere','active','America/New_York', now())`, [B, B2, T, BX, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'owner@cat.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status, sort_order, created_at) values ($1,$5,$6,'Nails','active',1, now() - interval '30 days'), ($2,$5,$6,'CD 4432','active',2, now() - interval '20 days'),
    ($3,$5,$6,'CD 6805','active',3, now() - interval '10 days'), ($4,$5,$6,'Brows','active',4, now() - interval '1 day')`, [NAILS, CD4432, CD6805, EMPTY, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$2,$3,'Other Nails','active')`, [id('c9'), T2, BX]);
  const svc = (sid: string, cat: string, name: string, mins: number, cents: number, daysAgo: number, extra = '') =>
    q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, online_booking_enabled, commission_type, commission_value, created_at ${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1,$2,$8,$3,$4,$5,$6,'active', true, 'percent', 40, now() - make_interval(days => $7) ${extra ? ', ' + extra.split('=')[1] : ''})`, [sid, T, cat, name, mins, cents, daysAgo, B]);
  await svc(GEL, NAILS, 'Gel Manicure', 45, 5500, 6); await svc(PEDI, NAILS, 'Classic Pedicure', 50, 4800, 5); await svc(M4432, CD4432, 'CD Mani 4432', 30, 5000, 4);
  await svc(M6805, CD6805, 'CD Mani 6805', 30, 5000, 3); await svc(CUT, NAILS, 'Haircut', 30, 4500, 2); await svc(COLOR, NAILS, 'Hair Coloring', 120, 15000, 1);
  await q(`update services set online_booking_enabled = false where id = $1`, [COLOR]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values ($1,$2,$3,$4,'Old Polish Change',15,1500,'archived', now())`, [OLD, T, B2, NAILS]);
  // Uptown's own Gel Manicure row: the same service at another branch, at its own price
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,6000,'active')`, [id('d8'), T, B2, NAILS]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,9900,'active')`, [id('d9'), T2, BX, id('c9')]);
  for (const s of [GEL, PEDI, CUT, COLOR]) await q(`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active) values ($1,$3,$2,'ao_french','French tips',1000,10,true,true)`, [T, s, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Vy','Tran','Vy Tran','active',true)`, [id('f1'), T, B]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, id('f1'), GEL]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551234','(856) 555-1234')`, [id('aa1'), T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Other','Mai Other','+18565551234')`, [id('aa9'), T2, BX]);
  // ticket 1 (paid today): Gel Manicure $55 + French tips $10 + a $12 retail item · ticket 2 (paid): Classic Pedicure · ticket 3: open
  const tk = (tid: string, num: number, paid: boolean, tenant = T, br = B, cust = id('aa1')) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, paid_at, subtotal_cents, total_cents) values ($1,$2,$3,$4,$5,$6, ${paid ? 'now()' : 'null'}, 0, 0)`, [tid, tenant, br, cust, num, paid ? 'paid' : 'in_service']);
  await tk(id('7a1'), 101, true); await tk(id('7a2'), 102, true); await tk(id('7a3'), 103, false); await tk(id('7a9'), 101, true, T2, BX, id('aa9'));
  const line = (tid: string, sid: string | null, name: string, cat: string | null, cents: number, kind: string, addOn = false, tenant = T, br = B) =>
    q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, category_snapshot, is_add_on, line_kind, quantity, status)
       values ($1,$2,$3,$4,$5,$6,$7,45,$7,$8,$9,$10,1,'done')`, [tenant, br, tid, sid ?? '00000000-0000-0000-0000-000000000000', tenant === T ? id('f1') : null, name, cents, cat, addOn, kind]);
  await line(id('7a1'), GEL, 'Gel Manicure', 'Nails', 5500, 'service'); await line(id('7a1'), null, 'French tips', 'Nails', 1000, 'add_on', true); await line(id('7a1'), null, 'Cuticle Oil', null, 1200, 'retail');
  await line(id('7a2'), PEDI, 'Classic Pedicure', 'Nails', 4800, 'service'); await line(id('7a3'), GEL, 'Gel Manicure', 'Nails', 5500, 'service');
  await line(id('7a9'), id('d9'), 'Gel Manicure', 'Other Nails', 9900, 'service', false, T2, BX);
  const db = kyselyFor(pg); repo = new CatalogScreensRepository(db as never); svcRepo = new KyselyServicesRepository(db as never);
}, 180_000);

describe('Services & Products — the ten KPIs and four charts', () => {
  it('counts the catalog once, prices from active priced services, revenue only from paid tickets', async () => {
    const d = await repo.dashboard(ctx, { preset: 'month' });
    expect(d.kpis).toMatchObject({ totalServices: 6, activeServices: 6, onlineBookable: 5, avgServicePriceCents: 6633, pricedServices: 6 });   // $398 / 6 = $66.33
    expect(d.kpis.retailRevenueTodayCents).toBe(1200);
    expect(d.kpis).toMatchObject({ topCategory: 'Nails', topCategoryBasis: 'realized', topCategoryCents: 10300 });   // 55 + 48 (the open ticket is not revenue)
    expect(d.kpis).toMatchObject({ addOnConversionPct: 50, addOnTickets: 1, serviceTickets: 2, serviceMixMargin: null, packageSales: null });
    const c = await repo.charts(ctx, { preset: 'month' });
    expect(c.serviceMix.map((x) => [x.label, x.cents])).toEqual([['Gel Manicure', 5500], ['Classic Pedicure', 4800]]);
    expect(c.retailMix).toEqual([{ label: 'Cuticle Oil', cents: 1200, count: 1 }]);
    expect(c.categoryRevenue).toEqual([{ label: 'Nails', cents: 10300, count: 2 }]);
    expect((await repo.dashboard(ctx2, {})).kpis.totalServices).toBe(1);
  });
});

describe('Service Menu / Service Pricing list', () => {
  it('newest first, one search box (name exact first, category, $ price, minutes, id), filters, paging', async () => {
    const l = await repo.services(ctx, { page: 1, pageSize: 4 });
    expect(l.items.map((x) => x.name)).toEqual(['Hair Coloring', 'Haircut', 'CD Mani 6805', 'CD Mani 4432']);
    expect(l.totalItems).toBe(6); expect(l.totalPages).toBe(2); expect(l.stats).toMatchObject({ averagePriceCents: 6633, lowestPriceCents: 4500, highestPriceCents: 15000, priceSumCents: 39800 });
    expect((await repo.services(ctx, { page: 9, pageSize: 4 })).page).toBe(2);
    const gel = await repo.services(ctx, { q: 'gel manicure', page: 1, pageSize: 10 });
    expect(gel.items[0]).toMatchObject({ name: 'Gel Manicure', matchedVia: 'name_exact', durationMinutes: 45, priceCents: 5500, addOns: 1, qualifiedTechnicians: 1, sold30d: 1 });
    expect((await repo.services(ctx, { q: '$50', page: 1, pageSize: 10 })).items.map((x) => x.name).sort()).toEqual(['CD Mani 4432', 'CD Mani 6805']);
    expect((await repo.services(ctx, { q: '50 min', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Classic Pedicure']);
    expect((await repo.services(ctx, { q: 'cd 6805', page: 1, pageSize: 10 })).totalItems).toBe(1);
    expect((await repo.services(ctx, { q: GEL, page: 1, pageSize: 10 })).items[0]!.matchedVia).toBe('id');
    // the technician scope: services an active qualified technician of that name performs (never another salon's)
    expect((await repo.services(ctx, { technician: 'vy tr', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Gel Manicure']);
    expect((await repo.services(ctx, { technician: 'nobody', page: 1, pageSize: 10 })).totalItems).toBe(0);
    expect((await repo.services(ctx, { categoryId: NAILS, page: 1, pageSize: 10 })).totalItems).toBe(4);
    expect((await repo.services(ctx, { status: 'archived', page: 1, pageSize: 10 })).totalItems).toBe(0);   // the archived one belongs to the Uptown branch
    expect((await repo.services(ctxAll, { status: 'archived', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Old Polish Change']);
    expect((await repo.services(ctx, { minPrice: 5000, maxPrice: 5500, sort: 'price_asc', page: 1, pageSize: 10 })).items.map((x) => x.priceCents)).toEqual([5000, 5000, 5500]);
    expect((await repo.services(ctx2, { q: 'gel', page: 1, pageSize: 10 })).items.map((x) => x.priceCents)).toEqual([9900]);
  });

  it('Service Detail: add-ons, qualified technician, where it is offered (salon-wide = every branch), sales', async () => {
    const d = await repo.serviceDetail(ctxAll, GEL);
    expect(d.addOns).toEqual([{ key: 'ao_french', name: 'French tips', priceCents: 1000, durationMinutes: 10, taxable: true, active: true, source: 'offering' }]);
    expect(d.technicians.map((t) => t.name)).toEqual(['Vy Tran']);
    expect(d.branches.map((b) => [b.name, b.current, b.offered, b.priceCents, b.differsFromThis])).toEqual([['Main', true, true, 5500, false], ['Uptown', false, true, 6000, true]]);
    expect(d.sales90d).toMatchObject({ lines: 1, cents: 5500, lastChargedCents: 5500 });
    await expect(repo.serviceDetail(ctx, id('d9'))).rejects.toThrow(/not found/i);
    expect(d.salonDefault).toEqual({ source: 'none' });                                   // no template behind it → said so, never invented
  });
  it('SERVICES PRODUCTS 2 · 06 (round 10): the salon-wide default beside the branches is the platform template a branch row was copied from', async () => {
    const tplId = '9b3c0000-0000-4000-8000-000000000001';
    await q(`insert into service_templates (id, code, name, suggested_duration_minutes, suggested_price_min_cents, suggested_price_max_cents, status) values ($1, 'gel-950', 'Gel Manicure (template)', 45, 5000, 6500, 'published')`, [tplId]);
    await q(`insert into service_template_deployments (template_id, tenant_id, copied_service_id) values ($1, $2, $3)`, [tplId, T, GEL]);
    const d = await repo.serviceDetail(ctxAll, GEL);
    expect(d.salonDefault).toMatchObject({ source: 'platform_template', templateName: 'Gel Manicure (template)', durationMinutes: 45, priceMinCents: 5000, priceMaxCents: 6500 });
    const other = await repo.serviceDetail(ctx2, (await repo.services(ctx2, { q: 'gel', page: 1, pageSize: 10 })).items[0]!.serviceId);
    expect(other.salonDefault).toEqual({ source: 'none' });                               // another salon never sees this deployment
  });
});

describe('Service Pricing — audited edits and history', () => {
  it('a price change needs a reason, refuses a stale edit, writes an append-only history row; the Services edit path writes history too', async () => {
    await expect(repo.updatePricing(ctx, GEL, { priceCents: 6000 })).rejects.toThrow(/why/);
    await expect(repo.updatePricing(ctx, GEL, { priceCents: 6000, reason: 'x', expectedUpdatedAt: '2001-01-01T00:00:00.000Z' })).rejects.toThrow(/Someone else/);
    const cur = await repo.serviceDetail(ctx, GEL);
    const r = await repo.updatePricing(ctx, GEL, { priceCents: 6000, reason: 'Gel prices up', expectedUpdatedAt: cur.updatedAt });
    expect(r.changed).toBe(1);
    expect((await repo.updatePricing(ctx, GEL, { priceCents: 6000, reason: 'again' })).changed).toBe(0);
    // the Services screen's own edit path (KyselyServicesRepository.update). Its final read-back uses the query builder, which
    // this raw-SQL stand-in does not provide — the write and its history rows (what is under test) happen before it.
    await svcRepo.update(ctx as never, PEDI, { durationMinutes: 55, priceCents: 4800 } as never).catch((e: Error) => { if (!/query builder/.test(e.message)) throw e; });
    expect(Number((await q(`select duration_minutes from services where id = $1`, [PEDI])).rows[0].duration_minutes)).toBe(55);
    const h = await repo.history(ctx, { field: 'pricing', page: 1, pageSize: 10 });
    expect(h.items.map((x) => [x.serviceName, x.field, x.oldValue, x.newValue])).toEqual([['Classic Pedicure', 'duration_minutes', '50', '55'], ['Gel Manicure', 'price_cents', '5500', '6000']]);
    expect(h.items[1]).toMatchObject({ reason: 'Gel prices up', actor: 'Pat Owner', source: 'pricing_editor' });
    expect((await repo.history(ctx, { q: '$60', page: 1, pageSize: 10 })).totalItems).toBe(1);
    // D3: Uptown's manager does not see Main's price changes; the all-locations view does
    expect((await repo.history({ ...ctx, branchId: B2 }, { field: 'pricing', page: 1, pageSize: 10 })).totalItems).toBe(0);
    expect((await repo.history(ctxAll, { field: 'pricing', page: 1, pageSize: 10 })).totalItems).toBe(2);
    await expect(q(`update catalog_change_log set new_value = '1'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from catalog_change_log`)).rejects.toThrow(/append-only/);
    // the completed ticket keeps what it was charged
    expect(Number((await q(`select price_cents_snapshot from ticket_service_lines where ticket_id = $1 and service_id = $2`, [id('7a1'), GEL])).rows[0].price_cents_snapshot)).toBe(5500);
    expect((await repo.history(ctx2, { page: 1, pageSize: 10 })).totalItems).toBe(0);
  });

  it('SERVICE PRICING 16: the services export reports each service\'s own Taxable flag (it said yes for every row)', async () => {
    await q(`update services set is_taxable = false where id = $1`, [CUT]);
    const { headers, rows } = await svcRepo.exportRows(ctx as never, {} as never);
    const ti = headers.indexOf('Taxable'), ni = headers.indexOf('Name');
    const by = Object.fromEntries(rows.map((r) => [String(r[ni]), r[ti]]));
    expect(by['Haircut']).toBe('no');
    expect(by['Gel Manicure']).toBe('yes');
    await q(`update services set is_taxable = true where id = $1`, [CUT]);
  });
  it('customer history: phone in any format, name, ticket number → the charged snapshot; never a list of everyone', async () => {
    expect((await repo.customerHistory(ctx, { q: '' })).needsQuery).toBe(true);
    for (const p of ['8565551234', '(856) 555-1234', '856-555-1234', '+1 856 555 1234']) expect((await repo.customerHistory(ctx, { q: p, page: 1, pageSize: 10 })).totalItems).toBe(5);
    const add = await repo.customerHistory(ctx, { q: 'mai le', kind: 'add_on', page: 1, pageSize: 10 });
    expect(add.items.map((x) => [x.item, x.chargedCents, x.kind, x.maskedPhone])).toEqual([['French tips', 1000, 'add_on', '••• 1234']]);
    expect((await repo.customerHistory(ctx, { q: '#102', page: 1, pageSize: 10 })).items.map((x) => x.item)).toEqual(['Classic Pedicure']);
    expect((await repo.customerHistory(ctx2, { q: '8565551234', page: 1, pageSize: 10 })).items.map((x) => x.chargedCents)).toEqual([9900]);
    // Nov 3 audit: a 4+ digit ticket number was searched only as phone digits
    await q(`update tickets set ticket_number = '4242' where tenant_id = $1 and ticket_number = '102'`, [T]);
    try { expect((await repo.customerHistory(ctx, { q: '4242', page: 1, pageSize: 10 })).items.map((x) => x.item)).toEqual(['Classic Pedicure']); }
    finally { await q(`update tickets set ticket_number = '102' where tenant_id = $1 and ticket_number = '4242'`, [T]); }
    // an unknown add-on key is an empty list, not a server error (the '\u0000' placeholder made Postgres refuse the query)
    expect((await repo.addOnUsage(ctx, { key: 'no-such-addon', page: 1, pageSize: 10 })).totalItems).toBe(0);
  });
});

describe('Service Categories', () => {
  it('KPIs, chart and Breakdown from one aggregate (4/6 = 66.7 %), review flags never auto-fixed', async () => {
    const s = await repo.categorySummary(ctx);
    expect(s).toMatchObject({ categories: 4, totalServices: 6, unassigned: 0 });
    expect(s.breakdown.map((b) => [b.name, b.services, b.sharePct])).toEqual([['Nails', 4, 66.7], ['CD 4432', 1, 16.7], ['CD 6805', 1, 16.7], ['Brows', 0, 0]]);
    expect(s.review.filter((r) => r.kind === 'code_like_name').map((r) => r.categoryName)).toEqual(['CD 4432', 'CD 6805']);
    expect(s.review.filter((r) => r.kind === 'service_category_mismatch').map((r) => r.serviceName).sort()).toEqual(['Hair Coloring', 'Haircut']);
    expect(s.review.filter((r) => r.kind === 'empty').map((r) => r.categoryName)).toEqual(['Brows']);
  });

  it('SERVICE PRICING 13: owner review — approve a finding as is (note required, original ids kept, nothing in the catalog changes), reopen it; a rename puts it back in the queue; append-only', async () => {
    const edit = { ...ctx, permissions: ['pos.services.view', 'pos.services.edit'] };
    const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e?.response?.code ?? e?.code ?? e?.message; } };
    const catalogBefore = (await q(`select id, name, category_id, status from services where tenant_id = $1 order by id`, [T])).rows;
    const s0 = await repo.categorySummary(ctx);
    expect(s0.review.every((r) => r.status === 'open' && r.lastDecision === null)).toBe(true);
    expect(await code(repo.decideCategoryReview(edit, CUT, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'approve', note: 'fine as is' }))).toBe('CATEGORY_NOT_FOUND');    // the category id, not the service id
    expect(await code(repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'approve', note: 'x' }))).toBe('REASON_REQUIRED');
    expect(await code(repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', decision: 'approve', note: 'no service' }))).toBe('VALIDATION_FAILED');
    expect(await code(repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: GEL, decision: 'approve', note: 'not flagged' }))).toBe('CATEGORY_NOT_FOUND');
    expect(await code(repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'reopen', note: 'nothing to reopen' }))).toBe('INVALID_STATE_TRANSITION');
    const r = await repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'approve', note: 'We offer kids nail + haircut combo here' });
    expect(r.changesCatalog).toBe(false);
    expect(r.item).toMatchObject({ kind: 'service_category_mismatch', categoryId: NAILS, categoryName: 'Nails', serviceId: CUT, serviceName: 'Haircut', status: 'approved',
      lastDecision: { decision: 'approved_as_is', note: 'We offer kids nail + haircut combo here', by: 'Pat Owner' } });
    expect(await code(repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'approve', note: 'again' }))).toBe('REQUEST_ALREADY_DECIDED');
    // still listed (after the open ones), with who / when / why; the other findings stay open
    const s1 = await repo.categorySummary(ctx);
    expect(s1.review.at(-1)).toMatchObject({ serviceId: CUT, status: 'approved' });
    expect(s1.review.filter((x) => x.status === 'open')).toHaveLength(s0.review.length - 1);
    // the catalog is untouched
    expect((await q(`select id, name, category_id, status from services where tenant_id = $1 order by id`, [T])).rows).toEqual(catalogBefore);
    // reopen → open again, history newest first
    const ro = await repo.decideCategoryReview(edit, NAILS, { kind: 'service_category_mismatch', serviceId: CUT, decision: 'reopen', note: 'Owner wants to move it after all' });
    expect(ro.item.status).toBe('open');
    expect(ro.history.map((h) => h.decision)).toEqual(['reopened', 'approved_as_is']);
    // a decision is tied to the name it was made on: rename the empty category → back in the queue; the old name again → approved again
    await repo.decideCategoryReview(edit, EMPTY, { kind: 'empty', decision: 'approve', note: 'Brows services start next month' });
    await q(`update service_categories set name = 'Brows & Lashes' where id = $1`, [EMPTY]);
    expect((await repo.categorySummary(ctx)).review.find((x) => x.categoryId === EMPTY)).toMatchObject({ categoryName: 'Brows & Lashes', status: 'open', lastDecision: null });
    await q(`update service_categories set name = 'Brows' where id = $1`, [EMPTY]);
    expect((await repo.categorySummary(ctx)).review.find((x) => x.categoryId === EMPTY)!.status).toBe('approved');
    // append-only; another salon sees none of it
    await expect(q(`update catalog_category_reviews set note = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from catalog_category_reviews`)).rejects.toThrow(/append-only/);
    expect((await repo.categorySummary(ctx2)).review.every((x) => x.lastDecision === null)).toBe(true);
  });

  it('extras row 10: the summary says which catalog scope it counts — a branch session its branch (+ salon-wide rows); a salon-wide session every branch separately, never another salon', async () => {
    const br = (await repo.categorySummary(ctx)).scope;
    expect(br).toMatchObject({ mode: 'branch', branchId: B, branchName: 'Main', branchServices: 6, salonWideServices: 0 });
    expect(br.branches.map((x) => x.name)).toEqual(['Main']);
    const all = (await repo.categorySummary(ctxAll)).scope;
    expect(all).toMatchObject({ mode: 'salon', branchId: null, branchName: null, branchServices: null, salonWideServices: 0 });
    // Main's six rows and Uptown's own Gel Manicure row (the archived Old Polish Change is not counted); the other salon's branch never appears
    expect(all.branches.map((x) => [x.name, x.services])).toEqual([['Main', 6], ['Uptown', 1]]);
    expect((await repo.categorySummary(ctx2)).scope.branches.map((x) => x.name)).toEqual(['Elsewhere']);
  });

  it('directory newest first; searching a service finds its category; reassignment previews then moves with history', async () => {
    const d = await repo.categories(ctx, { page: 1, pageSize: 10 });
    expect(d.items.map((x) => x.name)).toEqual(['Brows', 'CD 6805', 'CD 4432', 'Nails']);
    const g = await repo.categories(ctx, { q: 'Gel Manicure', page: 1, pageSize: 10 });
    expect(g.items.map((x) => [x.name, x.matchedVia, x.matchedServices.map((m) => m.name)])).toEqual([['Nails', 'service', ['Gel Manicure']]]);
    expect((await repo.categories(ctx, { page: 2, pageSize: 3 })).items.map((x) => x.name)).toEqual(['Nails']);
    await expect(repo.reassign(ctx, NAILS, { serviceIds: [CUT], toCategoryId: NAILS })).rejects.toThrow(/different/);
    await expect(repo.reassign(ctx, NAILS, { serviceIds: [], toCategoryId: EMPTY })).rejects.toThrow(/at least one/);
    const pv = await repo.reassign(ctx, NAILS, { serviceIds: [CUT, COLOR], toCategoryId: EMPTY });
    expect(pv).toMatchObject({ preview: true, moved: 0, to: { name: 'Brows' } }); expect(pv.services.map((x) => [x.name, x.priceCents, x.durationMinutes])).toEqual([['Hair Coloring', 15000, 120], ['Haircut', 4500, 30]]);
    expect((await repo.categorySummary(ctx)).breakdown[0]!.services).toBe(4);   // a preview writes nothing
    await expect(repo.reassign(ctx, NAILS, { serviceIds: [CUT, COLOR], toCategoryId: EMPTY, confirm: true })).rejects.toThrow(/why/);
    const mv = await repo.reassign(ctx, NAILS, { serviceIds: [CUT, COLOR], toCategoryId: EMPTY, confirm: true, reason: 'Hair services are not nails' });
    expect(mv.moved).toBe(2);
    const after = await repo.categorySummary(ctx);
    expect(after.breakdown.map((b) => [b.name, b.services])).toEqual([['Nails', 2], ['CD 4432', 1], ['CD 6805', 1], ['Brows', 2]]);
    expect((await repo.services(ctx, { q: 'haircut', page: 1, pageSize: 5 })).items[0]).toMatchObject({ priceCents: 4500, durationMinutes: 30, categoryName: 'Brows' });   // price / duration untouched
    const h = await repo.history(ctx, { categoryId: EMPTY, page: 1, pageSize: 10 });
    expect(h.items.map((x) => [x.serviceName, x.oldValue, x.newValue])).toEqual(expect.arrayContaining([['Haircut', 'Nails', 'Brows'], ['Hair Coloring', 'Nails', 'Brows']]));
    await expect(repo.reassign(ctx2, NAILS, { serviceIds: [CUT], toCategoryId: EMPTY })).rejects.toThrow(/not found/i);
  });

  it('archiving a category with active services and no confirmation writes nothing (it used to archive first)', async () => {
    const r = await svcRepo.archiveCategory(ctx as never, CD4432, false);
    expect(r).toEqual({ ok: false, activeServices: 1 });
    expect((await q(`select status from service_categories where id = $1`, [CD4432])).rows[0].status).toBe('active');
  });
});

describe('Service Pricing — D4 gaps (Nov 5 2026): booking impact preview and revert', () => {
  it('the preview lists upcoming bookings of the service with their quoted price (never repriced); revert is a new revision', async () => {
    const A1 = id('ab1'), A2 = id('ab2'), A3 = id('ab3');
    const svcJson = JSON.stringify([{ serviceId: PEDI, serviceName: 'Classic Pedicure', durationMinutes: 45, priceCents: 5500 }]);
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values
      ($1,$4,$5,$7,$6,'Mai Le',$8::jsonb, current_date + 2, '10:00','10:45',45,'confirmed'),
      ($2,$4,$5,$7,$6,'Mai Le',$8::jsonb, current_date + 3, '10:00','10:45',45,'cancelled'),
      ($3,$4,$5,$7,$6,'Mai Le',$8::jsonb, current_date - 3, '10:00','10:45',45,'booked')`, [A1, A2, A3, T, B, id('aa1'), id('f1'), svcJson]);
    const imp: any = await repo.pricingImpact({ ...ctx, permissions: ['pos.services.view', 'customers.view'] }, PEDI, { priceCents: '5200', durationMinutes: '60' });
    expect(imp).toMatchObject({ upcoming: 1, quotedTotalCents: 5500, atNewPriceTotalCents: 5200, quotedDifferently: 1, wouldRunLonger: 1, policy: 'booked_quotes_kept' });
    expect(imp.items[0]).toMatchObject({ appointmentId: A1, quotedCents: 5500, customer: 'Mai Le' });
    expect((await repo.pricingImpact(ctx, PEDI, {})).items[0].customer).toBeNull();   // no customers.view: no names
    // SERVICE PRICING 04 (round 10): 45 → 60 min makes A1 (10:00–10:45) reach the same technician's 10:50 visit; 10:45 + 15 = 11:00.
    // A later 11:30 visit is not reached; a cancelled one never counts. An open ticket still carrying the pedicure at $48 is stale.
    const N1 = id('ad1'), N2 = id('ad2'), N3 = id('ad3');
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values
      ($1,$4,$5,$6,'Next','[]'::jsonb, current_date + 2, '10:50','11:20',30,'confirmed'), ($2,$4,$5,$6,'Later','[]'::jsonb, current_date + 2, '11:30','12:00',30,'confirmed'),
      ($3,$4,$5,$6,'Gone','[]'::jsonb, current_date + 2, '10:46','11:00',14,'cancelled')`, [N1, N2, N3, T, B, id('f1')]);
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind, quantity, status)
      values ($1,$2,$3,$4,$5,'Classic Pedicure',4800,50,4800,'service',1,'serving')`, [T, B, id('7a3'), PEDI, id('f1')]);
    const longer: any = await repo.pricingImpact(ctx, PEDI, { priceCents: '5200', durationMinutes: '60' });
    expect(longer.availabilityConflicts).toBe(1);
    expect(longer.conflictItems).toEqual([{ appointmentId: A1, day: expect.any(String), time: '10:00', nextAppointmentId: N1, nextTime: '10:50' }]);
    expect(longer).toMatchObject({ staleOpenTickets: 1, staleOpenLines: 1 });          // ticket 103 is open; paid ticket 102 (also $48) is history, not stale
    const shorter: any = await repo.pricingImpact(ctx, PEDI, { priceCents: '4800', durationMinutes: '45' });
    expect(shorter).toMatchObject({ availabilityConflicts: 0, staleOpenTickets: 0 });   // same duration, same price → nothing
    await q(`delete from pos_tech_appointments where id = any($1::uuid[])`, [[N1, N2, N3]]);
    await q(`delete from ticket_service_lines where ticket_id = $1 and service_id = $2`, [id('7a3'), PEDI]);
    // change the price, then revert that change: a NEW revision back to the old value; both history rows stay
    const cur: any = await repo.serviceDetail(ctx, PEDI);
    await repo.updatePricing(ctx, PEDI, { priceCents: 5200, reason: 'Promo month', expectedUpdatedAt: cur.updatedAt ?? cur.service?.updatedAt });
    const h: any = await repo.history(ctx, { serviceId: PEDI, field: 'price', preset: 'all' });
    const change = h.items.find((x: any) => x.newValue === '5200');
    await expect(repo.revertPricing(ctx, PEDI, { historyId: change.id })).rejects.toThrow(/why/);
    await repo.revertPricing(ctx, PEDI, { historyId: change.id, reason: 'Promo over' });
    expect(Number((await q(`select price_cents from services where id = $1`, [PEDI])).rows[0].price_cents)).toBe(4800);
    const h2: any = await repo.history(ctx, { serviceId: PEDI, field: 'price', preset: 'all' });
    expect(h2.items[0]).toMatchObject({ oldValue: '5200', newValue: '4800', source: 'pricing_revert' });
    expect(h2.items.some((x: any) => x.id === change.id)).toBe(true);
    expect((await q(`select services from pos_tech_appointments where id = $1`, [A1])).rows[0].services[0].priceCents).toBe(5500);   // the booked quote is never repriced
  });
});

describe('Service Pricing — D4 gaps (Nov 5 2026): scheduled prices', () => {
  it('a scheduled change is not current until due; applies once with its effective time; one open schedule; cancel', async () => {
    await expect(repo.schedulePricing(ctx, CUT, { priceCents: 5000, effectiveAt: new Date(Date.now() + 60_000).toISOString(), reason: 'too soon' })).rejects.toThrow(/5 minutes/);
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const s1: any = await repo.schedulePricing(ctx, CUT, { priceCents: 5000, effectiveAt: at, reason: 'New year prices' });
    expect(s1.scheduled).toMatchObject({ priceCents: 5000, reason: 'New year prices' });
    await expect(repo.schedulePricing(ctx, CUT, { priceCents: 5200, effectiveAt: at, reason: 'again' })).rejects.toThrow(/already has a scheduled/);
    expect(await repo.applyDueSchedules(T)).toBe(0);
    expect(Number((await q(`select price_cents from services where id = $1`, [CUT])).rows[0].price_cents)).toBe(4500);
    // it comes due
    await q(`update service_price_schedules set effective_at = now() - interval '1 minute' where id = $1`, [s1.scheduleId]);
    const d: any = await repo.serviceDetail(ctx, CUT);   // a read applies a due schedule
    expect(d.priceCents).toBe(5000); expect(d.scheduled).toBeNull();
    expect(await repo.applyDueSchedules(T)).toBe(0);   // never twice
    const h: any = await repo.history(ctx, { serviceId: CUT, field: 'price', preset: 'all' });
    expect(h.items[0]).toMatchObject({ oldValue: '4500', newValue: '5000', source: 'scheduled_price', reason: 'New year prices' });
    // schedule again and cancel it
    const s2: any = await repo.schedulePricing(ctx, CUT, { durationMinutes: 40, effectiveAt: at, reason: 'Longer slot' });
    await expect(repo.cancelScheduledPricing(ctx, CUT, { scheduleId: s2.scheduleId })).rejects.toThrow(/why/);
    expect((await repo.cancelScheduledPricing(ctx, CUT, { scheduleId: s2.scheduleId, reason: 'Changed our mind' })).scheduled).toBeNull();
    await expect(repo.cancelScheduledPricing(ctx, CUT, { scheduleId: s2.scheduleId, reason: 'again' })).rejects.toThrow(/already took effect or was cancelled/);
    await q(`update service_price_schedules set effective_at = now() - interval '1 minute' where id = $1`, [s2.scheduleId]);
    expect(await repo.applyDueSchedules(T)).toBe(0);
    expect(Number((await q(`select duration_minutes from services where id = $1`, [CUT])).rows[0].duration_minutes)).toBe(30);
  });
});

describe('Add-Ons', () => {
  it('KPIs state their unit (4 offerings of 1 add-on on 4 services, $10 average); hair-service offerings are flagged, not changed', async () => {
    expect(await repo.addOnSummary(ctx)).toMatchObject({ offerings: 4, activeOfferings: 4, definitions: 1, servicesOffering: 4, averagePriceCents: 1000, categoryAddOnServices: 0 });
    const l = await repo.addOns(ctx, { page: 1, pageSize: 10 });
    expect(l.items).toHaveLength(4); expect(l.items.every((x) => x.sharedWith === 4)).toBe(true);
    expect(l.items.filter((x) => x.reviewFlag).map((x) => x.serviceName).sort()).toEqual(['Hair Coloring', 'Haircut']);
    expect((await repo.addOns(ctx, { q: 'pedicure', page: 1, pageSize: 10 })).items.map((x) => x.serviceName)).toEqual(['Classic Pedicure']);
    expect((await repo.addOns(ctx, { q: '$10', page: 1, pageSize: 10 })).totalItems).toBe(4);
    const d = await repo.addOnDetail(ctx, 'ao_french');
    expect(d.offerings.find((o) => o.serviceName === 'Gel Manicure')).toMatchObject({ withServicePriceCents: 7000, withServiceMinutes: 55 });   // $60 (after the edit above) + $10, 45 + 10 min
    expect(d.usage).toMatchObject({ paidLines: 1, cents: 1000 });
    const u = await repo.addOnUsage(ctx, { q: '856-555-1234', page: 1, pageSize: 10 });
    expect(u.items.map((x) => [x.addOn, x.chargedCents, x.mainServices, x.ticketNumber])).toEqual([['French tips', 1000, 'Gel Manicure', '101']]);
    expect((await repo.addOnUsage(ctx2, { q: '8565551234', page: 1, pageSize: 10 })).totalItems).toBe(0);
  });

  it('round 10 (ADD-ONS 02): the four cards agree with the canonical rows — total / active offerings = the list\'s own counts, definitions = distinct add-ons, services = active services offering one; another salon counts nothing', async () => {
    const all = async (extra: Record<string, unknown> = {}) => { const out: any[] = []; for (let p = 1; ; p++) { const r = await repo.addOns(ctx, { ...extra, page: p, pageSize: 50 }); out.push(...r.items); if (p >= r.totalPages) return { items: out, total: r.totalItems }; } };
    const k = await repo.addOnSummary(ctx);
    const every = await all(); const active = await all({ status: 'active' });
    expect(k.offerings).toBe(every.total); expect(every.items).toHaveLength(every.total);
    expect(k.activeOfferings).toBe(active.total);
    expect(k.definitions).toBe(new Set(every.items.map((x) => x.key)).size);
    expect(k.servicesOffering).toBe(new Set(active.items.filter((x) => x.serviceStatus === 'active').map((x) => x.serviceId)).size);
    const k2 = await repo.addOnSummary(ctx2);
    expect(k2.offerings).toBe((await repo.addOns(ctx2, { page: 1, pageSize: 50 })).totalItems);
  });
  it('create needs chosen services and refuses a duplicate name; edits are scoped (one offering vs the definition); archive is soft', async () => {
    await expect(repo.createAddOn(ctx, { name: 'Chrome', priceCents: 1500, durationMinutes: 10 })).rejects.toThrow(/Choose the services/);
    await expect(repo.createAddOn(ctx, { name: 'french TIPS', priceCents: 1000, durationMinutes: 10, serviceIds: [M4432] })).rejects.toThrow(/already exists/);
    const c = await repo.createAddOn(ctx, { name: 'Chrome', priceCents: 1500, durationMinutes: 10, taxable: true, serviceIds: [GEL, M4432] });
    expect(c.offerings).toBe(2);
    expect((await repo.addOns(ctx, { page: 1, pageSize: 2 })).items.map((x) => x.name)).toEqual(['Chrome', 'Chrome']);   // newest first
    await repo.updateAddOn(ctx, 'ao_french', { scope: 'offering', serviceId: PEDI, priceCents: 800, reason: 'pedicure tips are smaller' });
    let d = await repo.addOnDetail(ctx, 'ao_french');
    expect(d.offerings.map((o) => o.priceCents).sort()).toEqual([1000, 1000, 1000, 800].sort()); expect(d.differsByService).toBe(true);
    await repo.updateAddOn(ctx, 'ao_french', { scope: 'definition', name: 'French Tips', durationMinutes: 15 });
    d = await repo.addOnDetail(ctx, 'ao_french');
    expect(d.offerings.every((o) => o.durationMinutes === 15 && /French Tips/.test(d.name))).toBe(true);
    expect(d.offerings.find((o) => o.serviceName === 'Classic Pedicure')!.priceCents).toBe(800);   // the definition edit did not touch the price it did not name
    await repo.setAddOnActive(ctx, 'ao_french', false, { serviceId: CUT, reason: 'not for hair' });
    expect((await repo.addOnSummary(ctx)).activeOfferings).toBe(5);
    await repo.setAddOnActive(ctx, 'ao_french', true, { serviceId: CUT });
    const h = await repo.history(ctx, { addOnKey: 'ao_french', page: 1, pageSize: 20 });
    expect(h.items.map((x) => x.field)).toEqual(expect.arrayContaining(['price_cents', 'name', 'duration_delta_minutes', 'is_active']));
    await expect(repo.updateAddOn(ctx2, 'ao_french', { scope: 'definition', name: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('Add-Ons — mass edit preview (extras ADD-ONS 08)', () => {
  it('dryRun on the shared definition lists each offering\'s old → new value and writes nothing (no row, no history)', async () => {
    const before = (await q(`select service_id, price_cents, is_active from service_add_ons where tenant_id = $1 and add_on_key = 'ao_french' order by service_id`, [T])).rows;
    const hist = (await repo.history(ctx, { addOnKey: 'ao_french', page: 1, pageSize: 50 })).totalItems;
    const r: any = await repo.updateAddOn(ctx, 'ao_french', { scope: 'definition', priceCents: 1200, removeServiceIds: [CUT], dryRun: true });
    expect(r.dryRun).toBe(true);
    const price = r.changes.filter((c: any) => c.field === 'price_cents');
    // every offering whose price is not already $12 — the Classic Pedicure one is $8 (its own price), the rest $10
    expect(price.map((c: any) => [c.serviceId, c.oldValue, c.newValue]).sort()).toEqual([[GEL, 1000, 1200], [PEDI, 800, 1200], [CUT, 1000, 1200], [COLOR, 1000, 1200]].sort());
    expect(r.changes.find((c: any) => c.field === 'is_active')).toMatchObject({ serviceId: CUT, oldValue: true, newValue: false });
    expect(r.changed).toBe(r.changes.length);
    expect((await q(`select service_id, price_cents, is_active from service_add_ons where tenant_id = $1 and add_on_key = 'ao_french' order by service_id`, [T])).rows).toEqual(before);
    expect((await repo.history(ctx, { addOnKey: 'ao_french', page: 1, pageSize: 50 })).totalItems).toBe(hist);
    // a one-offering preview names only that offering
    const one: any = await repo.updateAddOn(ctx, 'ao_french', { scope: 'offering', serviceId: GEL, priceCents: 1300, dryRun: true });
    expect(one.changes.map((c: any) => [c.serviceId, c.field])).toEqual([[GEL, 'price_cents']]);
  });
});

describe('Add-Ons — booking impact preview (07) and price reasons (14), Nov 12 2026', () => {
  it('the detail lists upcoming appointments that booked the add-on (by key, or by name on older rows); finished / cancelled / past are left out; names need customers.view', async () => {
    const svcJson = (addOn: Record<string, unknown>) => JSON.stringify([{ serviceId: GEL, serviceName: 'Gel Manicure', durationMinutes: 55, priceCents: 6500, addOns: [addOn] }]);
    const byKey = svcJson({ addOnId: 'ao_french', name: 'French tips', durationDeltaMinutes: 10, priceCents: 1000 });
    const byName = svcJson({ addOnId: 'old-id', name: 'FRENCH TIPS', durationDeltaMinutes: 10, priceCents: 900 });
    const other = svcJson({ addOnId: 'ao_other', name: 'Chrome', durationDeltaMinutes: 10, priceCents: 1500 });
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values
      ($1,$6,$7,$9,$8,'Mai Le',$10::jsonb, current_date + 4, '09:00','09:55',55,'confirmed'),
      ($2,$6,$7,$9,$8,'Mai Le',$11::jsonb, current_date + 5, '11:00','11:55',55,'booked'),
      ($3,$6,$7,$9,$8,'Mai Le',$10::jsonb, current_date + 6, '11:00','11:55',55,'cancelled'),
      ($4,$6,$7,$9,$8,'Mai Le',$10::jsonb, current_date - 4, '11:00','11:55',55,'booked'),
      ($5,$6,$7,$9,$8,'Mai Le',$12::jsonb, current_date + 7, '11:00','11:55',55,'booked')`,
      [id('ac1'), id('ac2'), id('ac3'), id('ac4'), id('ac5'), T, B, id('aa1'), id('f1'), byKey, byName, other]);
    const d: any = await repo.addOnDetail(ctx, 'ao_french');
    expect(d.upcoming).toMatchObject({ appointments: 2, policy: 'booked_quotes_kept' });
    expect(d.upcoming.items.map((x: any) => [x.appointmentId, x.serviceName, x.bookedMinutes, x.quotedCents, x.customer])).toEqual([
      [id('ac1'), 'Gel Manicure', 10, 1000, null], [id('ac2'), 'Gel Manicure', 10, 900, null]]);
    const withNames: any = await repo.addOnDetail({ ...ctx, permissions: ['pos.services.view', 'customers.view'] }, 'ao_french');
    expect(withNames.upcoming.items[0].customer).toBe('Mai Le');
    // the preview is read only: the booked add-on keeps its quoted minutes and price
    expect((await q(`select services from pos_tech_appointments where id = $1`, [id('ac1')])).rows[0].services[0].addOns[0]).toMatchObject({ durationDeltaMinutes: 10, priceCents: 1000 });
  });

  it('a usage row says why its charged amount differs from the default price (quantity, line reduced, varies by service, tax on the ticket)', async () => {
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, category_snapshot, is_add_on, line_kind, quantity, status)
      values ($1,$2,$3,'00000000-0000-0000-0000-000000000000',$4,'French Tips',1000,15,1500,'Nails',true,'add_on',2,'done')`, [T, B, id('7a2'), id('f1')]);
    const u = await repo.addOnUsage(ctx, { q: '#102', page: 1, pageSize: 10 });
    const row: any = u.items.find((x) => x.addOn === 'French Tips');
    expect(row).toMatchObject({ chargedCents: 1500, quotedCents: 1000, quantity: 2, menuPriceCents: null });
    expect(row.priceReasons).toEqual(expect.arrayContaining(['quantity', 'line_reduced', 'price_varies_by_service']));
    const plain: any = (await repo.addOnUsage(ctx, { q: '#101', page: 1, pageSize: 10 })).items.find((x) => x.addOn === 'French tips');
    expect(plain.priceReasons).not.toContain('line_reduced'); expect(plain.priceReasons).not.toContain('quantity');
  });
});

describe('SERVICE PRICING 09 (round 10) — why a charged line differs from the catalog price', () => {
  it('names quantity, an audited manual change (who / when), a membership benefit, a catalog change since, and what no record explains', async () => {
    const TK = id('7b1');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, paid_at, subtotal_cents, total_cents) values ($1,$2,$3,$4,909,'paid',now(),0,0)`, [TK, T, B, id('aa1')]);
    const L1 = id('7c1'), L2 = id('7c2');
    const gelNow = Number((await q(`select price_cents from services where id = $1`, [GEL])).rows[0].price_cents);
    // L1: Gel at an overridden $50 (catalog was gelNow at sale → changed by a manager), qty 1 · L2: 2 × pedicure at 4800 but charged 9000 (no record)
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind, quantity, status) values
      ($1,$3,$4,$5,$6,$8,'Gel Manicure',5000,45,5000,'service',1,'done'), ($2,$3,$4,$5,$7,$8,'Classic Pedicure',4800,50,9000,'service',2,'done')`, [L1, L2, T, B, TK, GEL, PEDI, id('f1')]);
    await q(`insert into ticket_revisions (ticket_id, tenant_id, branch_id, version, action, service_line_id, actor_user_id, before, after, summary) values ($1,$2,$3,1,'service_updated',$4,$5,$6::jsonb,$7::jsonb,'price')`,
      [TK, T, B, L1, U, JSON.stringify({ priceCents: gelNow }), JSON.stringify({ priceCents: 5000 })]);
    const h: any = await repo.customerHistory(ctx, { q: '#909', page: 1, pageSize: 10 });
    const e1 = h.items.find((x: any) => x.lineId === L1).priceExplanation, e2 = h.items.find((x: any) => x.lineId === L2).priceExplanation;
    expect(e1).toMatchObject({ catalogNowCents: gelNow, catalogAtSaleCents: gelNow, chargedCents: 5000, differenceFromCatalogNowCents: 5000 - gelNow });
    expect(e1.reasons).toEqual([{ code: 'manual_override', cents: 5000 - gelNow, by: 'Pat Owner', at: expect.any(String) }]);   // no catalog change, nothing unexplained
    const pediNow = Number((await q(`select price_cents from services where id = $1`, [PEDI])).rows[0].price_cents);
    expect(e2.quantity).toBe(2);
    expect(e2.reasons).toEqual(expect.arrayContaining([{ code: 'quantity', cents: 4800 }, { code: 'not_recorded', cents: 9000 - 9600 }]));
    if (pediNow !== 4800) expect(e2.reasons).toContainEqual({ code: 'catalog_changed_since', cents: pediNow - 4800 });
  });
});

describe('SERVICE PRICING 06 (round 10) — category & service relationship checker across domains', () => {
  it('flags a service that reads as another domain than its category (both ways, not only hair-in-nails); never changes the catalog', async () => {
    const HAIRC = id('ca1'), MASS = id('ca2'), S1 = id('cb1'), S2 = id('cb2'), S3 = id('cb3'), S4 = id('cb4');
    await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$3,$4,'Hair Studio','active'), ($2,$3,$4,'Massage','active')`, [HAIRC, MASS, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values
      ($1,$5,$6,$7,'Spa Pedicure',50,5000,'active'), ($2,$5,$6,$7,'Women''s Haircut',45,6000,'active'), ($3,$5,$6,$8,'Eyebrow Wax',15,1500,'active'), ($4,$5,$6,$8,'Hot Stone Massage',60,9000,'active')`,
      [S1, S2, S3, S4, T, B, HAIRC, MASS]);
    const before = (await q(`select count(*)::int as n from services where tenant_id = $1 and category_id = any($2::uuid[])`, [T, [HAIRC, MASS]])).rows[0].n;
    const s = await repo.categorySummary(ctx);
    const mm = s.review.filter((r: any) => r.kind === 'service_category_mismatch');
    expect(mm.find((r: any) => r.serviceId === S1)).toMatchObject({ categoryName: 'Hair Studio', categoryDomain: 'hair', serviceDomain: 'nails' });
    expect(mm.find((r: any) => r.serviceId === S3)).toMatchObject({ categoryName: 'Massage', categoryDomain: 'massage' });
    expect(mm.find((r: any) => r.serviceId === S2)).toBeUndefined();                  // a haircut in a hair category is right
    expect(mm.find((r: any) => r.serviceId === S4)).toBeUndefined();
    expect((await q(`select count(*)::int as n from services where tenant_id = $1 and category_id = any($2::uuid[])`, [T, [HAIRC, MASS]])).rows[0].n).toBe(before);
    await q(`delete from services where id = any($1::uuid[])`, [[S1, S2, S3, S4]]); await q(`delete from service_categories where id = any($1::uuid[])`, [[HAIRC, MASS]]);
  });
});
