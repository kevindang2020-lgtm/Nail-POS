import { describe, it, expect, vi } from 'vitest';
import { computeHoursWorked, deriveTechClock, buildTimeClockSummary, type ShiftPunch } from './time-clock.dto';
import { InMemoryTimeClockRepository } from './time-clock.repository';
import { TimeClockService, TimeClockForbiddenError, TimeClockValidationError, TimeClockConflictError } from './time-clock.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.manage'] };
const NOW = '2026-07-07T17:00:00.000Z';

describe('time-clock — pure helpers', () => {
  it('computes hours worked (end defaults to now), floored at 0', () => {
    expect(computeHoursWorked('2026-07-07T09:00:00Z', '2026-07-07T17:30:00Z', NOW)).toBe(8.5);
    expect(computeHoursWorked('2026-07-07T16:00:00Z', null, NOW)).toBe(1);      // open punch -> 1h to now
    expect(computeHoursWorked('2026-07-07T18:00:00Z', '2026-07-07T17:00:00Z', NOW)).toBe(0); // end<=start
    expect(computeHoursWorked(null, null, NOW)).toBe(0);
  });
  it('derives clocked_in state + hours from punches', () => {
    const punches: ShiftPunch[] = [
      { id: 's1', technicianId: 'A', startTime: '2026-07-07T09:00:00Z', endTime: '2026-07-07T12:00:00Z', status: 'completed' },
      { id: 's2', technicianId: 'A', startTime: '2026-07-07T16:00:00Z', endTime: null, status: 'active' },
    ];
    const row = deriveTechClock('A', 'Ana', punches, NOW);
    expect(row.state).toBe('clocked_in');
    expect(row.clockedInAt).toBe('2026-07-07T16:00:00Z');
    expect(row.hoursToday).toBe(4); // 3h completed + 1h open
    expect(row.shiftCount).toBe(2);
    expect(row.shifts.map((p) => p.id)).toEqual(['s1', 's2']); // punches exposed (sorted by start) so a manager can correct one
  });
  it('summary counts clocked-in + total hours', () => {
    const rows = [
      deriveTechClock('A', 'Ana', [{ id: 's1', technicianId: 'A', startTime: '2026-07-07T16:00:00Z', endTime: null, status: 'active' }], NOW),
      deriveTechClock('B', 'Ben', [{ id: 's2', technicianId: 'B', startTime: '2026-07-07T09:00:00Z', endTime: '2026-07-07T13:00:00Z', status: 'completed' }], NOW),
    ];
    const s = buildTimeClockSummary(rows);
    expect(s.technicianCount).toBe(2); expect(s.clockedInCount).toBe(1); expect(s.totalHoursToday).toBe(5); // 1 + 4
  });
});

