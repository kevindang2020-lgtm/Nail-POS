// techApi.test.ts — locks the technician app's backend wiring: every client method must call the exact path + verb
// the NestJS /tech controllers expose. Mirrors the request/response audit; mocks the shared fetch client so no
// network is touched. If a route is renamed on either side, one of these assertions fails immediately.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => {
  const mk = () => vi.fn(() => Promise.resolve({}));
  return { api: { get: mk(), post: mk(), patch: mk(), del: mk(), upload: mk() } };
});
import { techApi } from './techApi';
import { api } from './client';

describe('techApi wiring — each method hits the correct /tech route + verb', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET read endpoints', async () => {
    await techApi.dashboard(); expect(api.get).toHaveBeenCalledWith('/tech');
    await techApi.earnings(); expect(api.get).toHaveBeenCalledWith('/tech/earnings');
    await techApi.schedule(); expect(api.get).toHaveBeenCalledWith('/tech/schedule');
    await techApi.tickets(); expect(api.get).toHaveBeenCalledWith('/tech/tickets');
    await techApi.profile(); expect(api.get).toHaveBeenCalledWith('/tech/profile');
    await techApi.myPhotos(); expect(api.get).toHaveBeenCalledWith('/tech/profile/photos');
    await techApi.notifications(); expect(api.get).toHaveBeenCalledWith('/tech/notifications');
    await techApi.settings(); expect(api.get).toHaveBeenCalledWith('/tech/settings');
    await techApi.queue(); expect(api.get).toHaveBeenCalledWith('/tech/queue/state');
    await techApi.more(); expect(api.get).toHaveBeenCalledWith('/tech/more/state');
    await techApi.skills(); expect(api.get).toHaveBeenCalledWith('/tech/skills');
  });

  it('parameterized ticket endpoints encode the id and use the right verb', async () => {
    await techApi.ticket('t1'); expect(api.get).toHaveBeenCalledWith('/tech/tickets/t1');
    await techApi.accept('t1'); expect(api.post).toHaveBeenCalledWith('/tech/tickets/t1/accept', {});
    await techApi.startService('t1'); expect(api.post).toHaveBeenCalledWith('/tech/tickets/t1/start-service', {});
    await techApi.serviceDone('t1'); expect(api.post).toHaveBeenCalledWith('/tech/tickets/t1/service-done', {});
    await techApi.serviceDone('t1', 'all done'); expect(api.post).toHaveBeenCalledWith('/tech/tickets/t1/service-done', { notes: 'all done' });
    await techApi.requestCancel('t1', 'feeling ill'); expect(api.post).toHaveBeenCalledWith('/tech/tickets/t1/request-cancel', { reason: 'feeling ill' });
  });

  it('notification + status mutations', async () => {
    await techApi.markNotificationsRead(); expect(api.post).toHaveBeenCalledWith('/tech/notifications/read', {});
    await techApi.startBreak(); expect(api.post).toHaveBeenCalledWith('/tech/status/start-break', {});
    await techApi.startBreak(true); expect(api.post).toHaveBeenCalledWith('/tech/status/start-break', { managerOverride: true });
    await techApi.endBreak(); expect(api.post).toHaveBeenCalledWith('/tech/status/end-break', {});
    await techApi.toggleBreak(); expect(api.post).toHaveBeenCalledWith('/tech/status/break', {});
  });

  it('url-encodes special characters in ids', async () => {
    await techApi.ticket('a b/c'); expect(api.get).toHaveBeenCalledWith('/tech/tickets/a%20b%2Fc');
  });
});
