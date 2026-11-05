import { t } from '@aipowersalon/mobile-sdk/i18n';
// queueConflict.ts — one plain-words message for a queue 409 (BUILD_PLAN Phase 6, audit bug 10 / contract §A).
//
// Every assign, drag-drop, Auto Balance apply, reorder and AI decision now tells the server which technician (and which
// queue version) this screen showed. When another device changed the guest first the server refuses with 409 and the
// queue's `{ code: 'VERSION_CONFLICT', currentTechnicianId, currentVersion }` or `{ code: 'ASSIGNMENT_LOCKED', lock }`. Staff must read what happened, not "Conflict" or a stack of codes — and
// nothing was changed, so the message says that too.
export type ConflictLike = { status?: number; code?: string; message?: string; body?: any } | null | undefined;

const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);
export function isQueueConflict(e: ConflictLike): boolean { return !!e && e.status === 409; }

/** nameOf: technicianId → display name (falls back to "another technician"). */
export function queueConflictMessage(e: ConflictLike, guestName: string | null | undefined, nameOf: (technicianId: string) => string | null | undefined = () => null, outcome: 'changed' | 'assigned' = 'changed'): string {
  const who = guestName || '';   // '' = no name: the sentence says "this guest" (lower-case mid-sentence, capitalised to start one)
  const whoMid = who || t('pos.this_guest');
  const whoStart = who || cap(t('pos.this_guest'));
  const tail = t(outcome === 'assigned' ? 'admin.conflict.tailAssigned' : 'admin.conflict.tailChanged');
  const body = (e && e.body) || {};
  const code = String((e && e.code) || body.code || '');
  const cur: string | null | undefined = body.currentTechnicianId;
  // the queue's ASSIGNMENT_LOCKED carries the lock: { technicianId (null = "do not assign yet"), reason }
  if (code === 'ASSIGNMENT_LOCKED' || /LOCK/i.test(code)) {
    const lock = body.lock || null; const lt: string | null | undefined = lock ? lock.technicianId : cur;
    const to = lt ? t('pos.to_v0', { v0: String(nameOf(lt) || lock?.technicianName || t('pos.another_technician')) }) : lock ? t('pos.as_do_not_assign_yet') : '';
    return t('pos.who_is_locked_to_v2_a_99sh', { who: String(whoStart), to: String(to), v2: String(lock?.reason ? ` (“${lock.reason}”)` : '') });
  }
  if (cur === null) return t('admin.conflict.nowUnassigned', { who: whoMid, tail });
  if (cur) return t('admin.conflict.nowWith', { who: whoMid, tech: nameOf(cur) || t('pos.another_technician'), tail });
  return t('pos.someone_else_changed_v0_at_the_dwl3', { v0: String(whoMid) });
}

/** A 409 from the plan writer (POST pos/queue/plans/assign, or a plan decision that assigns): the queue's
 *  `{ code: 'VERSION_CONFLICT', queueItemId, serviceId?, currentTechnicianId, currentVersion }` or ASSIGNMENT_LOCKED.
 *  A `serviceId` means ONE service of the visit changed on another device — name that service. All or none: nothing was
 *  assigned, so the message says so. */
export function planConflictMessage(e: ConflictLike, guestName: string | null | undefined, nameOf: (technicianId: string) => string | null | undefined = () => null, serviceNameOf: (serviceId: string) => string | null | undefined = () => null): string {
  const body = (e && e.body) || {};
  const code = String((e && e.code) || body.code || '');
  const sid: string | undefined = body.serviceId || undefined;
  // the lock / generic sentences come from the catalogue and end in "Nothing was changed." — for a plan, nothing was ASSIGNED
  if (!sid || code === 'ASSIGNMENT_LOCKED' || /LOCK/i.test(code)) return queueConflictMessage(e, guestName, nameOf, 'assigned').replace(t('admin.conflict.sentenceChanged'), t('admin.conflict.sentenceAssigned'));
  const svc = serviceNameOf(sid) || t('pos.one_of_the_services');
  const who = guestName || t('pos.this_guest');
  const cur: string | null | undefined = body.currentTechnicianId;
  const now = cur ? t('pos.it_is_now_with_v0', { v0: String(nameOf(cur) || t('pos.another_technician')) }) : cur === null ? t('pos.it_is_now_unassigned') : t('pos.it_changed');
  return t('admin.conflict.serviceChanged', { service: svc, who, now });
}
