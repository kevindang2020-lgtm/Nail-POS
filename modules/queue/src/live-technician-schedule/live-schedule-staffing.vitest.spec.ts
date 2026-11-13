// live-schedule-staffing.vitest.spec.ts — 200-technician 02 (Shift-Aware Staffing Heatmap): per hour band, over EVERY column
// the day board built (before lane paging): on shift, ready, booked, on a planned break; late / on break now only in the
// band holding "now" on the branch's today; the ids behind each count.
import { describe, it, expect } from 'vitest';
import { lsStaffingHeatmap } from './live-technician-schedule.dto';
import { LiveTechnicianScheduleService } from './live-technician-schedule.service';

const appt = (s: string, e: string, status = 'booked') => ({ appointmentId: `a-${s}`, customerName: 'G', customerInitials: 'G', serviceSummary: 'Gel', startTime: s, endTime: e, status, source: 'pos' });
const col = (id: string, o: any = {}) => ({ technicianId: id, fullName: `Tech ${id}`, initials: 'T', roleLabel: 'Nail Technician', status: 'available', skills: [], openSlots: [], blocks: [], bookedHours: 0, utilizationPercent: 0,
  appointments: [], shiftScheduled: true, clock: 'clocked_in', ...o });
const cols: any[] = [
  col('a', { shift: { startTime: '09:00', endTime: '17:00', breakStartTime: '12:00', breakEndTime: '13:00' }, appointments: [appt('10:00', '10:45'), appt('11:00', '11:30', 'cancelled')] }),
  col('b', { shift: { startTime: '11:00', endTime: '19:00' }, clock: 'clocked_out' }),                 // scheduled from 11, still clocked out
  col('c', { shift: { startTime: '09:00', endTime: '13:00' }, clock: 'on_break', appointments: [appt('11:30', '12:15', 'no_show')] }),
  col('d', { shift: { startTime: '10:00', endTime: '18:00' }, shiftScheduled: false, clock: 'clocked_out' }),   // a punch shown as a shift: never "late"
  col('e', { shift: undefined }),                                                                              // no shift: never counted
];
const range = { startTime: '09:00', endTime: '19:00' };

describe('Live Technician Schedule — staffing heatmap', () => {
  it('counts each hour band: on shift, booked, planned break, ready; late / on break only in the "now" band', () => {
    const h = lsStaffingHeatmap(cols, { date: '2026-11-12', range, live: true, nowMinute: 11 * 60 + 20 });
    expect(h.bands.map((b) => b.start)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
    const at = (s: string) => h.bands.find((b) => b.start === s)!;
    expect(at('09:00')).toMatchObject({ onShift: 2, ready: 2, booked: 0, onBreak: 0, late: null, breakNow: null, isNow: false });
    expect(at('10:00')).toMatchObject({ onShift: 3, booked: 1, ready: 2 });
    expect(at('10:00').ids.booked).toEqual(['a']);
    // 11:00 is "now": a's 11:00 booking was cancelled and c's 11:30 was a no-show → ready; b is scheduled and clocked out → late;
    // d (a punch, not a schedule) is never late; c's clock says on break
    expect(at('11:00')).toMatchObject({ isNow: true, onShift: 4, booked: 0, ready: 4, late: 1, breakNow: 1 });
    expect(at('11:00').ids.late).toEqual(['b']); expect(at('11:00').ids.breakNow).toEqual(['c']);
    expect(at('12:00')).toMatchObject({ onShift: 4, onBreak: 1, ready: 3, late: null });
    expect(at('12:00').ids.onBreak).toEqual(['a']);
    expect(at('18:00')).toMatchObject({ onShift: 1, ready: 1 });
    expect(h.names).toMatchObject({ a: 'Tech a', b: 'Tech b', c: 'Tech c', d: 'Tech d' });
    expect(h.names.e).toBeUndefined();
    for (const b of h.bands) expect(b.ready + b.booked + b.onBreak).toBe(b.onShift);
  });
  it('another day is not live: no "now" band, no late / on-break-now counts', () => {
    const h = lsStaffingHeatmap(cols, { date: '2026-11-13', range, live: false, nowMinute: 11 * 60 });
    expect(h.live).toBe(false); expect(h.nowMinute).toBeNull();
    expect(h.bands.every((b) => !b.isNow && b.late === null && b.breakNow === null)).toBe(true);
  });
  it('the page state carries the heatmap of the WHOLE roster while the board is one page of lanes', async () => {
    const many: any[] = Array.from({ length: 30 }, (_, i) => col(`t${String(i).padStart(2, '0')}`, { shift: { startTime: '09:00', endTime: '19:00' } }));
    const repo: any = { today: async () => '2026-11-12', nowMinutes: async () => 600, state: async () => ({ date: '2026-11-12', branchId: 'b1', timeRange: { ...range, slotMinutes: 30 }, technicians: many }),
      kpis: async () => ({}), filtersData: async () => ({ statuses: [], skills: [], technicians: [] }) };
    const svc = new LiveTechnicianScheduleService(repo);
    const st: any = await svc.pageState({ tenantId: 'ten', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view'] } as any, { lanePage: 1 });
    expect(st.schedule.technicians.length).toBe(12);
    expect(st.staffing.bands[0].onShift).toBe(30);
    expect(st.staffing.bands.find((b: any) => b.isNow).start).toBe('10:00');
  });
});
