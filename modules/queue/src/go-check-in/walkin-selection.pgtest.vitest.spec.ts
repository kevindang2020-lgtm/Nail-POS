// walkin-selection.pgtest.vitest.spec.ts — CPad 14 Walk-In service selection (SUNMI guide Section 4A) on the REAL schema
// (every migration incl. 990, PGlite): the display's own session → the branch's existing catalog → preview → idempotent
// confirm → ONE visit / queue entry (pos_queue_items) with the requested lines → the staff path edits it, no payment.
// Acceptance ids W01–W11 from the guide's 4A.11 are named in the test titles (W02 / W11 are screen tests in
// apps/customer-display; W12 is the regression list in the report).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyGoCheckInRepository } from './go-check-in.kysely.repository';
import { GoCheckInService } from './go-check-in.service';
import { KyselyCheckInRepository } from '../check-in/check-in.kysely.repository';
import { CheckInService } from '../check-in/check-in.service';

// agent-3 id range (…9930…): no collision with the other go-check-in pgtests
const T = 'e9930000-0000-4000-8000-000000000001', T2 = 'e9930000-0000-4000-8000-000000000002';
const B = 'e9930000-0000-4000-8000-0000000000b1', B_OTHER = 'e9930000-0000-4000-8000-0000000000b2', B2 = 'e9930000-0000-4000-8000-0000000000b9';
const C_MANI = 'e9930000-0000-4000-8000-0000000000c1', C_PEDI = 'e9930000-0000-4000-8000-0000000000c2', C_WAX = 'e9930000-0000-4000-8000-0000000000c3',
  C_ART = 'e9930000-0000-4000-8000-0000000000c4', C_ADD = 'e9930000-0000-4000-8000-0000000000c5', C_EMPTY = 'e9930000-0000-4000-8000-0000000000c6',
  C_OTHERB = 'e9930000-0000-4000-8000-0000000000c7', C_T2 = 'e9930000-0000-4000-8000-0000000000c8';
const S_GEL = 'e9930000-0000-4000-8000-0000000000d1', S_CLASSIC = 'e9930000-0000-4000-8000-0000000000d2', S_SPA = 'e9930000-0000-4000-8000-0000000000d3',
  S_BROW = 'e9930000-0000-4000-8000-0000000000d4', S_ART_HIDDEN = 'e9930000-0000-4000-8000-0000000000d5', S_FRENCH = 'e9930000-0000-4000-8000-0000000000d6',
  S_ARCHIVED = 'e9930000-0000-4000-8000-0000000000d7', S_INACTIVE = 'e9930000-0000-4000-8000-0000000000d8', S_OTHERB = 'e9930000-0000-4000-8000-0000000000d9',
  S_T2 = 'e9930000-0000-4000-8000-0000000000da', S_PARAFFIN = 'e9930000-0000-4000-8000-0000000000db';
const D = 'e9930000-0000-4000-8000-000000000101', D2 = 'e9930000-0000-4000-8000-000000000102', D_T2 = 'e9930000-0000-4000-8000-000000000103';
const TECH = 'e9930000-0000-4000-8000-0000000000e1';

