import { describe, it, expect } from 'vitest';
import { SuperAdminAppointmentOversightService } from './super-admin-appointment-oversight.service';

function makePlatform() {
  return {
    platformAppointments: async (_q: any) => ({
      kpis: { totalAppointments: 12846, today: 1248, cancelledCount: 1248, noShowCount: 614, confirmedToday: 200, completedToday: 180 },
      byStatus: [
        { status: 'confirmed', count: 8942 }, { status: 'completed', count: 7264 }, { status: 'cancelled', count: 1248 },
        { status: 'no_show', count: 614 }, { status: 'pending', count: 300 }, { status: 'checked_in', count: 118 },
      ],
      bySource: [
        { source: 'online', count: 5642 }, { source: 'ai', count: 2146 }, { source: 'manual', count: 3000 },
        { source: 'phone', count: 782 }, { source: 'walk_in', count: 172 },
      ],
      oversight: { duplicateBookings: 128, technicianConflicts: 96, failedDeposits: 4, missingContact: 156, reminderFailures: 7 },
    }),
    reports: async () => ({ totals: { totalTenants: 2418 } }),
    branchesDashboard: async (_s: any) => ({ kpis: { activeBranches: 3317 } }),
    platformCustomers: async (_q: any) => ({ kpis: { totalCustomers: 1284741 } }),
  } as any;
}
const gapRepo = {
  appointmentDailyByStatus: async () => ([
    { date: '2026-04-30', status: 'completed', count: 40 }, { date: '2026-04-30', status: 'cancelled', count: 5 },
    { date: '2026-05-01', status: 'completed', count: 52 }, { date: '2026-05-01', status: 'no_show', count: 3 },
  ]),
  technicianCount: async () => 12746,
  todayRevenueCents: async () => 12876400,
};

describe('SuperAdminAppointmentOversightService — Overview', () => {
  it('returns exactly 18 KPIs with real sources available and unsourced signals as honest gaps', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({ userId: 'sa' }, {} as any);
    expect(out.kpis).toHaveLength(18);
    const byKey = Object.fromEntries(out.kpis.map((k) => [k.key, k]));
    // available (real source)
    for (const k of ['total', 'confirmed', 'completed', 'cancelled', 'no_shows', 'duplicates', 'overlaps', 'ai_created', 'staff_created', 'missing_customer']) {
      expect(byKey[k].available).toBe(true);
    }
    expect(byKey.total.value).toBe(12846);
    expect(byKey.confirmed.value).toBe(8942);
    expect(byKey.completed.value).toBe(7264);
    expect(byKey.ai_created.value).toBe(2146);
    expect(byKey.staff_created.value).toBe(3782); // manual 3000 + phone 782
    expect(byKey.duplicates.value).toBe(128);
    expect(byKey.overlaps.value).toBe(96);
    // honest gaps (no schema source)
    for (const k of ['failed_bookings', 'online_booking_failures', 'rescheduled', 'sync_failures', 'missing_service', 'data_integrity', 'external_errors', 'appointment_value']) {
      expect(byKey[k].available).toBe(false);
      expect(byKey[k].value).toBeNull();
    }
    expect(byKey.appointment_value.financial).toBe(true);
  });

  it('builds a 4-series weekly trend from daily-by-status', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({}, {} as any);
    expect(out.trend.available).toBe(true);
    expect(out.trend.dates).toEqual(['2026-04-30', '2026-05-01']);
    expect(out.trend.series.total).toEqual([45, 55]); // 40+5, 52+3
    expect(out.trend.series.completed).toEqual([40, 52]);
    expect(out.trend.series.cancelled).toEqual([5, 0]);
    expect(out.trend.series.noShows).toEqual([0, 3]);
  });

  it('groups status distribution (each appointment once) and reconciles to total', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({}, {} as any);
    const d = Object.fromEntries(out.statusDistribution.slices.map((s) => [s.label, s.value]));
    expect(d.Confirmed).toBe(8942);
    expect(d.Completed).toBe(7264);
    expect(d.Cancelled).toBe(1248);
    expect(d['No-Shows']).toBe(614);
    expect(d['Other Issues']).toBe(418); // pending 300 + checked_in 118
    const sum = out.statusDistribution.slices.reduce((a, s) => a + s.value, 0);
    expect(sum).toBe(out.statusDistribution.total);
  });

  it('maps sources to friendly mutually-exclusive groups', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({}, {} as any);
    const b = Object.fromEntries(out.sourceDistribution.bars.map((x) => [x.label, x.value]));
    expect(b['Online Booking']).toBe(5642);
    expect(b['AI Receptionist']).toBe(2146);
    expect(b['Staff (Front Desk)']).toBe(3782); // manual + phone
    expect(b['Walk-In Added']).toBe(172);
  });

  it('builds the 6 platform summary cards from composed aggregates', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({}, {} as any);
    expect(out.platformSummary.totalTenants.value).toBe(2418);
    expect(out.platformSummary.activeBranches.value).toBe(3317);
    expect(out.platformSummary.activeTechnicians.value).toBe(12746);
    expect(out.platformSummary.totalCustomers.value).toBe(1284741);
    expect(out.platformSummary.todaysAppointments.value).toBe(1248);
    expect(out.platformSummary.todaysRevenueCents.value).toBe(12876400);
  });

  it('flags failed-booking & sync issue tabs as not-connected, surfaces live counts for the rest', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), gapRepo as any);
    const out = await svc.overview({}, {} as any);
    expect(out.recentIssues.tabs.failedBookings.available).toBe(false);
    expect(out.recentIssues.tabs.syncFailures.available).toBe(false);
    expect(out.recentIssues.tabs.duplicates).toMatchObject({ available: true, count: 128 });
    expect(out.recentIssues.tabs.overlapping).toMatchObject({ available: true, count: 96 });
    expect(out.recentIssues.tabs.missingInfo).toMatchObject({ available: true, count: 156 });
  });
});

