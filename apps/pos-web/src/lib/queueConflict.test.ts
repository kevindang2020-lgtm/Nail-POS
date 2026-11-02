import { describe, it, expect } from 'vitest';
import { isQueueConflict, queueConflictMessage } from './queueConflict';

// BUILD_PLAN Phase 6 (audit bug 10): one plain-words message for a queue 409 — never "Conflict" or a code.
const names = (t: string) => ({ t1: 'Mia', t2: 'Leo' } as Record<string, string>)[t];
describe('queueConflictMessage', () => {
  it('names the technician who has the guest now', () => {
    expect(queueConflictMessage({ status: 409, body: { currentTechnicianId: 't2' } }, 'Ann', names)).toBe('Someone else changed Ann first — they are now with Leo. The queue has been refreshed; nothing was changed.');
  });
  it('says "unassigned" when the server reports nobody', () => {
    expect(queueConflictMessage({ status: 409, body: { currentTechnicianId: null } }, 'Ann', names)).toMatch(/they are now unassigned/);
  });
  it('explains a lock from the queue\'s ASSIGNMENT_LOCKED body', () => {
    expect(queueConflictMessage({ status: 409, code: 'ASSIGNMENT_LOCKED', body: { code: 'ASSIGNMENT_LOCKED', lock: { technicianId: 't1', reason: 'regular' } } }, 'Ann', names)).toBe('Ann is locked to Mia (“regular”). A manager has to unlock the guest first. Nothing was changed.');
    expect(queueConflictMessage({ status: 409, body: { code: 'ASSIGNMENT_LOCKED', lock: { technicianId: null, reason: null } } }, 'Ann', names)).toMatch(/^Ann is locked as "do not assign yet"\./);
  });
  it('reads the VERSION_CONFLICT body', () => {
    expect(queueConflictMessage({ status: 409, code: 'VERSION_CONFLICT', body: { code: 'VERSION_CONFLICT', currentTechnicianId: 't1', currentVersion: 7 } }, 'Ann', names)).toMatch(/they are now with Mia/);
  });
  it('falls back to a plain sentence without details', () => {
    const m = queueConflictMessage({ status: 409, message: 'Conflict' }, null);
    expect(m).toMatch(/^Someone else changed this guest at the same time/);
    expect(m).not.toMatch(/Conflict/);
  });
  it('only 409 counts as a conflict', () => {
    expect(isQueueConflict({ status: 409 })).toBe(true);
    expect(isQueueConflict({ status: 400 })).toBe(false);
    expect(isQueueConflict(null)).toBe(false);
  });
});