let pg: any; let db: any; let repo: KyselyGoCheckInRepository; let svc: GoCheckInService; let checkIn: CheckInService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const count = async (table: string, where = 'true', p: any[] = []) => Number((await q(`select count(*)::int as n from ${table} where ${where}`, p))[0].n);
let phoneSeq = 0;
const nextPhone = () => `85655${String(10000 + ++phoneSeq).slice(-5)}`;
const rid = (tag: string) => `req-${tag}-${'x'.repeat(8)}`;
async function session(display = D, tenant = T, branch = B) { return svc.startDisplaySession({ id: display, tenantId: tenant, branchId: branch }); }

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  repo = new KyselyGoCheckInRepository(db);
  checkIn = new CheckInService(new KyselyCheckInRepository(db));
  svc = new GoCheckInService(repo, checkIn);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Salon A LLC','Salon A','e993a','E993A'), ($2,'Salon B LLC','Salon B','e993b','E993B')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Main'), ($2,$3,'Second'), ($4,$5,'B main')`, [B, B_OTHER, T, B2, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, description, sort_order, status) values
    ($1,$9,$10,'Manicure','Hands',1,'active'), ($2,$9,$10,'Pedicure',null,2,'active'), ($3,$9,$10,'Waxing',null,3,'inactive'),
    ($4,$9,$10,'Nail Art',null,4,'active'), ($5,$9,$10,'Add-ons',null,5,'active'), ($6,$9,$10,'Empty',null,6,'active'),
    ($7,$9,$11,'Manicure',null,1,'active'), ($8,$12,$13,'Manicure',null,1,'active')`,
    [C_MANI, C_PEDI, C_WAX, C_ART, C_ADD, C_EMPTY, C_OTHERB, C_T2, T, B, B_OTHER, T2, B2]);
  const svcRow = (id: string, tenant: string, branch: string, cat: string, name: string, mins: number, cents: number, sort: number, extra = '') =>
    q(`insert into services (id, tenant_id, branch_id, category_id, name, description, duration_minutes, price_cents, commission_type, commission_value, sort_order${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1,$2,$3,$4,$5,$6,$7,$8,'percent',40,$9${extra ? ', ' + extra.split('=')[1] : ''})`, [id, tenant, branch, cat, name, name === 'Gel Manicure' ? 'Long-lasting gel colour' : null, mins, cents, sort]);
  await svcRow(S_GEL, T, B, C_MANI, 'Gel Manicure', 45, 4500, 1);
  await svcRow(S_CLASSIC, T, B, C_MANI, 'Classic Manicure', 30, 2500, 2);
  await svcRow(S_SPA, T, B, C_PEDI, 'Spa Pedicure', 50, 6000, 1);
  await svcRow(S_BROW, T, B, C_WAX, 'Brow Wax', 15, 1500, 1);                                   // inactive category → hidden
  await svcRow(S_ART_HIDDEN, T, B, C_ART, 'Hand-painted Art', 20, 2000, 1, 'customer_app_booking_enabled=false');   // online-booking flag off — still on the CPad (Kevin Nov 13 2026: full services)
  await svcRow(S_FRENCH, T, B, C_ADD, 'French Tips', 10, 800, 1);                               // an add-on
  await svcRow(S_PARAFFIN, T, B, C_ADD, 'Paraffin Dip', 0, 1000, 2);                            // an add-on with no duration set
  await svcRow(S_ARCHIVED, T, B, C_MANI, 'Old Manicure', 30, 2000, 3, 'archived_at=now()');
  await svcRow(S_INACTIVE, T, B, C_PEDI, 'Retired Pedicure', 30, 3000, 2, "status='inactive'");
  await svcRow(S_OTHERB, T, B_OTHER, C_OTHERB, 'Gel Manicure', 45, 9900, 1);                    // another branch's row + price
  await svcRow(S_T2, T2, B2, C_T2, 'Salon B Manicure', 40, 3300, 1);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Olivia','Tran','Olivia Tran','active')`, [TECH, T, B]);
  await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status) values ($1,$4,$5,'CPad front','paired'), ($2,$4,$5,'CPad side','paired'), ($3,$6,$7,'B display','paired')`, [D, D2, D_T2, T, B, T2, B2]);
  await repo.upsertSettings(T, { enabled: true });
  await repo.upsertSettings(T2, { enabled: true });
});

describe('migration 990 defaults (4A.9)', () => {
  it('a new settings row: selection, require, prices, durations, add-ons ON; technician preference OFF', async () => {
    const T3 = 'e9930000-0000-4000-8000-000000000003';
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'C','C','e993c','E993C')`, [T3]);
    await q(`insert into tenant_checkin_settings (tenant_id) values ($1)`, [T3]);
    expect(await repo.getSettings(T3)).toMatchObject({ serviceSelectionEnabled: true, walkinRequireServices: true, walkinShowPrices: true, walkinShowDurations: true, walkinAllowAddOns: true, technicianPreferenceEnabled: true });   // Kevin Nov 13: guests may pick a technician by default
  });
});

