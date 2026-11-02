// community-projection.vitest.spec — BUILD_PLAN Phase 8 (agent C): every community.* domain event reaches the Safety
// Community screens ONLY through this projection. A community event concerns a whole SALON: it goes to that salon's owner
// room, its branch-less room and EVERY branch room the payload names (a POS user hears only tenant:<t>:branch:<own>), so
// every user of the recipient salon hears it — and nothing reaches any other salon. Payloads: ids + status / severity /
// category only (never a title, a body, another salon's id or the branch list itself).
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer, projectToClient } from './consumers/realtime-projection.consumer';

const id = (n: number) => `c8c8c8c8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SALON_B = id(1), B1 = id(2), B2 = id(3), POST = id(10), COMMENT = id(11), SALON_A = id(20);
const COMMUNITY_TYPES = Object.entries(DOMAIN_EVENTS).filter(([k]) => k.startsWith('COMMUNITY_')).map(([, v]) => v);

/** A fake bus that records the ROOM each emission lands in (the same room keys the real bus fans out to). */
function bus() {
  const sent: { room: string; event: string; payload: any }[] = [];
  return {
    sent,
    rt: {
      toTenant: (ctx: any, event: string, payload: any) => sent.push({ room: rooms.tenantBranch(ctx.tenantId, ctx.branchId), event, payload }),
      toOwner: (t: string, event: string, payload: any) => sent.push({ room: rooms.ownerTenant(t), event, payload }),
    } as any,
  };
}
const ev = (eventType: string, over: Record<string, unknown> = {}) => ({ eventType, tenantId: SALON_B, branchId: null, aggregateId: POST, payload: {}, ...over }) as any;

// §43 (Oct 21 2026): every projected payload also carries the resource envelope { resourceType, resourceId, resourceVersion };
// these assertions are about the DOMAIN fields, so the envelope is stripped before comparing.
const bare = (p: any) => { const { resourceType: _t, resourceId: _i, resourceVersion: _v, resourceVersionSource: _s, ...rest } = p ?? {}; return rest; };
describe('community.* → realtime projection', () => {
  it('the consumer subscribes to the community events it projects (advisory_*, comment_*, alert, settings)', () => {
    const types = new RealtimeProjectionConsumer(null).eventTypes as string[];
    for (const t of [DOMAIN_EVENTS.COMMUNITY_ADVISORY_SUBMITTED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_APPROVED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED,
      DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_REMOVED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_RETURNED,
      DOMAIN_EVENTS.COMMUNITY_COMMENT_ADDED, DOMAIN_EVENTS.COMMUNITY_COMMENT_REMOVED, DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED, DOMAIN_EVENTS.COMMUNITY_SETTINGS_CHANGED]) {
      expect(types).toContain(t);
    }
    // moderation-internal events never reach a tenant screen
    for (const t of [DOMAIN_EVENTS.COMMUNITY_MODERATION_CASE_OPENED, DOMAIN_EVENTS.COMMUNITY_MODERATION_ACTION_TAKEN, DOMAIN_EVENTS.COMMUNITY_TENANT_RESTRICTED, DOMAIN_EVENTS.COMMUNITY_EVIDENCE_SCANNED]) {
      expect(projectToClient(ev(t))).toEqual([]);
    }
    expect(COMMUNITY_TYPES.length).toBeGreaterThanOrEqual(14);
  });

  it('alert_delivered (a branch-less, salon-wide event) reaches EVERY user of the recipient salon: owner room + branch-less room + each branch room', async () => {
    const { sent, rt } = bus();
    await new RealtimeProjectionConsumer(rt).handle(ev(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED, {
      payload: { postId: POST, severity: 'critical', category: 'phone_scam', title: 'Caller asks for gift cards', kind: 'published', branchIds: [B1, B2] },
    }));
    expect(sent.map((s) => s.room).sort()).toEqual([rooms.ownerTenant(SALON_B), rooms.tenantBranch(SALON_B, ''), rooms.tenantBranch(SALON_B, B1), rooms.tenantBranch(SALON_B, B2)].sort());
    for (const s of sent) {
      expect(s.event).toBe(EVENTS.communityAlert);
      expect(bare(s.payload)).toEqual({ postId: POST, severity: 'critical', category: 'phone_scam' });   // no title, no branch list
    }
    expect(sent.some((s) => s.room.includes(SALON_A))).toBe(false);
  });

  it('a POS front-desk user in branch B2 is in one of those rooms (the case a plain toTenant with no branch misses)', async () => {
    const { sent, rt } = bus();
    await new RealtimeProjectionConsumer(rt).handle(ev(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED, { payload: { postId: POST, severity: 'high', category: 'phone_scam', branchIds: [B1, B2] } }));
    expect(sent.map((s) => s.room)).toContain(rooms.tenantBranch(SALON_B, B2));
  });

  it('branch ids that are not ids are ignored; the envelope branch is added once', async () => {
    const { sent, rt } = bus();
    await new RealtimeProjectionConsumer(rt).handle(ev(DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED, { branchId: B1, payload: { postId: POST, status: 'published_unverified', branchIds: ['x', B1] } }));
    expect(sent.map((s) => s.room).sort()).toEqual([rooms.ownerTenant(SALON_B), rooms.tenantBranch(SALON_B, ''), rooms.tenantBranch(SALON_B, B1)].sort());
    expect(sent[0]).toMatchObject({ event: EVENTS.communityPostUpdated, payload: { postId: POST, status: 'published_unverified' } });
  });

  it('advisory_* → community_post_updated { postId, status }; comment → community_comment_added { postId, commentId }; settings → { version }', () => {
    for (const t of [DOMAIN_EVENTS.COMMUNITY_ADVISORY_SUBMITTED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_APPROVED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED,
      DOMAIN_EVENTS.COMMUNITY_ADVISORY_REMOVED, DOMAIN_EVENTS.COMMUNITY_ADVISORY_RETURNED]) {
      expect(projectToClient(ev(t, { payload: { postId: POST, status: 'removed', reason: 'secret', title: 'x' } }))).toEqual([{ event: EVENTS.communityPostUpdated, payload: { postId: POST, status: 'removed' }, scope: 'salon', branchIds: [] }]);
    }
    expect(projectToClient(ev(DOMAIN_EVENTS.COMMUNITY_COMMENT_ADDED, { aggregateId: COMMENT, payload: { postId: POST, commentId: COMMENT, depth: 1 } })))
      .toEqual([{ event: EVENTS.communityCommentAdded, payload: { postId: POST, commentId: COMMENT }, scope: 'salon', branchIds: [] }]);
    expect(projectToClient(ev(DOMAIN_EVENTS.COMMUNITY_SETTINGS_CHANGED, { payload: { version: 4, enabled: true } })))
      .toEqual([{ event: EVENTS.communitySettingsChanged, payload: { version: 4 }, scope: 'salon', branchIds: [] }]);
  });

  it('an event with no salon on the envelope goes nowhere (nothing crosses tenants)', async () => {
    const { sent, rt } = bus();
    await new RealtimeProjectionConsumer(rt).handle(ev(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED, { tenantId: null, payload: { postId: POST, branchIds: [B1] } }));
    expect(sent).toEqual([]);
  });
});
