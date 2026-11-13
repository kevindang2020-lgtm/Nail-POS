/**
 * Isolated test fixtures (spec §38). Deterministic, synthetic, and NEVER
 * shipped to production (spec §37). Names are generated from a neutral pool —
 * none of the screenshot's sample names are used.
 */
import type { MockStoreData } from '../adapters/MockBookingDataAdapter';
import type { Appointment, ISODate, ScheduleSegment, Service, ServiceAddOn, Technician } from '../domain/scheduleTypes';
import { toISO } from '../domain/time';

export const FIXTURE_TENANT = 'tenant-demo';
export const FIXTURE_BRANCH = 'branch-main';
export const FIXTURE_TZ = 'America/New_York';
export const FIXTURE_DATE: ISODate = '2026-05-06';

const FIRST = ['Amara', 'Bao', 'Celeste', 'Dinh', 'Elena', 'Farah', 'Giang', 'Hana', 'Ivy', 'Jules', 'Kim', 'Linh', 'Maya', 'Nadia', 'Oanh', 'Priya', 'Quyen', 'Rosa', 'Suki', 'Thao', 'Uyen', 'Vera', 'Wren', 'Xuan', 'Yen', 'Zara', 'Anh', 'Bich', 'Cam', 'Dao'];
const LAST = ['Tran', 'Bui', 'Hoang', 'Ngo', 'Dang', 'Vu', 'Phan', 'Ly', 'Duong', 'Mai', 'Trinh', 'Lam', 'Do', 'Cao', 'Ha', 'Luu', 'Dinh', 'Quach', 'Ton', 'Vo', 'Chau', 'Kieu', 'Truong', 'Pham', 'Le'];
const CUSTOMERS = ['Jordan P.', 'Casey L.', 'Riley M.', 'Morgan T.', 'Avery S.', 'Quinn B.', 'Reese K.', 'Drew H.', 'Skyler N.', 'Taylor V.', 'Rowan D.', 'Sage W.', 'Blake F.', 'Harper G.', 'Emery C.', 'Finley R.', 'Kai O.', 'Lennox A.', 'Remy J.', 'Shay E.'];

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export const FIXTURE_SERVICES: Service[] = [
  { id: 'svc-gel-mani', tenantId: FIXTURE_TENANT, name: 'Gel Manicure', categoryId: 'cat-nails', durationMinutes: 45, priceCents: 4500, active: true },
  { id: 'svc-pedicure', tenantId: FIXTURE_TENANT, name: 'Pedicure', categoryId: 'cat-nails', durationMinutes: 45, priceCents: 5000, active: true },
  { id: 'svc-acrylic', tenantId: FIXTURE_TENANT, name: 'Acrylic Full Set', categoryId: 'cat-nails', durationMinutes: 60, priceCents: 6500, active: true },
  { id: 'svc-nail-art', tenantId: FIXTURE_TENANT, name: 'Nail Art', categoryId: 'cat-nails', durationMinutes: 30, priceCents: 2500, active: true },
  { id: 'svc-spa-pedi', tenantId: FIXTURE_TENANT, name: 'Spa Pedicure', categoryId: 'cat-spa', durationMinutes: 75, priceCents: 7500, active: true },
  { id: 'svc-manicure', tenantId: FIXTURE_TENANT, name: 'Manicure', categoryId: 'cat-nails', durationMinutes: 30, priceCents: 3000, active: true },
  { id: 'svc-dip', tenantId: FIXTURE_TENANT, name: 'Dip Powder', categoryId: 'cat-nails', durationMinutes: 60, priceCents: 5500, active: true },
  { id: 'svc-retired', tenantId: FIXTURE_TENANT, name: 'Retired Service', categoryId: 'cat-nails', durationMinutes: 15, priceCents: 1000, active: false },
];

export const FIXTURE_ADDONS: ServiceAddOn[] = [
  { id: 'addon-french', name: 'French Tips', durationMinutes: 15, priceCents: 1000 },
  { id: 'addon-paraffin', name: 'Paraffin Wax', durationMinutes: 15, priceCents: 1200 },
  { id: 'addon-polish', name: 'Polish Change', durationMinutes: 0, priceCents: 500 },
];

export interface BuildFixtureOptions {
  technicianCount?: number;
  date?: ISODate;
  seed?: number;
  /** Include the named edge cases from spec §38 on specific technician indexes. */
  edgeCases?: boolean;
}

const t = (date: ISODate, min: number) => toISO(date, min, FIXTURE_TZ);