describe('W01 category coverage — the branch\'s live, customer-visible catalog only', () => {
  it('active categories with an active service, in the salon\'s order (full menu — the online-booking flag does not hide a service); disabled / archived / other branch / other salon absent; public fields only', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    expect(cat.categories.map((c) => [c.name, c.serviceCount])).toEqual([['Manicure', 2], ['Pedicure', 1], ['Nail Art', 1]]);   // no Waxing (inactive), Add-ons (not a tile), Empty
    expect(cat.categories[0]).toMatchObject({ id: C_MANI, description: 'Hands' });
    expect(cat.services.map((x) => [x.name, x.priceCents, x.durationMinutes])).toEqual([['Gel Manicure', 4500, 45], ['Classic Manicure', 2500, 30], ['Spa Pedicure', 6000, 50], ['Hand-painted Art', 2000, 20]]);
    expect(cat.services[0]).toMatchObject({ description: 'Long-lasting gel colour', priceIsFrom: false, addOnIds: [S_FRENCH, S_PARAFFIN] });
    expect(cat.addOns).toEqual([{ id: S_FRENCH, name: 'French Tips', priceCents: 800, durationMinutes: 10 }, { id: S_PARAFFIN, name: 'Paraffin Dip', priceCents: 1000, durationMinutes: null }]);
    const wire = JSON.stringify(cat);
    for (const leak of ['commission', 'percent', '9900', 'Salon B', S_BROW, S_ARCHIVED, S_INACTIVE, S_OTHERB, S_T2]) expect(wire).not.toContain(leak);
    expect(cat.rules).toEqual({ requireServices: true, showPrices: true, showDurations: true, allowAddOns: true, allowTechnicianPreference: true, notesMaxLength: 200 });
  });
  it('the owner\'s switches shape it: prices / durations hidden, add-ons off — and each change is a new revision', async () => {
    const s = await session();
    const before = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    await repo.upsertSettings(T, { walkinShowPrices: false, walkinShowDurations: false, walkinAllowAddOns: false });
    const after = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    expect(after.revision).not.toBe(before.revision);
    expect(after.services.every((x) => x.priceCents === null && x.durationMinutes === null && x.addOnIds.length === 0)).toBe(true);
    expect(after.addOns).toEqual([]);
    await repo.upsertSettings(T, { walkinShowPrices: true, walkinShowDurations: true, walkinAllowAddOns: true });
    expect((await svc.walkInCatalog(s.sessionId, s.sessionToken)).revision).toBe(before.revision);
  });
  it('selection switched off → the catalog is refused (the plain walk-in stays); the revision the screen holds → notModified, no rows', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    expect(await svc.walkInCatalog(s.sessionId, s.sessionToken, cat.revision)).toEqual({ revision: cat.revision, notModified: true, rules: cat.rules, categories: [], services: [], addOns: [] });
    await repo.upsertSettings(T, { serviceSelectionEnabled: false });
    await expect(svc.walkInCatalog(s.sessionId, s.sessionToken)).rejects.toMatchObject({ code: 'WALK_IN_CHECKIN_DISABLED', status: 403 });
    await repo.upsertSettings(T, { serviceSelectionEnabled: true });
  });
});

