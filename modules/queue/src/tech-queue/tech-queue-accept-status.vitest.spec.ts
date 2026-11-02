// tech-queue-accept-status.vitest.spec.ts — pins what an accepted offer becomes. TechQueueService.accept used to pass
// `!settings.technicianMustAcceptTicket || true` to the repo; the `|| true` made the setting dead, so every salon's accept
// has always landed on 'ready_to_start'. The Oct 26 2026 dead-code pass removed the dead operand WITHOUT changing that
// behaviour; this spec fails if someone changes the label silently (either way). Splitting the labels by setting would
// shift the live dashboard's Accepted / Ready-to-start KPIs, so it is a product decision for Kevin, not a cleanup.
import { describe, it, expect } from 'vitest';
import { InMemoryTechQueueRepository, type TechQueueContext } from './tech-queue.repository';
import { TechQueueService } from './tech-queue.service';
import { DEFAULT_TQ_SETTINGS } from './tech-queue.dto';

const PERMS = ['pos.tech_queue.view', 'pos.tech_queue.accept', 'pos.tech_queue.reassign', 'pos.serving.view'];   // reassign = the supervisory key (acts on any tech's ticket)
const owner: TechQueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };

function serviceWith(technicianMustAcceptTicket: boolean) {
  const repo = new InMemoryTechQueueRepository();
  repo.settings = async () => ({ ...DEFAULT_TQ_SETTINGS, technicianMustAcceptTicket });
  return new TechQueueService(repo);
}

describe('TechQueueService.accept — resulting status', () => {
  for (const mustAccept of [true, false]) {
    it(`lands on ready_to_start when technicianMustAcceptTicket=${mustAccept}`, async () => {
      const detail = await serviceWith(mustAccept).accept(owner, 'tq_6001');   // tq_6001 is seeded waiting_for_acceptance
      expect(detail.status).toBe('ready_to_start');
    });
  }
});
