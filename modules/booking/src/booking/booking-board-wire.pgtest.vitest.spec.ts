// booking-board-wire.pgtest — the merged Booking Schedule Board (packages/booking-schedule-board, Nov 13 2026) on the REAL
// booking API. Two jobs:
//  1. Wire contract. The board's ProductionBookingDataAdapter maps the payloads of GET technicians / day-grid /
//     availability / openings, POST appointments / reschedule / blocked-times and the 409/400 refusal bodies. This test
//     produces those payloads from the real BookingController + BookingService + Kysely repository (PGlite, all
//     migrations) and checks them against the fixtures the package's mapper tests read
//     (packages/booking-schedule-board/src/tests/fixtures/wire/*.json): any drift in field names / nesting fails here.
//     Regenerate after an intended wire change: UPDATE_BOARD_WIRE_FIXTURES=1 npx vitest run <this file>.
//  2. Standalone spec §39 acceptance on the real API (not the package's mock): 45 into 45 fits, 60 into 45 refused,
//     two stations → one conflict, drag to an unqualified technician refused, protected next appointment, block time
//     removes the opening, a move recomputes both columns, stale version refused, another salon sees nothing.
// Fixed far-future date and neutral names only — no screenshot sample data, nothing depends on today.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';
import { BookingController } from './booking.controller';
import { InMemoryTechnicianSkills } from './technician-skills.port';
import { setCodedErrorSink } from '@aipowersalon/api-contracts';

const T = 'b0a10000-0000-4000-8000-000000000001';
const B = 'b0a10000-0000-4000-8000-000000000002';
const T2 = 'b0a10000-0000-4000-8000-0000000000f1';   // another salon
const B2 = 'b0a10000-0000-4000-8000-0000000000f2';
const CAT = 'b0a10000-0000-4000-8000-0000000000c1';
const GEL = 'b0a10000-0000-4000-8000-000000000051';    // 45 min
const FULL = 'b0a10000-0000-4000-8000-000000000052';   // 60 min
const PEDI = 'b0a10000-0000-4000-8000-000000000053';   // 60 min
const AVA = 'b0a10000-0000-4000-8000-0000000000a1';    // GEL + FULL
const BEA = 'b0a10000-0000-4000-8000-0000000000b1';    // GEL only
const CY = 'b0a10000-0000-4000-8000-0000000000d1';     // PEDI only
const DAY = '2031-03-04';
const PERMS = ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule', 'pos.booking.cancel', 'pos.booking.assign_technician'];
const ctx = { tenantId: T, branchId: B, userId: 'b0a10000-0000-4000-8000-0000000000e1', role: 'MANAGER', permissions: PERMS };
const otherCtx = { tenantId: T2, branchId: B2, userId: 'b0a10000-0000-4000-8000-0000000000e2', role: 'MANAGER', permissions: PERMS };
const req = (c: object) => ({ ctx: c });
const FIXTURES = join(__dirname, '../../../../packages/booking-schedule-board/src/tests/fixtures/wire');
const UPDATE = process.env.UPDATE_BOARD_WIRE_FIXTURES === '1';

let svc: BookingService; let ctl: BookingController;
const wire: Record<string, unknown> = {};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
/** stable fixtures: timestamps → one fixed instant (ids, dates, times and numbers stay real) */
const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)])) : typeof v === 'string' && ISO.test(v) ? '2031-01-01T00:00:00.000Z' : v;
/** the shape a mapper depends on: object keys (recursively), array element shape, primitive kind */
const shapeOf = (v: unknown): unknown => Array.isArray(v) ? (v.length ? [shapeOf(v[0])] : []) : v === null ? 'null' : typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, shapeOf((v as Record<string, unknown>)[k])])) : typeof v;
/** The refusal exactly as the browser receives it: the controller's HttpException body, plus the registry code the platform
 *  exception filter attaches (observability request-telemetry `withRequestCode`: when the body carries no code, the code a
 *  `withCode(…)` error of THIS request threw with the same sentence). */
async function refusal(fn: () => Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const coded: { message: string; apiCode: string }[] = [];
  setCodedErrorSink((e) => { coded.push({ message: e.message, apiCode: e.apiCode }); });
  try { await fn(); } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    const raw = e.getResponse();
    const body: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : { ...(raw as Record<string, unknown>) };
    if (typeof body.code !== 'string') { const hit = [...coded].reverse().find((c) => c.message === body.message); if (hit) body.code = hit.apiCode; }
    return { status: e.getStatus(), body };
  } finally { setCodedErrorSink(null); }
  throw new Error('expected a refusal');
}
const open = async (techId: string): Promise<{ start: number; end: number; minutes: number }[]> =>
  ((await ctl.dayGrid(req(ctx), { date: DAY, technicianIds: techId }) as { columns: { technicianId: string; openRanges: { start: number; end: number; minutes: number }[] }[] }).columns.find((c) => c.technicianId === techId)?.openRanges) ?? [];