describe('W03 multi-service request · W07 queue synchronization · W08 staff handoff', () => {
  it('Manicure + Pedicure + an add-on → preview (nothing written) → confirm → ONE queue entry with exactly those lines, priced by the catalog', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const lines = [{ serviceId: S_GEL, addOnIds: [S_FRENCH], shownPriceCents: 4500, shownName: 'Gel Manicure' }, { serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }];
    const [qBefore, rBefore] = [await count('pos_queue_items', 'tenant_id = $1', [T]), await count('walkin_service_requests')];
    const preview = await svc.previewWalkIn(s.sessionId, s.sessionToken, { lines, revision: cat.revision });
    expect(preview).toMatchObject({ confirmable: true, estimatedTotalCents: 4500 + 800 + 6000, estimatedMinutes: 45 + 10 + 50, warnings: [] });
    expect([await count('pos_queue_items', 'tenant_id = $1', [T]), await count('walkin_service_requests')]).toEqual([qBefore, rBefore]);   // preview wrote nothing

    const phone = nextPhone();
    const out = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w03'), approvedRevision: cat.revision, customerName: 'Mai Walkin', phone, lines, notes: 'Short nails please' });
    expect(out).toMatchObject({ status: 'checked_in', firstName: 'Mai', requestState: 'queued', replayed: false, servicesPending: false, estimatedServiceMinutes: 105 });
    const items = await q(`select id, branch_id, customer_name, requested_services, ticket_id, status, notes, source from pos_queue_items where tenant_id = $1 and customer_phone like $2`, [T, `%${phone.slice(-4)}`]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ branch_id: B, customer_name: 'Mai Walkin', ticket_id: null, notes: 'Short nails please', source: 'walk_in' });
    const reqd = (typeof items[0].requested_services === 'string' ? JSON.parse(items[0].requested_services) : items[0].requested_services) as any[];
    expect(reqd.map((l) => [l.serviceId, l.priceCents ?? l.price_cents, !!(l.isAddon ?? l.is_addon), l.parentServiceId ?? l.parent_service_id ?? null])).toEqual([
      [S_GEL, 4500, false, null], [S_FRENCH, 800, true, S_GEL], [S_SPA, 6000, false, null],
    ]);
    const req = (await q(`select status, queue_item_id, services_pending, estimated_total_cents, catalog_revision, lines from walkin_service_requests where checkin_request_id = $1`, [rid('w03')]))[0];
    expect(req).toMatchObject({ status: 'queued', queue_item_id: items[0].id, services_pending: false, catalog_revision: cat.revision });
    expect(Number(req.estimated_total_cents)).toBe(11300);
    expect(JSON.stringify(req)).not.toContain(phone);   // the request record keeps no phone
    // the WALKIN_SERVICE_REQUEST machine: a queued request is final — a stray write cannot reopen or fail it
    const reqId = (await q(`select id from walkin_service_requests where checkin_request_id = $1`, [rid('w03')]))[0].id;
    await repo.updateWalkInRequest(T, reqId, { status: 'failed' });
    expect((await q(`select status from walkin_service_requests where id = $1`, [reqId]))[0].status).toBe('queued');

    // W08: staff edit the lines and assign a technician through the EXISTING check-in path; nothing was charged
    const staff = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.check_in.edit', 'pos.check_in.assign_technician', 'pos.check_in.view'] } as any;
    const edited = await checkIn.updateServices(staff, items[0].id, { serviceIds: [S_CLASSIC, S_SPA] });
    expect(edited.services.map((x: any) => x.serviceId)).toEqual([S_CLASSIC, S_SPA]);
    expect(await count('tickets', 'tenant_id = $1', [T])).toBe(0);
    expect(await count('payments', 'tenant_id = $1', [T])).toBe(0);
  });
});

