// realtime-projection.platform-announcements — Super Admin POS Top-Bar Announcement mandate (Oct 22 2026) §76–§86, §164:
// a platform announcement event (one per TARGETED salon, written by PlatformNoticeService) becomes
// platform_announcement_updated in THAT salon's rooms only — owner, branch-less and the targeted branches — carrying ids
// and the version, never the title or the message (the POS refetches its own snapshot, which re-applies targeting).
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS, screensToRefetch } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './realtime-projection.consumer';

const T = '11111111-1111-4111-8111-111111111111', B1 = '22222222-2222-4222-8222-222222222222', B2 = '33333333-3333-4333-8333-333333333333';
function run(e: Record<string, unknown>) {
  const sent: Array<[string, string, unknown, unknown]> = [];
  const rt = {
    toTenant: (scope: any, ev: string, p: unknown) => sent.push(['tenant', ev, scope, p]),
    toOwner: (tenantId: string, ev: string, p: unknown) => sent.push(['owner', ev, tenantId, p]),
    toTechnician: (id: string, ev: string, p: unknown) => sent.push(['technician', ev, id, p]),
  };
  return new RealtimeProjectionConsumer(rt as any).handle({ tenantId: T, branchId: null, aggregateId: 'n1', payload: {}, ...e } as any).then(() => sent);
}

describe('platform announcements → the targeted salon\'s POS rooms', () => {
  it('published to a salon with two branches: owner room, branch-less room and each branch room — ids only', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.PLATFORM_ANNOUNCEMENT_PUBLISHED, payload: { announcementId: 'n1', version: 2, action: 'published', branchIds: [B1, B2] } });
    expect(sent.map((s) => [s[0], s[1], typeof s[2] === 'string' ? s[2] : (s[2] as any).branchId])).toEqual([
      ['owner', EVENTS.platformAnnouncementUpdated, T], ['tenant', EVENTS.platformAnnouncementUpdated, ''],
      ['tenant', EVENTS.platformAnnouncementUpdated, B1], ['tenant', EVENTS.platformAnnouncementUpdated, B2]]);
    expect(sent.every((s) => typeof s[2] === 'string' ? s[2] === T : (s[2] as any).tenantId === T)).toBe(true);   // never another salon
    expect(sent[0][3]).toMatchObject({ announcementId: 'n1', version: 2, action: 'published' });
    expect(Object.keys(sent[0][3] as object).filter((k) => /title|message|text/i.test(k))).toEqual([]);
  });
  it('a change (edit / pause / archive) is the same signal; a branch-targeted notice reaches only its branch room', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.PLATFORM_ANNOUNCEMENT_CHANGED, payload: { announcementId: 'n1', version: 5, action: 'paused', branchIds: [B1] } });
    expect(sent.filter((s) => s[0] === 'tenant' && (s[2] as any).branchId).map((s) => (s[2] as any).branchId)).toEqual([B1]);
    expect(JSON.stringify(sent)).not.toMatch(/message|title/);
  });
  it('the POS top bar refetches on it', () => {
    expect(screensToRefetch(EVENTS.platformAnnouncementUpdated)).toContain('platform-announcements');
  });
});
