import { describe, it, expect } from 'vitest';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, ServingContext } from './serving.repository';

// Status transitions used to be audit-log-only — invisible in the per-ticket revision timeline (P4). These now append a
// timeline revision too (via the same recordRevision path the Service Done lock already uses), so oversight/history shows
// the full story: started → paused → resumed → marked done. Seeds: sv_4001 in_service, sv_4002 paused, sv_4003 not_started,
// sv_4005 in_service.
const ctx = (over: Partial<ServingContext> = {}): ServingContext =>
  ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
    permissions: ['pos.serving.view', 'pos.serving.start', 'pos.serving.pause_resume', 'pos.serving.mark_done'], ...over });

describe('Serving lifecycle transitions appear in the revision timeline', () => {
  it('records a revision when service is started (not_started → in_service)', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.start(ctx(), 'sv_4003');
    const { currentVersion, revisions } = await svc.getRevisions(ctx(), 'sv_4003');
    expect(revisions.map((r) => r.action)).toEqual(['service_started']);
    expect(revisions[0].summary).toBe('Service started');
    expect(revisions[0].actorRole).toBe('OWNER');
    expect((revisions[0].after as any).status).toBe('in_service');   // structured timing payload
    expect(currentVersion).toBe(1);
  });

  it('records paused then resumed revisions with structured timing, in order', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.pause(ctx(), 'sv_4001');
    await svc.resume(ctx(), 'sv_4001');
    const { revisions } = await svc.getRevisions(ctx(), 'sv_4001');
    expect(revisions.map((r) => r.action)).toEqual(['service_paused', 'service_resumed']);
    expect((revisions[0].after as any).status).toBe('paused');
    expect(typeof (revisions[0].after as any).elapsedMinutes).toBe('number');   // "Paused after N min"
    expect(revisions[0].summary).toMatch(/^Paused after \d+ min$/);
  });

  it('records a marked-done revision with elapsed time (in_service → completed)', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    await svc.markDone(ctx(), 'sv_4005');
    const { revisions } = await svc.getRevisions(ctx(), 'sv_4005');
    const done = revisions.find((r) => r.action === 'service_marked_done');
    expect(done).toBeTruthy();
    expect((done!.after as any).status).toBe('completed');
    expect(typeof (done!.after as any).elapsedMinutes).toBe('number');
  });
});
