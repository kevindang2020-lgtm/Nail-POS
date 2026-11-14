// schedOverlay.test.ts — the optimizer's calendar indicators become the new board's marks exactly as the Classic board
// draws them: worst open conflict per appointment, lock, AI badge (only with an opener), unused gaps with a technician.
import { describe, expect, it, vi } from 'vitest';
import type { SchedCalendarIndicators } from '@aipowersalon/api-contracts/tenant';
import { schedToBoardOverlay } from './schedOverlay';

const ind = (o: Partial<SchedCalendarIndicators> = {}): SchedCalendarIndicators => ({
  date: '2026-11-14', utilizationPct: null,
  gaps: [
    { id: 'g1', technicianId: 't1', date: '2026-11-14', startTime: '12:00', endTime: '13:00', durationMin: 60, cause: null, servicesThatFit: ['Gel'] },
    { id: 'g2', technicianId: null, date: '2026-11-14', startTime: '12:00', endTime: '13:00', durationMin: 60, cause: null, servicesThatFit: [] },
    { id: 'g3', technicianId: 't2', date: '2026-11-14', startTime: '14:00', endTime: '13:00', durationMin: 0, cause: null, servicesThatFit: [] },
  ],
  conflicts: [
    { id: 'c1', type: 'overlap', severity: 'warning', appointmentIds: ['a1', 'a2'], technicianId: 't1', date: '2026-11-14', message: '', resolved: false } as any,
    { id: 'c2', type: 'overlap', severity: 'critical', appointmentIds: ['a1'], technicianId: 't1', date: '2026-11-14', message: '', resolved: false } as any,
    { id: 'c3', type: 'overlap', severity: 'critical', appointmentIds: ['a3'], technicianId: 't1', date: '2026-11-14', message: '', resolved: true } as any,
  ],
  appointments: { a1: { recommendationId: 'r1', status: 'proposed' as any, type: 'move' as any, locked: true } },
  ...o,
});

describe('schedToBoardOverlay', () => {
  it('maps conflicts (worst wins, resolved ignored), lock, badge and gaps', () => {
    const open = vi.fn();
    const o = schedToBoardOverlay(ind(), { customerNameOf: (id) => (id === 'a1' ? 'Mai' : '') }, open)!;
    expect(o.appointments.a1.conflict).toBe('critical');
    expect(o.appointments.a2.conflict).toBe('warning');
    expect(o.appointments.a3).toBeUndefined();
    expect(o.appointments.a1.locked?.title).toBeTruthy();
    expect(o.appointments.a1.badge?.label).toBe('AI');
    expect(o.appointments.a1.badge?.ariaLabel).toContain('Mai');
    o.appointments.a1.badge!.onOpen();
    expect(open).toHaveBeenCalledWith('r1');
    expect(o.gaps.map((g) => [g.id, g.technicianId, g.startMinute, g.endMinute])).toEqual([['g1', 't1', 720, 780]]);
  });
  it('no opener → no badge (the lock and outline still show); no indicators → no overlay', () => {
    const o = schedToBoardOverlay(ind(), { customerNameOf: () => '' }, null)!;
    expect(o.appointments.a1.badge).toBeUndefined();
    expect(o.appointments.a1.locked).toBeTruthy();
    expect(schedToBoardOverlay(null, { customerNameOf: () => '' }, vi.fn())).toBeNull();
  });
});