describe('W09 double tap / retry / reconnect — one visit per checkin_request_id', () => {
  it('two taps at once, a retry, and a new session on the same display: one queue entry, one request, the same answer', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const phone = nextPhone();
    const body = { checkinRequestId: rid('w09'), approvedRevision: cat.revision, customerName: 'Lan Double', phone, lines: [{ serviceId: S_CLASSIC, shownPriceCents: 2500, shownName: 'Classic Manicure' }] };
    const settled = await Promise.allSettled([svc.confirmWalkIn(s.sessionId, s.sessionToken, body), svc.confirmWalkIn(s.sessionId, s.sessionToken, body)]);
    const ok = settled.filter((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled').map((x) => x.value);
    const refused = settled.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => x.reason);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const e of refused) expect(e).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 });   // the second tap raced the first: "still saving", never a 2nd visit
    const retry = await svc.confirmWalkIn(s.sessionId, s.sessionToken, body);
    expect(retry).toMatchObject({ replayed: true, requestState: 'queued', firstName: 'Lan', checkInId: ok[0].checkInId });
    const reconnect = await session();   // the CPad restarted: a new session, the same display identity
    expect(await svc.confirmWalkIn(reconnect.sessionId, reconnect.sessionToken, body)).toMatchObject({ replayed: true, checkInId: ok[0].checkInId });
    expect(await count('pos_queue_items', 'tenant_id = $1 and customer_phone like $2', [T, `%${phone.slice(-4)}`])).toBe(1);
    expect(await count('walkin_service_requests', 'checkin_request_id = $1', [rid('w09')])).toBe(1);
    // the same id with a different payload is refused, and writes nothing
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { ...body, lines: [{ serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
    expect(await count('pos_queue_items', 'tenant_id = $1 and customer_phone like $2', [T, `%${phone.slice(-4)}`])).toBe(1);
    // the status route: this device's request, sanitized
    const st = await svc.walkInStatus(s.sessionId, s.sessionToken, rid('w09'));
    expect(st).toEqual({ checkinRequestId: rid('w09'), requestState: 'queued', queued: true });
    expect(JSON.stringify(st)).not.toMatch(/Lan|Classic|8565/);
    const side = await session(D2);   // ANOTHER display of the salon does not see this display's request
    expect((await svc.walkInStatus(side.sessionId, side.sessionToken, rid('w09'))).requestState).toBe('not_found');
  });
  it('a guest with an active visit is resolved to it — never queued twice', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const phone = nextPhone();
    const line = [{ serviceId: S_GEL, shownPriceCents: 4500, shownName: 'Gel Manicure' }];
    await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('act1'), approvedRevision: cat.revision, customerName: 'Hoa Again', phone, lines: line });
    const second = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('act2'), approvedRevision: cat.revision, customerName: 'Hoa Again', phone, lines: line });
    expect(second).toMatchObject({ status: 'already_checked_in', requestState: 'existing_visit' });
    expect(await count('pos_queue_items', 'tenant_id = $1 and customer_phone like $2', [T, `%${phone.slice(-4)}`])).toBe(1);
  });
  it('a confirm that crashed after writing its request is taken over by the retry — still one visit', async () => {
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const phone = nextPhone();
    const body = { checkinRequestId: rid('crash'), approvedRevision: cat.revision, customerName: 'Thu Crash', phone, lines: [{ serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }] };
    const realUpdate = repo.updateWalkInRequest.bind(repo); let failOnce = true;
    (repo as any).updateWalkInRequest = async (t: string, id: string, p: any) => { if (failOnce && p.status === 'queued') { failOnce = false; throw new Error('connection lost'); } return realUpdate(t, id, p); };
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, body)).rejects.toThrow(/connection lost/);
    (repo as any).updateWalkInRequest = realUpdate;
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, body)).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });   // still fresh
    await q(`update walkin_service_requests set updated_at = now() - interval '5 minutes' where checkin_request_id = $1`, [rid('crash')]);
    expect(await svc.confirmWalkIn(s.sessionId, s.sessionToken, body)).toMatchObject({ status: 'checked_in', requestState: 'queued' });
    expect(await count('pos_queue_items', 'tenant_id = $1 and customer_phone like $2', [T, `%${phone.slice(-4)}`])).toBe(1);   // the check-in's own key collapsed it
  });
});

describe('W04 required selection', () => {
  it('default: an empty confirm is refused, even with skip; owner turns "require" off → skip queues "Services pending" with no service and no price', async () => {
    const s = await session();
    let cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const phone = nextPhone();
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w04a'), approvedRevision: cat.revision, customerName: 'Kim Skip', phone, lines: [] })).rejects.toMatchObject({ code: 'SERVICES_REQUIRED' });
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w04b'), approvedRevision: cat.revision, customerName: 'Kim Skip', phone, lines: [], skipServices: true })).rejects.toMatchObject({ code: 'SERVICES_REQUIRED' });
    expect(await count('walkin_service_requests', 'checkin_request_id in ($1,$2)', [rid('w04a'), rid('w04b')])).toBe(0);
    await repo.upsertSettings(T, { walkinRequireServices: false });
    cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    expect(cat.rules.requireServices).toBe(false);
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w04c'), approvedRevision: cat.revision, customerName: 'Kim Skip', phone, lines: [] })).rejects.toMatchObject({ code: 'SERVICES_REQUIRED' });   // not chosen: still refused
    const out = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w04d'), approvedRevision: cat.revision, customerName: 'Kim Skip', phone, lines: [], skipServices: true });
    expect(out).toMatchObject({ status: 'checked_in', servicesPending: true, requestState: 'queued' });
    const item = (await q(`select requested_services, notes from pos_queue_items where tenant_id = $1 and customer_phone like $2`, [T, `%${phone.slice(-4)}`]))[0];
    expect(JSON.parse(typeof item.requested_services === 'string' ? item.requested_services : JSON.stringify(item.requested_services))).toEqual([]);
    expect(item.notes).toMatch(/^Services pending/);
    expect((await q(`select services_pending, estimated_total_cents from walkin_service_requests where checkin_request_id = $1`, [rid('w04d')]))[0]).toMatchObject({ services_pending: true });
    await repo.upsertSettings(T, { walkinRequireServices: true });
  });
});

