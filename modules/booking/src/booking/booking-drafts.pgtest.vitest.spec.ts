// booking-drafts.pgtest — B-22 (Oct 22 2026): a POS draft is a booking_holds row of kind 'draft' — it keeps the whole form,
// never names a technician, blocks NO slot (the live-hold gate ignores it), expires on its own, lists per branch, and
// leaves the list when discarded or converted. Real schema (migration 676) on PGlite.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingDraftRepo, draftFields, BookingDraftError } from './booking-drafts';
import { KyselyHoldRepository } from '../customer-booking/booking-hold.kysely';

const T = '4a000000-0000-4000-8000-000000000001', T2 = '4a000000-0000-4000-8000-000000000002';
const B = '4a000000-0000-4000-8000-0000000000b1', B2 = '4a000000-0000-4000-8000-0000000000b2';
const CAT = '4a000000-0000-4000-8000-0000000000c0', GEL = '4a000000-0000-4000-8000-0000000000c1', PEDI = '4a000000-0000-4000-8000-0000000000c2';
const TECH = '4a000000-0000-4000-8000-0000000000d1', CUST = '4a000000-0000-4000-8000-0000000000e1';
const ctx = (branchId = B, tenantId = T): any => ({ tenantId, branchId, userId: '4a000000-0000-4000-8000-0000000000f1', role: 'FRONT_DESK', permissions: ['pos.booking.create', 'pos.booking.view'] });
let db: any; let pg: any; let repo: KyselyBookingDraftRepo; let holds: KyselyHoldRepository;
const payload = (over: Record<string, unknown> = {}) => ({
  serviceIds: [GEL, PEDI], serviceLines: [{ serviceId: GEL, name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }, { serviceId: PEDI, name: 'Pedicure', durationMinutes: 50, priceCents: 5500 }],
  priceOverrides: {}, partySize: 2, date: '2026-11-03', startTime: '14:30', technicianId: TECH, source: 'manual', notes: '[DRAFT] birthday party', customerId: CUST, customerName: 'Jenny Pham', ...over,
});

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','D','Drafts','drafts','DRF01','active'), ('${T2}','O','Other','other-drf','DRF02','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown'), ('${B2}','${T}','Uptown');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}','${T}','${B}','Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${GEL}','${T}','${B}','${CAT}','Gel Manicure',45,4500,'active'), ('${PEDI}','${T}','${B}','${CAT}','Pedicure',50,5500,'active');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CUST}','${T}','${B}','Jenny','Pham','Jenny Pham','+16095550177','active');
  `);
  db = kyselyFor(pg); repo = new KyselyBookingDraftRepo(db); holds = new KyselyHoldRepository(db);
}, 60_000);

describe('B-22: Save Draft makes a real draft, not an appointment', () => {
  it('draftFields reads the form: services, minutes, date / time, customer, a title, the notes without the old [DRAFT] tag', () => {
    expect(draftFields(payload())).toEqual({ serviceIds: [GEL, PEDI], minutes: 95, date: '2026-11-03', startTime: '14:30', customerId: CUST, title: 'Jenny Pham', notes: 'birthday party' });
    expect(draftFields({ serviceLines: [{ name: 'Pedicure' }] })).toMatchObject({ serviceIds: [], minutes: 30, date: null, startTime: null, customerId: null, title: 'Pedicure', notes: null });
  });
  it('saves the whole form on a kind=draft hold with NO technician, 7 days to live; lists it for the branch; gets it back whole', async () => {
    const d = await repo.save(ctx(), payload());
    expect(d).toMatchObject({ title: 'Jenny Pham', notes: 'birthday party', date: '2026-11-03', startTime: '14:30', serviceIds: [GEL, PEDI], customerId: CUST });
    expect(d.payload).toMatchObject({ technicianId: TECH, partySize: 2, serviceLines: expect.any(Array) });
    expect(new Date(d.expiresAt).getTime() - new Date(d.createdAt).getTime()).toBeGreaterThan(6.9 * 24 * 3600_000);
    const row = (await sql`SELECT kind, technician_id, status, channel, start_time, end_time FROM booking_holds WHERE id = ${d.draftId}`.execute(db)).rows[0] as any;
    expect(row).toMatchObject({ kind: 'draft', technician_id: null, status: 'held', channel: 'pos_draft' });
    expect(new Date(row.end_time).getTime() - new Date(row.start_time).getTime()).toBe(95 * 60_000);
    expect((await repo.list(ctx())).map((x) => x.draftId)).toEqual([d.draftId]);
    expect((await repo.list(ctx(B2))).length).toBe(0);                                 // another branch of the salon: not its draft
    expect(await repo.get(ctx(B, T2), d.draftId)).toBeNull();                          // another salon: never
    expect((await repo.get(ctx(), d.draftId))?.payload).toEqual(d.payload);
  });
  it('a draft blocks NO slot: the live-hold gate on that technician / time sees nothing (kind=slot only)', async () => {
    const start = Date.UTC(2026, 10, 3, 14, 30), end = start + 95 * 60_000;
    expect(await holds.liveHolds(T, B, start - 3600_000, end + 3600_000)).toEqual([]);
  });
  it('discarding releases it (the row stays, reason draft_discarded); converting marks it converted; neither lists any more; a second discard is a no-op', async () => {
    const a = await repo.save(ctx(), payload({ customerName: 'A' }));
    const b = await repo.save(ctx(), payload({ customerName: 'B' }));
    expect(await repo.discard(ctx(), a.draftId)).toBe(true);
    expect(await repo.discard(ctx(), a.draftId)).toBe(false);
    expect(await repo.discard(ctx(), b.draftId, 'converted')).toBe(true);
    const rows = (await sql`SELECT id, status, release_reason FROM booking_holds WHERE id IN (${a.draftId}, ${b.draftId}) ORDER BY created_at`.execute(db)).rows as any[];
    expect(rows.map((r) => [r.status, r.release_reason])).toEqual([['released', 'draft_discarded'], ['released', 'converted']]);
    expect((await repo.list(ctx())).some((x) => x.draftId === a.draftId || x.draftId === b.draftId)).toBe(false);
    expect(await repo.discard(ctx(B, T2), (await repo.list(ctx()))[0].draftId)).toBe(false);   // another salon cannot discard it
  });
  it('an oversized form or no branch is refused with a code', async () => {
    await expect(repo.save(ctx(''), payload())).rejects.toBeInstanceOf(BookingDraftError);
    await expect(repo.save(ctx(), payload({ notes: 'x'.repeat(70_000) }))).rejects.toMatchObject({ code: 'invalid' });
  });
  it('a draft that is not a real date / time still saves (the form is kept as typed; the slot is "now")', async () => {
    const d = await repo.save(ctx(), { serviceLines: [{ name: 'Pedicure', durationMinutes: 50 }], notes: 'call back' });
    expect(d).toMatchObject({ title: 'Pedicure', notes: 'call back', startTime: null, serviceIds: [], customerId: null });
  });
});

describe('Security Deep Scan §75: a draft belongs to ONE location', () => {
  it('another location of the same salon cannot read or discard it (the live IDOR branch row found the read)', async () => {
    const d = await repo.save(ctx(B), payload({ customerName: 'Branch Probe' }));
    expect(await repo.get(ctx(B2), d.draftId)).toBeNull();
    expect(await repo.discard(ctx(B2), d.draftId)).toBe(false);
    expect((await repo.get(ctx(B), d.draftId))?.draftId).toBe(d.draftId);   // its own location still finds it
    expect(await repo.get({ ...ctx(B), branchId: '' }, d.draftId)).toBeNull();   // no location selected → nothing
    expect(await repo.discard(ctx(B), d.draftId)).toBe(true);
  });
});
