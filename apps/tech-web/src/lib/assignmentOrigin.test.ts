// BUILD_PLAN Phase 6 (ai_queue_assignment) — how a guest came to the technician: the assign source + the lock. Never a
// guessed label: no source / lock → no chip; a lock to SOMEONE ELSE or to nobody is never "Locked to you".
import { describe, it, expect } from 'vitest';
import { assignmentOrigin } from './assignmentOrigin';

const labels = (...a: Parameters<typeof assignmentOrigin>) => assignmentOrigin(...a).map((b) => b.label);

describe('assignmentOrigin', () => {
  it('maps the queue assign source', () => {
    expect(labels({ assignSource: 'ai_suggestion' })).toEqual(['Suggested by AI']);
    expect(labels({ assignSource: 'auto_assign' })).toEqual(['Auto-assigned']);
    expect(labels({ assignSource: 'customer' })).toEqual(['Guest chose you']);
    expect(labels({ assignSource: 'staff' })).toEqual([]);
    expect(labels({ assignSource: 'repair' })).toEqual([]);
    expect(labels({})).toEqual([]);
  });

  it('"Locked to you" when the server says so, or the lock names this technician', () => {
    expect(labels({ lockedToYou: true })).toEqual(['Locked to you']);
    expect(labels({ lock: { technicianId: 't1', reason: null } }, 't1')).toEqual(['Locked to you']);
    expect(labels({ lock: { technicianId: 't2', reason: null }, mine: true }, 't1')).toEqual([]);   // locked to another technician
    expect(labels({ lock: { technicianId: 't1', reason: null }, lockedToYou: false }, 't1')).toEqual([]);   // the server's boolean wins
  });

  it('without the signed-in id, a lock on a guest assigned to you is a lock to you; never on someone else\'s guest', () => {
    expect(labels({ lock: { technicianId: 't1', reason: null }, mine: true })).toEqual(['Locked to you']);
    expect(labels({ lock: { technicianId: 't1', reason: null }, mine: false })).toEqual([]);
    expect(labels({ lock: { technicianId: 't1', reason: null } })).toEqual([]);
    expect(labels({ lock: { technicianId: 't1', reason: null }, mine: true, lockedToYou: false })).toEqual([]);   // the server's word wins
  });

  it('a lock to nobody (kept unassigned) is never "Locked to you"', () => {
    expect(labels({ lock: { technicianId: null, reason: 'Waiting for a specific tech' }, mine: true, lockedToYou: false })).toEqual([]);
    expect(labels({ lock: { technicianId: null, reason: 'Waiting for a specific tech' }, mine: true })).toEqual([]);
  });

  it('source and lock combine, and the lock reason is the chip title', () => {
    const b = assignmentOrigin({ assignSource: 'auto_assign', lock: { technicianId: 't1', reason: 'Regular client' }, lockedToYou: true, mine: true });
    expect(b.map((x) => x.label)).toEqual(['Auto-assigned', 'Locked to you']);
    expect(b[1]!.title).toBe('Locked: Regular client');
  });
});
