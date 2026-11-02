import { describe, it, expect } from 'vitest';
import {
  elapsedSecondsFrom, salesOnlySnapshot, canStartBreak, deriveAvailableActions, type LineSnapshot,
} from './tech-dashboard.dto';
import { buildTechDashboardState, initialsOf, type TechDashboardInput } from './tech-dashboard.core';

describe('tech-dashboard.dto pure helpers', () => {
  it('elapsedSecondsFrom computes seconds, floors, clamps to 0', () => {
    const t = '2026-06-07T05:00:00.000Z';
    expect(elapsedSecondsFrom(t, Date.parse(t) + 125_000)).toBe(125);
    expect(elapsedSecondsFrom(t, Date.parse(t) - 5_000)).toBe(0);
    expect(elapsedSecondsFrom('not-a-date')).toBe(0);
  });

  it('salesOnlySnapshot sums SALES only — commission and tips are the authority\'s (null here, ONE-PAY)', () => {
    const lines: LineSnapshot[] = [{ lineTotalCents: 5000 }, { lineTotalCents: 3000 }];
    expect(salesOnlySnapshot(lines)).toMatchObject({ todaySalesCents: 8000, tipsCents: null, estimatedCommissionCents: null });
  });

  it('canStartBreak respects active service + manager override', () => {
    expect(canStartBreak('in_service', true, false)).toBe(false);
    expect(canStartBreak('in_service', true, true)).toBe(true);
    expect(canStartBreak('available', false, false)).toBe(true);
    expect(canStartBreak('off_shift', false, false)).toBe(false);
  });

  it('deriveAvailableActions maps flags to capabilities', () => {
    const a = deriveAvailableActions('assigned', true, false, false);
    expect(a.canAcceptTicket).toBe(true);
    expect(a.canStartService).toBe(false);
    expect(a.canMarkServiceDone).toBe(false);
    const b = deriveAvailableActions('in_service', false, false, true);
    expect(b.canMarkServiceDone).toBe(true);
    expect(b.canToggleBreak).toBe(false);
  });

  it('initialsOf', () => {
    expect(initialsOf('Ana Maria Lopez')).toBe('AM');
    expect(initialsOf('Cher')).toBe('C');
    expect(initialsOf('')).toBe('?');
  });
});

describe('buildTechDashboardState', () => {
  const tech = { technicianId: 't1', fullName: 'Ana Lopez', initials: 'AL', roleLabel: 'Nail Tech', status: 'in_service' as const };
  const lines: LineSnapshot[] = [{ lineTotalCents: 5000 }];
  const started = '2026-06-07T05:00:00.000Z';

  it('assembles state with an active service (elapsed + earnings + actions)', () => {
    const input: TechDashboardInput = {
      technician: tech, todayLines: lines, bookings: 4, completed: 2, inService: 1, salesTrendPercent: 12,
      currentService: { ticketId: 'k1', queueItemId: 'q1', serviceLineId: 'l1', customerId: 'c1', customerName: 'Jdoe Smith', serviceName: 'Gel Mani', startedAt: started, status: 'serving' },
      hasAssignedUnacceptedTicket: false, hasAcceptedNotStarted: false, nowMs: Date.parse(started) + 60_000,
    };
    const s = buildTechDashboardState(input);
    expect(s.overview.totalSalesCents).toBe(5000);
    expect(s.earnings).toMatchObject({ todaySalesCents: 5000, tipsCents: null, estimatedCommissionCents: null });   // the money is TechService's (snapshot)
    expect(s.currentService?.elapsedSeconds).toBe(60);
    expect(s.currentService?.customerInitials).toBe('JS');
    expect(s.availableActions.canMarkServiceDone).toBe(true);
    expect(s.notificationsCount).toBe(0);
  });

  it('no current service + an assigned unaccepted ticket → can accept, cannot start/done', () => {
    const input: TechDashboardInput = {
      technician: { ...tech, status: 'assigned' }, todayLines: [], bookings: 1, completed: 0, inService: 0, salesTrendPercent: 0,
      hasAssignedUnacceptedTicket: true, hasAcceptedNotStarted: false,
    };
    const s = buildTechDashboardState(input);
    expect(s.currentService).toBeUndefined();
    expect(s.availableActions.canAcceptTicket).toBe(true);
    expect(s.availableActions.canStartService).toBe(false);
    expect(s.availableActions.canMarkServiceDone).toBe(false);
    expect(s.earnings.todaySalesCents).toBe(0);
  });
});