const has = (ranges: { start: number; end: number }[], from: number, to: number) => ranges.some((r) => r.start <= from && r.end >= to);
const book = (technicianId: string, serviceId: string, startTime: string, name: string) => ctl.create(req(ctx), { customerName: name, serviceIds: [serviceId], technicianId, date: DAY, startTime, source: 'manual' }) as Promise<{ appointmentId: string; version?: number }>;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
      ('${T}', 'Board Wire Salon', 'Board Wire Salon', 'board-wire', 'BOARDWIRE', 'active'),
      ('${T2}', 'Other Salon', 'Other Salon', 'other-salon-bw', 'OTHERBW', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active'), ('${B2}', '${T2}', 'Other', 'active');
    INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}', '${B}', 'booking-appointments', '{"bufferMinutes":0,"slotIntervalMinutes":15}');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${GEL}', '${T}', '${B}', '${CAT}', 'Gel Polish', 45, 4000, 'active'),
      ('${FULL}', '${T}', '${B}', '${CAT}', 'Full Set', 60, 5500, 'active'),
      ('${PEDI}', '${T}', '${B}', '${CAT}', 'Pedicure', 60, 5000, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${AVA}', '${T}', '${B}', 'Ava', 'Able', 'Ava Able', 'active', true),
      ('${BEA}', '${T}', '${B}', 'Bea', 'Bright', 'Bea Bright', 'active', true),
      ('${CY}', '${T}', '${B}', 'Cy', 'Calm', 'Cy Calm', 'active', true);
  `);
  // the exact-service authority (production binds TechnicianEligibilityService the same way)
  const skills = new InMemoryTechnicianSkills({ [AVA]: [GEL, FULL], [BEA]: [GEL], [CY]: [PEDI] });
  svc = new BookingService(new KyselyBookingRepository(kyselyFor(pg) as never), undefined, undefined, undefined, undefined, undefined, skills);
  ctl = new BookingController(svc);
}, 120000);

describe('board wire contract — payloads from the real controller', () => {
  it('records technicians / day-grid / availability / openings / create / reschedule / blocked-time / refusal bodies', async () => {
    const a1 = await book(AVA, GEL, '10:00', 'Guest One');
    await book(AVA, GEL, '11:30', 'Guest Two');
    wire['created'] = a1;
    wire['tech-page'] = await ctl.technicianPage(req(ctx), { date: DAY, page: '1', pageSize: '12' });
    wire['tech-page-locate'] = await ctl.technicianPage(req(ctx), { date: DAY, pageSize: '2', locate: CY });
    wire['day-grid'] = await ctl.dayGrid(req(ctx), { date: DAY, technicianIds: [AVA, BEA, CY].join(',') });
    wire['availability'] = await ctl.availability(req(ctx), { date: DAY, serviceIds: GEL });
    wire['openings'] = await ctl.openings(req(ctx), { date: DAY, serviceIds: GEL, limit: '10' });
    wire['rescheduled'] = await ctl.reschedule(req(ctx), a1.appointmentId, { startTime: '09:00', date: DAY, technicianId: AVA, expectedVersion: a1.version });
    wire['blocked'] = await ctl.addBlockedTime(req(ctx), { technicianId: CY, date: DAY, startTime: '12:00', endTime: '12:30', reason: 'Training' });
    wire['error-conflict'] = await refusal(() => book(AVA, FULL, '11:00', 'Guest Three'));
    wire['error-version'] = await refusal(() => ctl.reschedule(req(ctx), a1.appointmentId, { startTime: '09:15', date: DAY, expectedVersion: 0 }));
    wire['error-not-skilled'] = await refusal(() => book(CY, GEL, '15:00', 'Guest Four'));
    // undo so the acceptance block starts from Ava 10:00 + 11:30 as designed
    await ctl.reschedule(req(ctx), a1.appointmentId, { startTime: '10:00', date: DAY, technicianId: AVA });
    await ctl.removeBlockedTime(req(ctx), (wire['blocked'] as { blockId: string }).blockId);

    expect((wire['error-conflict'] as { status: number }).status).toBe(409);
    expect((wire['error-version'] as { body: { code: string } }).body.code).toBe('VERSION_CONFLICT');
    expect((wire['error-not-skilled'] as { body: { code: string } }).body.code).toBe('TECHNICIAN_NOT_SKILLED_FOR_SERVICES');

    if (UPDATE || !existsSync(join(FIXTURES, 'day-grid.json'))) {
      mkdirSync(FIXTURES, { recursive: true });
      for (const [k, v] of Object.entries(wire)) writeFileSync(join(FIXTURES, `${k}.json`), JSON.stringify(normalize(v), null, 2) + '\n');
    }
    for (const [k, v] of Object.entries(wire)) {
      const committed = JSON.parse(readFileSync(join(FIXTURES, `${k}.json`), 'utf8'));
      expect(shapeOf(JSON.parse(JSON.stringify(normalize(v)))), `wire drift in ${k}.json — regenerate with UPDATE_BOARD_WIRE_FIXTURES=1 and update the board mapper`).toEqual(shapeOf(committed));
    }
  });
});

describe('Standalone spec §39 acceptance — on the real booking API', () => {
  it('#1 a 45-minute service books into a 45-minute opening, and that opening is gone from the board', async () => {
    expect(has(await open(AVA), 10 * 60 + 45, 11 * 60 + 30)).toBe(true);
    await book(AVA, GEL, '10:45', 'Fits Exactly');
    expect(has(await open(AVA), 10 * 60 + 45, 11 * 60)).toBe(false);
  });
  it('#2 a 60-minute service into a 45-minute opening is refused (409, nothing written)', async () => {
    await ctl.cancel(req(ctx), (await svc.appointments(ctx as never, { date: DAY })).items.find((r) => r.customerName === 'Fits Exactly')!.appointmentId, { reason: 'test reset' });
    const r = await refusal(() => book(AVA, FULL, '10:45', 'Too Long'));
    expect(r.status).toBe(409);
    expect((await svc.appointments(ctx as never, { date: DAY })).items.some((x) => x.customerName === 'Too Long')).toBe(false);
  });
  it('#3 two stations book the same slot at once → exactly one succeeds, the other gets a conflict', async () => {
    const results = await Promise.allSettled([svc.create(ctx as never, { customerName: 'Station A', serviceIds: [GEL], technicianId: AVA, date: DAY, startTime: '13:00', source: 'manual' } as never),
      svc.create(ctx as never, { customerName: 'Station B', serviceIds: [GEL], technicianId: AVA, date: DAY, startTime: '13:00', source: 'manual' } as never)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });
  it('#5 a service that would run into the next appointment is refused', async () => {
    await book(AVA, GEL, '15:00', 'Next Guest');
    expect((await refusal(() => book(AVA, FULL, '14:15', 'Runs Into Next'))).status).toBe(409);
  });
  it('#6 an unqualified technician is offered no slot for the service and a booking for them is refused', async () => {
    const rows = await ctl.availability(req(ctx), { date: DAY, serviceIds: PEDI });
    expect(rows.find((r) => r.technicianId === AVA)!.slots).toHaveLength(0);
    expect(rows.find((r) => r.technicianId === CY)!.slots.length).toBeGreaterThan(0);
    const openings = await ctl.openings(req(ctx), { date: DAY, serviceIds: PEDI });
    expect(openings.openings.map((o) => o.technicianId)).toEqual([CY]);
    expect((await refusal(() => book(AVA, PEDI, '16:00', 'Wrong Skill'))).body.code).toBe('TECHNICIAN_NOT_SKILLED_FOR_SERVICES');
  });
  it('#4/#10 a drag to an unqualified technician is refused; a valid move recomputes BOTH columns', async () => {
    const one = (await svc.appointments(ctx as never, { date: DAY })).items.find((r) => r.customerName === 'Guest One')!;
    expect((await refusal(() => ctl.reschedule(req(ctx), one.appointmentId, { startTime: '10:00', date: DAY, technicianId: CY, expectedVersion: one.version }))).body.code).toBe('TECHNICIAN_NOT_SKILLED_FOR_SERVICES');
    expect(has(await open(BEA), 10 * 60, 10 * 60 + 45)).toBe(true);
    await ctl.reschedule(req(ctx), one.appointmentId, { startTime: '10:00', date: DAY, technicianId: BEA, expectedVersion: one.version });
    expect(has(await open(AVA), 10 * 60, 10 * 60 + 45)).toBe(true);    // source column regained the time
    expect(has(await open(BEA), 10 * 60, 10 * 60 + 15)).toBe(false);   // destination lost it
  });
  it('#7 a 60-minute blocked time removes that opening at once', async () => {
    expect(has(await open(BEA), 16 * 60, 17 * 60)).toBe(true);
    await ctl.addBlockedTime(req(ctx), { technicianId: BEA, date: DAY, startTime: '16:00', endTime: '17:00', reason: 'Training' });
    const after = await open(BEA);
    expect(after.some((r) => r.start < 17 * 60 && r.end > 16 * 60)).toBe(false);
  });
  it('a stale version is refused with VERSION_CONFLICT (another device changed it first)', async () => {
    const two = (await svc.appointments(ctx as never, { date: DAY })).items.find((r) => r.customerName === 'Guest Two')!;
    const r = await refusal(() => ctl.reschedule(req(ctx), two.appointmentId, { startTime: '11:45', date: DAY, expectedVersion: (two.version ?? 1) - 1 }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('VERSION_CONFLICT');
  });
  it('tenant isolation: another salon sees none of these technicians or appointments and cannot move one', async () => {
    const page = await ctl.technicianPage(req(otherCtx), { date: DAY });
    expect(page.total).toBe(0);
    const grid = await ctl.dayGrid(req(otherCtx), { date: DAY, technicianIds: [AVA, BEA].join(',') }) as { columns: unknown[]; appointments: unknown[] };
    expect(grid.columns).toHaveLength(0);
    expect(grid.appointments).toHaveLength(0);
    const two = (await svc.appointments(ctx as never, { date: DAY })).items.find((r) => r.customerName === 'Guest Two')!;
    const r = await refusal(() => ctl.reschedule(req(otherCtx), two.appointmentId, { startTime: '12:00', date: DAY }));
    expect(r.body.code).toBe('BOOKING_NOT_FOUND');
  });
});