describe('time-clock — service', () => {
  // Re-pinned (Technician Profile merge, mandate §106/§165): a double clock-in used to throw "already clocked in"
  // (and 500 under a race). New truth: ONE transition — the second call returns the existing open punch
  // (created=false), one row only.
  it('clocks in, a double clock-in is idempotent (one open punch), then clocks out', async () => {
    const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]);
    const svc = new TimeClockService(repo);
    const inRow = await svc.clockIn(ctx, 'A');
    expect(inRow.state).toBe('clocked_in'); expect(inRow.created).toBe(true);
    const again = await svc.clockIn(ctx, 'A');
    expect(again.created).toBe(false); expect(again.shiftId).toBe(inRow.shiftId);
    expect(repo.allPunches()).toHaveLength(1);
    const outRow = await svc.clockOut(ctx, 'A');
    expect(outRow.state).toBe('clocked_out');
  });
  it('allows a split shift: clock in → out → in again the same day (two punches, one open)', async () => {
    const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]);
    const svc = new TimeClockService(repo);
    await svc.clockIn(ctx, 'A'); await svc.clockOut(ctx, 'A');
    const second = await svc.clockIn(ctx, 'A');
    expect(second.created).toBe(true);
    expect(repo.allPunches()).toHaveLength(2);
    expect(repo.allPunches().filter((p) => !p.endTime)).toHaveLength(1);
  });
  it('break start/end is part of the clock: state on_break while on break, break row opened/closed, clock-out closes an open break', async () => {
    const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]);
    const svc = new TimeClockService(repo);
    await expect(svc.breakStart(ctx, 'A')).rejects.toBeInstanceOf(TimeClockConflictError);   // not clocked in
    await svc.clockIn(ctx, 'A');
    const onBreak = await svc.breakStart(ctx, 'A', { kind: 'lunch' });
    expect(onBreak.state).toBe('on_break'); expect(typeof onBreak.onBreakSince).toBe('string');
    expect(repo.allBreaks()).toHaveLength(1);
    const back = await svc.breakEnd(ctx, 'A');
    expect(back.state).toBe('clocked_in'); expect(repo.allBreaks()[0].endedAt).toBeTruthy();
    await expect(svc.breakEnd(ctx, 'A')).rejects.toBeInstanceOf(TimeClockConflictError);   // not on break
    await svc.breakStart(ctx, 'A');
    await svc.clockOut(ctx, 'A');
    expect(repo.allBreaks().every((b) => !!b.endedAt)).toBe(true);   // a break cannot outlive its shift
  });
  it('a break moves the ONE workforce state in the same call (AVAILABLE disappears immediately)', async () => {
    const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]);
    const { WorkforceStatusService } = await import('../workforce-status/workforce-status.service');
    const { InMemoryWorkforceStateStore } = await import('../workforce-status/workforce-status.repository');
    const store = new InMemoryWorkforceStateStore(); store.seedTechnician('t1', 'A', { branchId: 'b1' });
    const wf = new WorkforceStatusService(store, null);
    const svc = new TimeClockService(repo, null, wf);
    await svc.clockIn(ctx, 'A');
    expect(await wf.isAssignable('t1', 'A')).toBe(true);
    await svc.breakStart(ctx, 'A');
    expect((await wf.getTechnicianState('t1', 'A'))!.queue).toBe('BREAK');
    expect(await wf.isAssignable('t1', 'A')).toBe(false);
    await svc.breakEnd(ctx, 'A');
    expect((await wf.getTechnicianState('t1', 'A'))!.queue).toBe('AVAILABLE');
    await svc.clockOut(ctx, 'A');
    expect((await wf.getTechnicianState('t1', 'A'))!.queue).toBe('OFF_SHIFT');
  });
  it('rejects clock-out when not clocked in', async () => {
    const svc = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]));
    await expect(svc.clockOut(ctx, 'A')).rejects.toBeInstanceOf(TimeClockValidationError);
  });
  it('rejects clock-in for an unknown technician', async () => {
    const svc = new TimeClockService(new InMemoryTimeClockRepository([]));
    await expect(svc.clockIn(ctx, 'ghost')).rejects.toBeInstanceOf(TimeClockValidationError);
  });
  it('state returns roster + kpis; rejects unauthenticated', async () => {
    const svc = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]));
    const st = await svc.getState(ctx);
    expect(st.technicians).toHaveLength(1); expect(st.kpis.technicianCount).toBe(1);
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(TimeClockForbiddenError);
  });
});

describe('time-clock — realtime Staff-on-Duty push (manager path)', () => {
  it('emits time_clock_updated to the branch on clock-in and clock-out', async () => {
    const rt = { toTenant: vi.fn() };
    const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]);
    const svc = new TimeClockService(repo, rt as any);
    await svc.clockIn(ctx, 'A');
    await svc.clockOut(ctx, 'A');
    const events = rt.toTenant.mock.calls.map((c: any[]) => c[1]);
    expect(events).toContain('time_clock_updated');
    expect(events).toContain('technician_clock_updated');    // the new typed event rides alongside the legacy one
    expect(rt.toTenant.mock.calls.length).toBe(4);           // two events per clock action (re-pinned: was 1 event × 2)
    expect(rt.toTenant.mock.calls[0][0]).toEqual({ tenantId: 't1', branchId: 'b1' });   // scoped to the branch
  });

  it('is a safe no-op when no realtime emitter is present', async () => {
    const svc = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }]));
    await expect(svc.clockIn(ctx, 'A')).resolves.toBeTruthy();   // does not throw without rt
  });
});