export function buildFixture(opts: BuildFixtureOptions = {}): MockStoreData {
  const count = opts.technicianCount ?? 24;
  const date = opts.date ?? FIXTURE_DATE;
  const rand = prng(opts.seed ?? 42);
  const edge = opts.edgeCases ?? true;

  const technicians: Technician[] = [];
  const segments: ScheduleSegment[] = [];
  const appointments: Appointment[] = [];
  let segSeq = 0;
  let apptSeq = 0;

  const svcIds = FIXTURE_SERVICES.filter((s) => s.active).map((s) => s.id);

  for (let i = 0; i < count; i++) {
    const id = `tech-${String(i + 1).padStart(3, '0')}`;
    let displayName = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    // Edge: long technician names (§38)
    if (edge && i === 10) displayName = 'Nguyễn Thị Phương Anh-Katherine';
    if (edge && i === 11) displayName = 'Maximiliana Wolfeschlegelstein';

    // Skills: everyone does gel + manicure; others vary. Tech index 2 is the §38 case:
    // eligible for Gel Manicure but NOT Acrylic Full Set.
    let serviceIds = svcIds.filter(() => rand() > 0.3);
    if (!serviceIds.includes('svc-gel-mani')) serviceIds.push('svc-gel-mani');
    if (edge && i === 2) serviceIds = ['svc-gel-mani', 'svc-manicure', 'svc-nail-art'];
    // Edge-case technicians (gaps, protection, multi-service, blocked) are fully qualified so tests are about TIME, not skills.
    if (edge && [1, 3, 4, 5, 6].includes(i)) serviceIds = [...svcIds];

    const isTimeOff = edge && i === 7;
    technicians.push({
      id,
      tenantId: FIXTURE_TENANT,
      branchId: FIXTURE_BRANCH,
      displayName,
      avatarUrl: null,
      active: true,
      workingState: isTimeOff ? 'time_off' : 'working',
      serviceIds,
      sortOrder: i,
    });

    // Shifts: most 9–20, some 10–18, some 9–17.
    const shiftStart = i % 5 === 1 ? 10 * 60 : 9 * 60;
    const shiftEnd = i % 4 === 3 ? 18 * 60 : 20 * 60;
    if (isTimeOff) {
      segments.push({ id: `seg-${++segSeq}`, tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, technicianId: id, startAt: t(date, 0), endAt: t(date, 1440), type: 'time_off', reason: 'Approved PTO' });
      continue;
    }
    segments.push({ id: `seg-${++segSeq}`, tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, technicianId: id, startAt: t(date, shiftStart), endAt: t(date, shiftEnd), type: 'working' });
    // Lunch 12:00–12:30 (some 12:30–13:00)
    const lunchStart = i % 3 === 2 ? 12 * 60 + 30 : 12 * 60;
    segments.push({ id: `seg-${++segSeq}`, tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, technicianId: id, startAt: t(date, lunchStart), endAt: t(date, lunchStart + 30), type: 'lunch' });
    // Afternoon break for some
    if (i % 4 === 0) segments.push({ id: `seg-${++segSeq}`, tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, technicianId: id, startAt: t(date, 15 * 60 + 30), endAt: t(date, 15 * 60 + 45), type: 'break' });
    // Edge: blocked time (§38)
    if (edge && i === 5) segments.push({ id: `seg-${++segSeq}`, tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, technicianId: id, startAt: t(date, 16 * 60), endAt: t(date, 17 * 60), type: 'blocked', reason: 'Training', createdByUserId: 'user-owner' });

    // Appointments — a dense day with deliberate gaps.
    const mk = (start: number, items: { serviceId: string; addOnIds?: string[] }[], extra: Partial<Appointment> = {}): Appointment => {
      const its = items.map((it, k) => {
        const s = FIXTURE_SERVICES.find((x) => x.id === it.serviceId)!;
        const addOns = it.addOnIds?.map((a) => FIXTURE_ADDONS.find((x) => x.id === a)!);
        return { serviceId: s.id, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents, addOns: k === 0 ? addOns : undefined };
      });
      const dur = its.reduce((n, it) => n + it.durationMinutes + (it.addOns ?? []).reduce((m, a) => m + a.durationMinutes, 0), 0);
      const n = ++apptSeq;
      return {
        id: `appt-fx-${n}`,
        tenantId: FIXTURE_TENANT,
        branchId: FIXTURE_BRANCH,
        customerId: `cust-${n}`,
        customerName: CUSTOMERS[n % CUSTOMERS.length],
        technicianId: id,
        items: its,
        startAt: t(date, start),
        endAt: t(date, start + dur),
        status: 'confirmed',
        source: 'pos',
        requestedTechnician: rand() > 0.6,
        protected: false,
        version: 1,
        ...extra,
      };
    };
    const pick = () => serviceIds[Math.floor(rand() * serviceIds.length)];

    if (edge && i === 1) {
      // §38: lunch + multiple gaps; 45- and 60-minute overlapping possibilities
      appointments.push(mk(shiftStart, [{ serviceId: 'svc-gel-mani' }], { status: 'arrived' }));         // 10:00–10:45
      appointments.push(mk(11 * 60 + 30, [{ serviceId: 'svc-manicure' }]));                                 // 11:30–12:00 → gap 10:45–11:30 (45)
      appointments.push(mk(14 * 60, [{ serviceId: 'svc-acrylic' }], { status: 'in_service' }));            // 14:00–15:00 → gap 12:30–14:00 (90)
      appointments.push(mk(16 * 60, [{ serviceId: 'svc-pedicure' }]));                                      // 16:00–16:45 → gap 15:00–16:00 (60)
      continue;
    }
    if (edge && i === 4) {
      // §38: protected future appointment at 15:00 → a 60-min service at 14:15 must be refused
      appointments.push(mk(9 * 60, [{ serviceId: 'svc-gel-mani' }]));
      appointments.push(mk(13 * 60, [{ serviceId: 'svc-manicure' }]));                                      // 13:00–13:30
      appointments.push(mk(15 * 60, [{ serviceId: 'svc-acrylic' }], { protected: true, requestedTechnician: true, notes: 'VIP — protected' }));
      appointments.push(mk(17 * 60, [{ serviceId: 'svc-pedicure' }]));
      continue;
    }
    if (edge && i === 6) {
      // §38: multi-service appointment spanning many cells (45 + 60 + 15 add-on = 120)
      appointments.push(mk(9 * 60, [{ serviceId: 'svc-gel-mani', addOnIds: ['addon-french'] }, { serviceId: 'svc-acrylic' }]));
      appointments.push(mk(13 * 60, [{ serviceId: 'svc-spa-pedi' }], { status: 'completed' }));
      appointments.push(mk(18 * 60, [{ serviceId: 'svc-gel-mani' }], { source: 'walk_in', status: 'arrived', queueTicketId: 'ticket-fx-6' }));
      continue;
    }

    // Generic dense technician: fill the morning, leave scattered afternoon gaps.
    let cursor = shiftStart;
    while (cursor < shiftEnd - 30) {
      if (cursor >= lunchStart && cursor < lunchStart + 30) { cursor = lunchStart + 30; continue; }
      const r = rand();
      if (r < 0.28) { cursor += 15 * (1 + Math.floor(rand() * 4)); continue; } // leave a gap
      const svc = pick();
      const s = FIXTURE_SERVICES.find((x) => x.id === svc)!;
      if (cursor + s.durationMinutes > shiftEnd) break;
      if (cursor < lunchStart && cursor + s.durationMinutes > lunchStart) { cursor = lunchStart + 30; continue; }
      if (i % 4 === 0 && cursor < 15 * 60 + 45 && cursor + s.durationMinutes > 15 * 60 + 30) { cursor = 15 * 60 + 45; continue; }
      const status: Appointment['status'] = cursor < 10 * 60 ? 'completed' : cursor < 11 * 60 ? 'in_service' : cursor < 11 * 60 + 30 ? 'arrived' : 'confirmed';
      const walkIn = rand() < 0.08;
      appointments.push(mk(cursor, [{ serviceId: svc }], walkIn ? { source: 'walk_in', status: 'arrived', queueTicketId: `ticket-fx-${apptSeq + 1}` } : { status }));
      cursor += s.durationMinutes;
    }
  }

  return {
    branches: [{ tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, timezone: FIXTURE_TZ, branchHours: { openAt: '09:00', closeAt: '20:00' }, policy: { gridMinutes: 15 } }],
    technicians,
    services: FIXTURE_SERVICES,
    addOns: FIXTURE_ADDONS,
    appointments,
    segments,
    fairTurn: { [`${FIXTURE_TENANT}::${FIXTURE_BRANCH}`]: technicians.map((x) => x.id) },
  };
}