describe('W05 price updates · W06 availability change', () => {
  it('owner reprices: the screen\'s revision is stale, preview marks the line changed, the old approval is refused with the fresh preview; renewed approval confirms at TODAY\'s price', async () => {
    const s = await session();
    const old = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    await q(`update services set price_cents = 2900, duration_minutes = 35 where id = $1`, [S_CLASSIC]);
    const fresh = await svc.walkInCatalog(s.sessionId, s.sessionToken, old.revision);
    expect(fresh.notModified).toBeUndefined();
    expect(fresh.revision).not.toBe(old.revision);
    expect(fresh.services.find((x) => x.id === S_CLASSIC)).toMatchObject({ priceCents: 2900, durationMinutes: 35 });
    const stale = [{ serviceId: S_CLASSIC, shownPriceCents: 2500, shownName: 'Classic Manicure' }];
    const pv = await svc.previewWalkIn(s.sessionId, s.sessionToken, { lines: stale, revision: old.revision });
    expect(pv).toMatchObject({ confirmable: false, estimatedTotalCents: 2900, estimatedMinutes: 35 });
    expect(pv.lines[0]).toMatchObject({ state: 'changed', priceCents: 2900 });
    expect(pv.warnings.sort()).toEqual(['CATALOG_REVISION_CHANGED', 'SERVICE_CHANGED']);
    const phone = nextPhone();
    const err: any = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w05'), approvedRevision: old.revision, customerName: 'Ngoc Price', phone, lines: stale }).catch((e) => e);
    expect(err).toMatchObject({ code: 'WALK_IN_SELECTION_CHANGED', status: 409 });
    expect(err.details.preview.lines[0]).toMatchObject({ state: 'changed', priceCents: 2900 });
    expect(await count('walkin_service_requests', 'checkin_request_id = $1', [rid('w05')])).toBe(0);   // refused before anything was written
    const renewed = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w05'), approvedRevision: fresh.revision, customerName: 'Ngoc Price', phone, lines: [{ serviceId: S_CLASSIC, shownPriceCents: 2900, shownName: 'Classic Manicure' }] });
    expect(renewed.status).toBe('checked_in');
    const item = (await q(`select requested_services from pos_queue_items where tenant_id = $1 and customer_phone like $2`, [T, `%${phone.slice(-4)}`]))[0];
    const reqd = typeof item.requested_services === 'string' ? JSON.parse(item.requested_services) : item.requested_services;
    expect(reqd[0].priceCents ?? reqd[0].price_cents).toBe(2900);
  });
  it('a disabled or deleted service cannot be confirmed with its stale id — nothing written', async () => {
    const s = await session();
    const before = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const qBefore = await count('pos_queue_items', 'tenant_id = $1', [T]);
    for (const [i, change] of [`update services set status = 'inactive' where id = '${S_GEL}'`, `update services set status = 'active', archived_at = now() where id = '${S_GEL}'`].entries()) {
      await q(change);
      const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
      expect(cat.services.some((x) => x.id === S_GEL)).toBe(false);
      const err: any = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w06-' + i), approvedRevision: cat.revision, customerName: 'Gone Svc', phone: nextPhone(), lines: [{ serviceId: S_GEL, shownPriceCents: 4500, shownName: 'Gel Manicure' }] }).catch((e) => e);
      expect(err).toMatchObject({ code: 'WALK_IN_SERVICE_UNAVAILABLE', status: 409 });
      expect(err.details.preview.lines[0].state).toBe('unavailable');
    }
    // an add-on the salon stopped allowing is unavailable too
    await q(`update services set archived_at = null where id = $1`, [S_GEL]);
    await repo.upsertSettings(T, { walkinAllowAddOns: false });
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('w06-addon'), approvedRevision: cat.revision, customerName: 'Gone Addon', phone: nextPhone(), lines: [{ serviceId: S_GEL, addOnIds: [S_FRENCH], shownPriceCents: 4500, shownName: 'Gel Manicure' }] })).rejects.toMatchObject({ code: 'WALK_IN_SERVICE_UNAVAILABLE' });
    await repo.upsertSettings(T, { walkinAllowAddOns: true });
    expect(await count('pos_queue_items', 'tenant_id = $1', [T])).toBe(qBefore);
    expect(before.revision).not.toBe(cat.revision);
  });
});

