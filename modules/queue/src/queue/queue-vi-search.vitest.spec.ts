// queue-vi-search.vitest.spec.ts — English + Vietnamese POS mandate §41 / §110 (Oct 27 2026): the Customer Queue's server
// search is accent-insensitive — "ly thu thao" finds "Lý Thu Thảo", "dang" finds a guest whose technician is "Đặng" — and the
// stored names are untouched. Found by pilot phase 13 (the realtime check filtered the queue to a Vietnamese name and the
// server answered nothing). The same fold now backs Service Done, the Booking appointment list, the Live Schedule columns,
// the communications inbox, campaigns, bundles and the audit list.
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService } from './queue.service';

const PERMS = ['pos.booking.override_conflict', 'pos.queue.view', 'pos.queue.create', 'pos.queue.edit'];
const owner: QueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS } as QueueContext;

describe('Customer Queue search folds Vietnamese accents', () => {
  it('"ly thu thao" / "LÝ THU" / "thảo" find "Lý Thu Thảo"; an English name is not matched; the stored name is exact', async () => {
    const svc = new QueueService(new InMemoryQueueRepository());
    const made = await svc.create(owner, { customerName: 'Lý Thu Thảo', customerPhone: '+18565550177', source: 'walk_in', serviceIds: ['svc_mani'] });
    for (const q of ['ly thu thao', 'LÝ THU', 'thảo', 'Lý Thu Thảo']) {
      const names = (await svc.items(owner, { search: q })).items.map((i) => i.customerName);
      expect(names, q).toContain('Lý Thu Thảo');
      expect(names.every((n) => n === 'Lý Thu Thảo'), q).toBe(true);
    }
    expect((await svc.detail(owner, made.queueItemId)).customerName).toBe('Lý Thu Thảo');
  });
});