describe('SuperAdminAppointmentOversightService — Search (scope + privacy)', () => {
  function searchRepo() {
    const calls: any[] = [];
    const repo: any = {
      searchAppointments: async (sid: string | undefined, opts: any) => {
        calls.push({ sid, opts });
        return { rows: [{ id: 'a1', customerName: 'Emma Johnson', customerPhone: '(555) 867-5309', apptDate: '2026-05-06', startTime: '14:30', status: 'confirmed', source: 'online', tenantName: 'Glamour Studio', branchName: 'Downtown', technicianName: null }], total: 1 };
      },
    };
    return { repo, calls };
  }

  it('threads the server-derived tenant scope into the query (no client widening) and clamps pagination', async () => {
    const { repo, calls } = searchRepo();
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    await svc.search({}, { tenantId: 'tenant-A' } as any, { q: 'emma', page: 3, pageSize: 5000 });
    expect(calls[0].sid).toBe('tenant-A');
    expect(calls[0].opts.page).toBe(3);
    expect(calls[0].opts.pageSize).toBe(100); // clamped to max
  });

  it('masks customer phone to last-4 (privacy minimization)', async () => {
    const { repo } = searchRepo();
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.search({}, {} as any, { page: 1, pageSize: 25 });
    expect(out.rows[0].customerPhone).toBe('•••• 5309');
    expect(out.rows[0].customerName).toBe('Emma Johnson'); // name retained, contact masked
    expect(out.scope.label).toBe('platform');
  });

  it('returns an empty page (no leak) when there is no repo', async () => {
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), undefined);
    const out = await svc.search({}, {} as any, { page: 1, pageSize: 25 });
    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
  });

  it('duplicates: threads scope, clamps pagination, never auto-resolves (review-only payload)', async () => {
    const calls: any[] = [];
    const repo: any = { detectDuplicates: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { groups: [{ tenantName: 'T', customerName: 'Dup', apptDate: '2026-05-06', startTime: '10:00', count: 2, appointmentIds: ['a', 'b'], matchReasons: ['Same tenant', 'Same customer'], confidence: 95 }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.duplicates({}, { tenantId: 'T1' } as any, { page: 2, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 2, pageSize: 100 });
    expect(out.total).toBe(1);
    expect(out.groups[0]).toMatchObject({ count: 2, confidence: 95 });
    // payload is detection metadata only — no destructive fields
    expect(Object.keys(out.groups[0])).not.toContain('merged');
  });

  it('overlaps: threads scope, clamps pagination, returns duration-aware conflict pairs (review-only)', async () => {
    const calls: any[] = [];
    const repo: any = { detectOverlaps: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { conflicts: [{ tenantName: 'T', technicianName: 'Ava', apptDate: '2026-05-06', overlapMinutes: 30, a: { id: 'a', customerName: 'X', startTime: '10:00', endTime: '10:30' }, b: { id: 'b', customerName: 'Y', startTime: '10:00', endTime: '10:30' } }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.overlaps({}, { tenantId: 'T1' } as any, { page: 4, pageSize: -3 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 4, pageSize: 1 });
    expect(out.total).toBe(1);
    expect(out.conflicts[0]).toMatchObject({ overlapMinutes: 30 });
    expect(Object.keys(out.conflicts[0])).not.toContain('cancelled');
  });

  it('changeHistory: threads scope, clamps pagination, marks availability; empty when no repo', async () => {
    const calls: any[] = [];
    const repo: any = { appointmentChanges: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { rows: [{ id: '1', tenantName: 'T', appointmentId: 'a', changeType: 'status_changed', field: 'status', oldValue: 'booked', newValue: 'completed', actorType: 'manager', actorId: 'u', source: 'tech_app', createdAt: '2026-05-06T10:00:00Z' }], total: 1 }; } };
    const withRepo = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await withRepo.changeHistory({}, { tenantId: 'T1' } as any, { page: 2, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 2, pageSize: 100 });
    expect(out.available).toBe(true);
    expect(out.rows[0]).toMatchObject({ changeType: 'status_changed', oldValue: 'booked', newValue: 'completed' });

    const noRepo = new SuperAdminAppointmentOversightService(makePlatform(), undefined);
    const empty = await noRepo.changeHistory({}, {} as any, { page: 1, pageSize: 25 });
    expect(empty.available).toBe(false);
    expect(empty.rows).toEqual([]);
  });

  it('failures: surfaces failed-deposit rows (masked phone), marks booking/sync sources honestly not-connected', async () => {
    const calls: any[] = [];
    const repo: any = { failedDepositAppointments: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { rows: [{ id: 'a', customerName: 'Emma Johnson', customerPhone: '(555) 867-5309', tenantName: 'Glamour', branchName: 'Downtown', technicianName: 'Ava', apptDate: '2026-05-06', startTime: '14:30', status: 'booked', depositStatus: 'failed' }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.failures({}, { tenantId: 'T1' } as any, { page: 3, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 3, pageSize: 100 });
    expect(out.rows[0]).toMatchObject({ depositStatus: 'failed', customerPhone: '•••• 5309' });
    expect(out.sources.failedDeposits.available).toBe(true);
    expect(out.sources.failedBookings.available).toBe(false);
    expect(out.sources.syncFailures.available).toBe(false);
  });

  it('reschedules: reuses the change-log filtered to reschedule events (scope + clamp)', async () => {
    const calls: any[] = [];
    const repo: any = { appointmentChanges: async (sid: string | undefined, page: number, pageSize: number, changeType?: string) => { calls.push({ sid, page, pageSize, changeType }); return { rows: [{ id: '1', tenantName: 'T', appointmentId: 'a', changeType: 'rescheduled', field: 'start_time', oldValue: '10:00', newValue: '11:00', actorType: 'manager', actorId: 'u', source: 'tech_app', createdAt: '2026-05-06T10:00:00Z' }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.reschedules({}, { tenantId: 'T1' } as any, { page: 2, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 2, pageSize: 100, changeType: 'rescheduled' });
    expect(out.available).toBe(true);
    expect(out.rows[0]).toMatchObject({ changeType: 'rescheduled', field: 'start_time', newValue: '11:00' });
  });

  it('missingInfo: threads scope, clamps pagination, surfaces per-row missing flags', async () => {
    const calls: any[] = [];
    const repo: any = { missingInfoAppointments: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { rows: [{ id: 'a', customerName: 'Jane', tenantName: 'T', branchName: 'B', technicianName: null, apptDate: '2026-07-02', startTime: '10:00', status: 'booked', missing: ['Customer phone', 'Technician'] }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.missingInfo({}, { tenantId: 'T1' } as any, { page: 5, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 5, pageSize: 100 });
    expect(out.available).toBe(true);
    expect(out.rows[0].missing).toContain('Customer phone');
  });

  it('appointmentHistory: filters the change-log to one appointment id (scope-threaded); empty for blank id', async () => {
    const calls: any[] = [];
    const repo: any = { appointmentChanges: async (sid: string | undefined, page: number, pageSize: number, changeType?: string, appointmentId?: string) => { calls.push({ sid, page, pageSize, changeType, appointmentId }); return { rows: [{ id: '1', tenantName: 'T', appointmentId: 'appt-9', changeType: 'status_changed', field: 'status', oldValue: 'booked', newValue: 'checked_in', actorType: 'manager', actorId: 'u', source: 'check_in', createdAt: '2026-05-06T10:00:00Z' }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.appointmentHistory({}, { tenantId: 'T1' } as any, 'appt-9', { page: 1, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', appointmentId: 'appt-9', changeType: undefined, pageSize: 100 });
    expect(out.appointmentId).toBe('appt-9');
    expect(out.rows[0]).toMatchObject({ appointmentId: 'appt-9', source: 'check_in' });
    const blank = await svc.appointmentHistory({}, {} as any, '   ', { page: 1, pageSize: 50 });
    expect(blank.total).toBe(0);
    expect(blank.rows).toEqual([]);
    expect(calls.length).toBe(1); // no repo call for a blank id
  });

  it('dataIntegrity: threads scope, clamps pagination, surfaces per-row issue flags', async () => {
    const calls: any[] = [];
    const repo: any = { dataIntegrityIssues: async (sid: string | undefined, page: number, pageSize: number) => { calls.push({ sid, page, pageSize }); return { rows: [{ id: 'a', tenantName: 'T', apptDate: '2026-07-02', startTime: '10:00', status: 'booked', issues: ['Invalid branch reference', 'Impossible time (end before start)'] }], total: 1 }; } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const out = await svc.dataIntegrity({}, { tenantId: 'T1' } as any, { page: 4, pageSize: 9999 });
    expect(calls[0]).toMatchObject({ sid: 'T1', page: 4, pageSize: 100 });
    expect(out.available).toBe(true);
    expect(out.rows[0].issues).toContain('Invalid branch reference');
  });

  it('correctionPreview: proposes a reversible clear for confirmed corruption; refuses clean records; requires an id', async () => {
    const repo: any = { dataIntegrityIssues: async (_sid: string | undefined, _p: number, _ps: number, appointmentId?: string) => {
      if (appointmentId === 'bad') return { rows: [{ id: 'bad', tenantName: 'T', apptDate: '2026-07-02', startTime: '10:00', status: 'booked', issues: ['Invalid branch reference', 'Impossible time (end before start)'] }], total: 1 };
      return { rows: [], total: 0 };
    } };
    const svc = new SuperAdminAppointmentOversightService(makePlatform(), repo);
    const bad = await svc.correctionPreview({}, {} as any, 'bad');
    expect(bad.eligible).toBe(true);
    expect(bad.proposals[0]).toMatchObject({ correctionType: 'clear_invalid_reference', field: 'branch_id', after: null, reversible: true });
    expect(bad.nonCorrectable).toContain('Impossible time (end before start)'); // not auto-cleared
    expect(bad.requiredToApply).toEqual(['caseRef', 'reason', 'confirm']);
    const clean = await svc.correctionPreview({}, {} as any, 'clean');
    expect(clean.eligible).toBe(false);
    expect(clean.proposals).toEqual([]);
    const blank = await svc.correctionPreview({}, {} as any, '  ');
    expect(blank.eligible).toBe(false);
    expect(blank.reason).toMatch(/required/i);
  });
});