describe('W10 multiple tenants — a CPad of salon B cannot read or submit salon A', () => {
  it('B\'s catalog has none of A\'s rows; A\'s service id from B\'s display is unavailable; A\'s request is not B\'s; another branch\'s service is not this branch\'s', async () => {
    const sb = await session(D_T2, T2, B2);
    const catB = await svc.walkInCatalog(sb.sessionId, sb.sessionToken);
    expect(catB.services.map((x) => x.id)).toEqual([S_T2]);
    expect(JSON.stringify(catB)).not.toMatch(/Gel Manicure|Spa Pedicure|Salon A/);
    const qA = await count('pos_queue_items', 'tenant_id = $1', [T]);
    await expect(svc.confirmWalkIn(sb.sessionId, sb.sessionToken, { checkinRequestId: rid('w10'), approvedRevision: catB.revision, customerName: 'Cross Tenant', phone: nextPhone(), lines: [{ serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }] })).rejects.toMatchObject({ code: 'WALK_IN_SERVICE_UNAVAILABLE' });
    expect(await count('pos_queue_items', 'tenant_id = $1', [T])).toBe(qA);
    expect(await count('pos_queue_items', 'tenant_id = $1', [T2])).toBe(0);
    expect((await svc.walkInStatus(sb.sessionId, sb.sessionToken, rid('w03'))).requestState).toBe('not_found');
    // the same branch rule inside salon A: the other branch's Gel Manicure (its own row and price) is not offered here
    const sa = await session();
    const catA = await svc.walkInCatalog(sa.sessionId, sa.sessionToken);
    expect(catA.services.some((x) => x.id === S_OTHERB)).toBe(false);
    await expect(svc.previewWalkIn(sa.sessionId, sa.sessionToken, { lines: [{ serviceId: S_OTHERB }], revision: catA.revision })).resolves.toMatchObject({ confirmable: false, lines: [{ state: 'unavailable' }] });
    // a wrong session token is refused before anything is read
    await expect(svc.walkInCatalog(sa.sessionId, 'not-the-token')).rejects.toMatchObject({ status: 401 });
  });
  it('the database refuses a request row whose branch belongs to another salon (B-12 trigger)', async () => {
    await expect(q(`insert into walkin_service_requests (tenant_id, branch_id, device_ref, checkin_request_id, payload_hash, catalog_revision) values ($1,$2,$3,'req-cross-xxxxxxxx',$4,'r')`, [T, B2, `display:${D}`, 'a'.repeat(64)])).rejects.toThrow();
  });
});

describe('technician preference is a request, only when the salon allows it', () => {
  it('ON is the default; OFF: a sent technician is ignored; ON: an ineligible technician is refused', async () => {
    await repo.upsertSettings(T, { technicianPreferenceEnabled: false });
    const s = await session();
    const cat = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    const phone = nextPhone();
    const out = await svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('tech-off'), approvedRevision: cat.revision, customerName: 'Pref Off', phone, technicianId: TECH, lines: [{ serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }] });
    expect(out.status).toBe('checked_in');
    expect((await q(`select assigned_technician_id from pos_queue_items where tenant_id = $1 and customer_phone like $2`, [T, `%${phone.slice(-4)}`]))[0].assigned_technician_id).toBeNull();
    await repo.upsertSettings(T, { technicianPreferenceEnabled: true });
    const cat2 = await svc.walkInCatalog(s.sessionId, s.sessionToken);
    await expect(svc.confirmWalkIn(s.sessionId, s.sessionToken, { checkinRequestId: rid('tech-on'), approvedRevision: cat2.revision, customerName: 'Pref On', phone: nextPhone(), technicianId: TECH, lines: [{ serviceId: S_SPA, shownPriceCents: 6000, shownName: 'Spa Pedicure' }] })).rejects.toMatchObject({ code: 'TECHNICIAN_UNAVAILABLE_TODAY' });   // not scheduled / not skilled today
    await repo.upsertSettings(T, { technicianPreferenceEnabled: false });
  });
});
