import { describe, it, expect } from 'vitest';
import { TechnicianClockManagementService } from './technician-clock-management.service';
import { InMemoryClockManagementRepository } from './technician-clock-management.repository';
import { TechnicianClockPinService } from './technician-clock-pin.service';
import { InMemoryClockPinRepository } from './technician-clock-pin.repository';

const CTX = { tenantId: 'T', branchId: 'B', userId: 'mgr-1', role: 'OWNER' };
const START = '2026-07-16T14:00:00.000Z';

function build() {
  const pins = new TechnicianClockPinService(new InMemoryClockPinRepository());
  const repo = new InMemoryClockManagementRepository();
  const svc = new TechnicianClockManagementService(pins, repo);
  return { svc, pins, repo };
}

describe('TechnicianClockManagementService — manager PIN reset', () => {
  it('sets a working PIN and audits the reset (never stores plaintext)', async () => {
    const { svc, pins, repo } = build();
    await svc.resetPin(CTX, 'tech-1', '7391');
    expect(repo.audits.some((a) => a.action === 'technician_clock_pin_reset')).toBe(true);
    const v = await pins.identifyByPin({ tenantId: 'T', branchId: 'B' }, '7391', new Date().toISOString());
    expect(v.outcome).toBe('identified');
  });

  it('rejects a weak PIN', async () => {
    const { svc } = build();
    await expect(svc.resetPin(CTX, 'tech-1', '0000')).rejects.toThrow();
  });
});

describe('TechnicianClockManagementService — timecard adjustment', () => {
  it('requires a reason', async () => {
    const { svc, repo } = build();
    repo.seedShift({ id: 'sh1', technicianId: 'tech-1', branchId: 'B', startTime: START, endTime: null });
    await expect(svc.adjustTimecard(CTX, 'sh1', { endTime: '2026-07-16T18:00:00.000Z', reason: '  ' })).rejects.toMatchObject({ code: 'reason_required' });
  });

  it('preserves the original, applies the correction, records actor + reason, and audits', async () => {
    const { svc, repo } = build();
    repo.seedShift({ id: 'sh1', technicianId: 'tech-1', branchId: 'B', startTime: START, endTime: null });   // missed clock-out
    const res = await svc.adjustTimecard(CTX, 'sh1', { endTime: '2026-07-16T18:00:00.000Z', reason: 'Missed clock-out' });
    expect(res.adjustments).toBe(1);
    const adj = repo.adjustments.find((a) => a.field === 'end_time');
    expect(adj?.originalValue).toBe(null);                       // original preserved (was a missed clock-out)
    expect(adj?.newValue).toBe('2026-07-16T18:00:00.000Z');
    expect(adj?.reason).toBe('Missed clock-out');
    expect(adj?.adjustedBy).toBe('mgr-1');
    const shift = await repo.getShift(CTX, 'sh1');
    expect(shift?.endTime).toBe('2026-07-16T18:00:00.000Z');     // correction applied to the punch
    expect(repo.audits.some((a) => a.action === 'technician_timecard_adjusted')).toBe(true);
  });

  it('rejects an unknown timecard entry', async () => {
    const { svc } = build();
    await expect(svc.adjustTimecard(CTX, 'nope', { endTime: '2026-07-16T18:00:00.000Z', reason: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a clock-out that is not after clock-in', async () => {
    const { svc, repo } = build();
    repo.seedShift({ id: 'sh2', technicianId: 'tech-1', branchId: 'B', startTime: START, endTime: null });
    await expect(svc.adjustTimecard(CTX, 'sh2', { endTime: '2026-07-16T13:00:00.000Z', reason: 'bad' })).rejects.toMatchObject({ code: 'invalid_range' });
  });

  it('rejects when nothing actually changes', async () => {
    const { svc, repo } = build();
    repo.seedShift({ id: 'sh3', technicianId: 'tech-1', branchId: 'B', startTime: START, endTime: null });
    await expect(svc.adjustTimecard(CTX, 'sh3', { startTime: START, reason: 'no-op' })).rejects.toMatchObject({ code: 'no_changes' });
  });
});
