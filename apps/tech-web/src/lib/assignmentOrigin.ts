// assignmentOrigin.ts — BUILD_PLAN Phase 6 (ai_queue_assignment): how a guest came to THIS technician, from the queue's
// assign `source` and its assignment lock (agent A's queue domain: `assignTechnician(..., { source })` records
// 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair', and 'customer' when the guest accepted another technician;
// `lock = { technicianId | null, reason }` pins a guest). The audit's UI row "Tech: no AI-specific additions".
//
// The tech payload (GET /tech/queue/state entries, GET /tech/tickets/:id) carries them as the contract's
// TechAssignmentSignals (assignSource / lock / lockedToYou — absent for a ticket with no queue row): nothing is shown
// until the server sends them (never a guessed label). Pure.
import type { TechAssignmentSignals } from '@aipowersalon/api-contracts/tenant';

export type AssignmentOriginFields = TechAssignmentSignals & {
  /** the entry is assigned to the signed-in technician (TechQueueEntry.mine) */
  mine?: boolean;
};
export interface OriginBadge { key: 'ai' | 'auto' | 'locked' | 'customer'; label: string; title: string }

export function assignmentOrigin(e: AssignmentOriginFields, myTechnicianId?: string | null): OriginBadge[] {
  const out: OriginBadge[] = [];
  if (e.assignSource === 'ai_suggestion') out.push({ key: 'ai', label: 'Suggested by AI', title: 'The front desk accepted the AI’s suggestion to send this guest to you.' });
  else if (e.assignSource === 'auto_assign') out.push({ key: 'auto', label: 'Auto-assigned', title: 'The salon’s AI auto-assignment sent this guest to you.' });
  else if (e.assignSource === 'customer') out.push({ key: 'customer', label: 'Guest chose you', title: 'Their requested technician was busy and the guest agreed to see you instead.' });
  // "Locked to you": agent A's server computes `lockedToYou` (the active lock names this technician) — when it sent a
  // boolean, that is the answer. Older payloads without it: the lock names this technician, or (id unknown) a lock on a
  // guest ASSIGNED to you — the queue refuses to move a locked guest to anyone but the locked technician.
  const lockedTo = e.lock?.technicianId ?? null;
  const locked = typeof e.lockedToYou === 'boolean'
    ? e.lockedToYou
    : (!!lockedTo && (myTechnicianId ? lockedTo === myTechnicianId : e.mine === true));
  if (locked) out.push({ key: 'locked', label: 'Locked to you', title: e.lock?.reason ? `Locked: ${e.lock.reason}` : 'The front desk locked this guest to you.' });
  return out;
}