// Oct 3 2026 — shift_date is the BRANCH's day (default America/New_York; the in-memory repository has no zone so the
// service uses the default). Before Oct 1 an evening clock-out could not find the open punch; until Oct 3 shift_date was
// the UTC day, so an 8:30 pm New Jersey clock-in was filed under tomorrow.
describe('time-clock — the branch day', () => {
  const T0 = new Date('2026-10-02T00:15:00.000Z');   // 8:15 pm EDT on Oct 1
  it("at 8:15 pm New Jersey time, today is Oct 1: both of today's shifts count; the open one can be clocked out", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    try {
      const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }], [
        { id: 'open', technicianId: 'A', startTime: '2026-10-01T20:00:00.000Z', endTime: null, status: 'active', shiftDate: '2026-10-01' },
        { id: 'done', technicianId: 'A', startTime: '2026-10-01T13:00:00.000Z', endTime: '2026-10-01T17:00:00.000Z', status: 'completed', shiftDate: '2026-10-01' },
      ] as any);
      const svc = new TimeClockService(repo);
      const row = (await svc.getState(ctx)).technicians.find((t) => t.technicianId === 'A')!;
      expect(row.state).toBe('clocked_in');
      expect(row.hoursToday).toBe(8.25);                       // 9–1 (4 h) + 4 pm–now (4.25 h): both are Oct 1 in New Jersey
      expect((await svc.clockIn(ctx, 'A')).created).toBe(false);   // re-pinned: a second clock-in returns the open punch
      const out = await svc.clockOut(ctx, 'A');
      expect(out.lastClockOutAt).toBe(T0.toISOString());
    } finally { vi.useRealTimers(); }
  });
  it('a clock-in at 8:30 pm New Jersey time is filed under that day, not tomorrow (UTC)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:30:00.000Z'));
    try {
      const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }], []);
      await new TimeClockService(repo).clockIn(ctx, 'A');
      expect((await repo.listTodayPunches(ctx as any, '2026-10-01')).length).toBe(1);
      expect((await repo.listTodayPunches(ctx as any, '2026-10-02')).length).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('a shift that crosses local midnight (11 pm → 1 am) is still found and can be clocked out', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T05:00:00.000Z'));   // 1 am EDT Oct 2
    try {
      const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }], [
        { id: 'late', technicianId: 'A', startTime: '2026-10-02T03:00:00.000Z', endTime: null, status: 'active', shiftDate: '2026-10-01' },
      ] as any);
      const svc = new TimeClockService(repo);
      expect((await svc.getState(ctx)).technicians[0].state).toBe('clocked_in');
      expect((await svc.clockOut(ctx, 'A')).lastClockOutAt).toBe('2026-10-02T05:00:00.000Z');
    } finally { vi.useRealTimers(); }
  });
  it("a punch that ended on the previous day does not count toward today", async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    try {
      const repo = new InMemoryTimeClockRepository([{ technicianId: 'A', technicianName: 'Ana' }], [
        { id: 'done', technicianId: 'A', startTime: '2026-09-30T13:00:00.000Z', endTime: '2026-09-30T17:00:00.000Z', status: 'completed', shiftDate: '2026-09-30' },
      ] as any);
      const row = (await new TimeClockService(repo).getState(ctx)).technicians[0];
      expect(row.state).toBe('off');
      expect(row.hoursToday).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