/** A second tenant that must never leak through the adapter (spec §33 tests). */
export function withForeignTenant(data: MockStoreData): MockStoreData {
  const foreign = buildFixture({ technicianCount: 3, edgeCases: false, seed: 7 });
  const rename = <T extends { tenantId: string; branchId: string; id?: string }>(x: T): T => ({ ...x, tenantId: 'tenant-other', branchId: 'branch-other', ...(x.id ? { id: `other-${x.id}` } : {}) });
  return {
    branches: [...data.branches, { tenantId: 'tenant-other', branchId: 'branch-other', timezone: FIXTURE_TZ, branchHours: { openAt: '09:00', closeAt: '20:00' } }],
    technicians: [...data.technicians, ...foreign.technicians.map(rename)],
    services: [...data.services, ...foreign.services.map((s) => ({ ...s, tenantId: 'tenant-other', id: `other-${s.id}` }))],
    addOns: data.addOns,
    appointments: [...data.appointments, ...foreign.appointments.map((a) => ({ ...rename(a), technicianId: `other-${a.technicianId}` }))],
    segments: [...data.segments, ...foreign.segments.map((s) => ({ ...rename(s), technicianId: `other-${s.technicianId}` }))],
    fairTurn: { ...data.fairTurn, 'tenant-other::branch-other': foreign.technicians.map((x) => `other-${x.id}`) },
  };
}
