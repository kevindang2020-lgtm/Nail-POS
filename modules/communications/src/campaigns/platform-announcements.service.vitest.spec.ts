import { describe, it, expect } from 'vitest';
import { PlatformAnnouncementsService } from './platform-announcements.service';
import { InMemoryAnnouncementRepo } from './platform-announcements.repository';

const svc = (tenants = 20) => new PlatformAnnouncementsService(new InMemoryAnnouncementRepo(), async () => tenants);

describe('PlatformAnnouncementsService', () => {
  it('rejects invalid input', async () => {
    const r = await svc().create({ title: '', audienceScope: 'selected_tenants', tenantIds: [] });
    expect(r.ok).toBe(false);
    expect(r.errors && r.errors.length).toBeTruthy();
  });

  it('creates an all-tenants announcement as draft with an estimated audience', async () => {
    const r = await svc(20).create({ title: 'Holiday Notice', channel: 'email', audienceScope: 'all_tenants' });
    expect(r.ok).toBe(true);
    expect(r.announcement!.status).toBe('draft');
    expect(r.announcement!.audienceSize).toBe(20);
  });

  it('creates a selected-tenants announcement and appears in oversight as platform', async () => {
    const s = svc();
    const r = await s.create({ title: 'Beta invite', channel: 'push', audienceScope: 'selected_tenants', tenantIds: ['t1', 't2'] });
    expect(r.ok).toBe(true);
    expect(r.announcement!.audienceSize).toBe(2);
    const oversight = await s.listForOversight();
    expect(oversight[0].ownerType).toBe('platform');
    expect(oversight[0].name).toBe('Beta invite');
  });

  it('gates lifecycle transitions and requires a cancel reason', async () => {
    const s = svc();
    const c = await s.create({ title: 'X', audienceScope: 'all_tenants' });
    const id = c.announcement!.id;
    expect((await s.cancel(id, '')).ok).toBe(false);            // reason required
    expect((await s.cancel(id, 'superseded')).ok).toBe(true);   // draft → cancelled ok
    const send = await s.send(id);                               // cancelled → sending blocked
    expect(send.ok).toBe(false);
  });
});
