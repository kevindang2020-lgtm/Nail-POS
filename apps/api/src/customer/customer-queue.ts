// customer-queue.ts — pure customer-facing queue position + ETA. Reuses the POS queue helpers (rankQueue,
// estimateWaitMinutes) and the same in-line status set, so the customer's position and wait match what the POS shows.
// ETA is a transparent heuristic (people-ahead ÷ available technicians × avg service minutes), not a learned model.
import type { CustomerQueueState } from '@aipowersalon/api-contracts/customer';
export type { CustomerQueueState };   // owned by packages/api-contracts (Constitution 13 §13)
import { rankQueue, estimateWaitMinutes, type QueuePriority } from '@aipowersalon/queue';

// In-line statuses (mirror queue.kysely.repository ACTIVE): a guest waiting to be served.
export const QUEUE_ACTIVE = ['waiting', 'called', 'assigned', 'ready_for_tech'] as const;

export interface QueueItemRaw { queueItemId: string; priority: QueuePriority; checkedInAtMs: number }
export interface CustomerQueueRaw { myItemId: string; status: string; items: QueueItemRaw[]; availableTechnicians: number; avgServiceMinutes: number }

export function computeQueueState(raw: CustomerQueueRaw | null, nowMs: number = Date.now()): CustomerQueueState {
  if (!raw || !raw.items.length) return { inQueue: false };
  const ranked = rankQueue(
    raw.items.map((i) => ({ queueItemId: i.queueItemId, waitedMinutes: Math.max(0, (nowMs - i.checkedInAtMs) / 60000), priority: i.priority })),
    true, // VIP priority enabled (queue default)
  );
  const me = ranked.find((r) => r.queueItemId === raw.myItemId);
  if (!me) return { inQueue: false };
  const ahead = me.position - 1;
  const mid = estimateWaitMinutes(ahead, raw.avgServiceMinutes, raw.availableTechnicians);
  const min = Math.round(mid * 0.8);
  const max = Math.max(min + 5, Math.round(mid * 1.2)); // always show a small floor so "you're next" still reads as a short wait
  return { inQueue: true, queueItemId: raw.myItemId, position: me.position, totalWaiting: raw.items.length, estimatedWaitMinMinutes: min, estimatedWaitMaxMinutes: max, status: raw.status };
}
