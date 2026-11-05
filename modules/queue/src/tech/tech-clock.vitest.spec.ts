// tech-clock.vitest.spec.ts — Functional Decision 9: a technician clocks in and out from the Technician App, on the
// SAME timecard as the POS manager screen and the Go Check-In kiosk (workforce TimeClockService), as themselves only,
// at server time, and never mid-service. Uses the real TimeClockService over its in-memory repository.
import { describe, it, expect, beforeEach } from 'vitest';
import { TimeClockService, InMemoryTimeClockRepository } from '@aipowersalon/workforce';
import { TechService } from './tech.service';
import type { TechContext } from './tech.repository';

const ctx: TechContext = { tenantId: 't1', branchId: 'b1', userId: 'u-mia', role: 'TECHNICIAN' as any, permissions: ['tech.dashboard.view', 'tech.timeclock.punch'] };
const manager = { tenantId: 't1', branchId: 'b1', userId: 'm1', role: 'MANAGER', permissions: ['pos.technicians.manage'] };

let port: any; let clock: TimeClockService; let svc: TechService; let audits: string[];
beforeEach(() => {
  audits = [];
  port = {
    technicianAppFlag: true,
    technicianId: 'tech-mia' as string | null,
    hasActiveService: false,
    async technicianAppEnabled() { return this.technicianAppFlag; },
    async resolveTechnicianId() { return this.technicianId; },
    async breakContext() { return { status: 'available', hasActiveService: this.hasActiveService }; },
    async recordAudit(_c: any, _t: string, action: string) { audits.push(action); },
  };
  clock = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: 'tech-mia', technicianName: 'Mia Tran' }, { technicianId: 'tech-ana', technicianName: 'Ana Lopez' }]));
  svc = new TechService(port, undefined, undefined, undefined, clock);
});

describe('Technician App time clock (Decision 9)', () => {
  it('clock in -> the same timecard the manager sees -> clock out, at server time, audited', async () => {
    expect((await svc.myClock(ctx)).state).toBe('clocked_out');
    const before = Date.now();
    const inView = await svc.clockIn(ctx);
    expect(inView.state).toBe('clocked_in');
    expect(Date.parse(inView.clockedInAt!)).toBeGreaterThanOrEqual(before - 1000);    // the server stamped it
    const mgr = (await clock.getState(manager)).technicians.find((t) => t.technicianId === 'tech-mia')!;
    expect(mgr.state).toBe('clocked_in');                                              // one timecard, every clock
    expect((await clock.getState(manager)).technicians.find((t) => t.technicianId === 'tech-ana')!.state).not.toBe('clocked_in');

    const outView = await svc.clockOut(ctx);
    expect(outView.state).toBe('clocked_out');
    expect(outView.lastClockOutAt).not.toBeNull();
    expect(audits).toEqual(['technician_clocked_in', 'technician_clocked_out']);
  });

  it('double clock-in and clock-out-without-in are refused in plain words', async () => {
    await svc.clockIn(ctx);
    await expect(svc.clockIn(ctx)).rejects.toMatchObject({ code: 'invalid_state', message: 'You are already clocked in.' });
    await svc.clockOut(ctx);
    await expect(svc.clockOut(ctx)).rejects.toMatchObject({ code: 'invalid_state', message: 'You are not clocked in.' });
  });

  it('cannot clock out in the middle of a service', async () => {
    await svc.clockIn(ctx);
    port.hasActiveService = true;
    await expect(svc.clockOut(ctx)).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await svc.myClock(ctx)).state).toBe('clocked_in');
  });

  it('clocks only the signed-in technician; no profile / app disabled / no permission are refused', async () => {
    port.technicianId = null;
    await expect(svc.clockIn(ctx)).rejects.toMatchObject({ code: 'not_technician' });
    port.technicianId = 'tech-mia'; port.technicianAppFlag = false;
    await expect(svc.clockIn(ctx)).rejects.toMatchObject({ code: 'forbidden' });
    port.technicianAppFlag = true;
    await expect(svc.clockIn({ ...ctx, permissions: ['tech.dashboard.view'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await clock.getState(manager)).technicians.every((t) => t.state !== 'clocked_in')).toBe(true);
  });
});
