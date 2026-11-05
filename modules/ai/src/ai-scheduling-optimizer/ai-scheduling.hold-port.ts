// ai-scheduling.hold-port.ts — Round 3 H2 (Oct 12 2026): the optimizer's hold port (findOptions {hold} / releaseHold).
// Acquire goes through SlotHoldService.acquireLocked — under the staff booking engine's hold lock, re-checking the
// technician's appointments there — so a hold and a booking of the same slot racing in two sessions cannot both win
// (it was BookingHoldService.acquire, which never looked at appointments). Release stays BookingHoldService's
// tenant-checked release.
import { BookingHoldService, KyselyHoldRepository, SlotHoldService } from '@aipowersalon/booking';
import type { AppDatabase } from '@aipowersalon/database';
import type { SchedHoldPort } from './ai-scheduling.service';

export function schedHoldPort(db: AppDatabase): SchedHoldPort {
  const slot = new SlotHoldService(db);
  const holds = new BookingHoldService(new KyselyHoldRepository(db));
  return { acquire: (req, now) => slot.acquireLocked(req, now), release: (tenantId, holdId, reason) => holds.release(tenantId, holdId, reason) };
}
