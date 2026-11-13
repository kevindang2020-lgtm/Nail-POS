import { describe, it, expect } from 'vitest';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { serviceDoneReadiness, DEFAULT_SERVING_SETTINGS } from './serving.dto';

// extras Serving 05 — "why a Visit is or is not ready for Service Done": THE gates (canMarkDone / canSendToServiceDone) and
// the person's permissions, returned on the ticket detail; read only.
const ctx = (permissions: string[]): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'MANAGER', permissions } as ServingContext);
const VIEW = 'pos.serving.view';
const SEND = ['pos.serving.send_to_service_done', 'pos.service_done.view'];
const MARK = 'pos.serving.mark_done';

describe('serviceDoneReadiness (pure)', () => {
  const base = { settings: DEFAULT_SERVING_SETTINGS, lines: [{ status: 'done' }, { status: 'serving' }, { status: 'assigned' }], canMarkReady: true, canSend: true };
  it('states each case and never counts done lines as open', () => {
    expect(serviceDoneReadiness({ ...base, status: 'in_service' })).toEqual({ state: 'ready', reasons: [], openServiceLines: 2, via: 'send_to_service_done' });
    expect(serviceDoneReadiness({ ...base, status: 'in_service', canSend: false })).toMatchObject({ state: 'ready', via: 'mark_ready' });
    expect(serviceDoneReadiness({ ...base, status: 'not_started' })).toMatchObject({ state: 'not_ready', reasons: ['NOT_STARTED'] });
    expect(serviceDoneReadiness({ ...base, status: 'sent_to_service_done' })).toMatchObject({ state: 'handed_off', reasons: [] });
    expect(serviceDoneReadiness({ ...base, status: 'completed', canSend: false })).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect(serviceDoneReadiness({ ...base, status: 'paused', canSend: false, canMarkReady: false })).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect(serviceDoneReadiness({ ...base, status: 'delayed', canSend: false, notes: '  ', settings: { ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true } })).toMatchObject({ state: 'not_ready', reasons: ['NOTES_REQUIRED'] });
    expect(serviceDoneReadiness({ ...base, status: 'delayed', canSend: false, notes: 'ok', settings: { ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true } })).toMatchObject({ state: 'ready', via: 'mark_ready' });
  });
});

describe('GET serving ticket detail carries serviceDoneReadiness that agrees with the real transitions', () => {
  it('send holder: ready via send; after the send the visit reads handed_off', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    const d = await svc.detail(ctx([VIEW, ...SEND]), 'sv_4001');
    expect(d.serviceDoneReadiness).toMatchObject({ state: 'ready', via: 'send_to_service_done' });
    expect(d.serviceDoneReadiness!.openServiceLines).toBe(d.services.filter((l) => l.status !== 'done').length);
    await svc.sendToServiceDone(ctx([VIEW, ...SEND]), 'sv_4001');
    expect((await svc.detail(ctx([VIEW, ...SEND]), 'sv_4001')).serviceDoneReadiness).toMatchObject({ state: 'handed_off' });
  });

  it('notes rule: NOTES_REQUIRED is shown exactly when Mark Ready refuses for it', async () => {
    const repo = new InMemoryServingRepository();
    repo.settings = async () => ({ ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true });
    const svc = new ServingService(repo);
    const c = ctx([VIEW, MARK]);
    const d = await svc.detail(c, 'sv_4005');
    expect(d.serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NOTES_REQUIRED'] });
    await expect(svc.markDone(c, 'sv_4005')).rejects.toThrow(/NOTES_REQUIRED/);
  });

  it('view-only: not ready — no permission; a guest not started: NOT_STARTED; reading moves nothing', async () => {
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo);
    expect((await svc.detail(ctx([VIEW]), 'sv_4001')).serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect((await svc.detail(ctx([VIEW, ...SEND]), 'sv_4003')).serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NOT_STARTED'] });
    expect((await svc.detail(ctx([VIEW]), 'sv_4001')).status).toBe('in_service');
    expect(await repo.serviceDoneLock(ctx([VIEW]), 'sv_4001')).toBeNull();
  });
});
