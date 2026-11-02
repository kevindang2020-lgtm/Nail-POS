import { PushService, InMemoryPushRepository, MockPushProvider } from '@aipowersalon/communications';
import { describe, it, expect } from 'vitest';
import { NailShowcaseRankingService } from './nail-showcase-ranking.service';

// Proves the wiring: when a customer crosses into a headline tier (Top 10), the ranking service both writes the in-app
// notification AND dispatches a push to that customer's registered devices through PushService.

// Minimal social-port stub: only the methods recomputeCustomer touches, set up to force a Top-10 entry
// (prevRank null -> newRank 5). notifyUser is a no-op so we isolate the push path.
function stubRepo(notifySpy: (i: any) => void) {
  return {
    async getProfile() { return { is_public_profile: true, tenant_id: 't1', nail_showcase_rank_all_time: null }; },
    async eligiblePostsOf() { return []; },
    async setScoreSummary() {},
    async customerRankAndScore() { return { rank: 5, score: 100 }; },
    async setRankAllTime() {},
    async upsertSnapshot() {},
    async notifyUser(i: any) { notifySpy(i); },
  } as any;
}

describe('NailShowcase milestone → push', () => {
  it('dispatches a push to the customer\'s devices when they enter the Top 10', async () => {
    const pushRepo = new InMemoryPushRepository();
    const push = new PushService(pushRepo, new MockPushProvider());
    const userId = 'customer-user-1';
    await push.register({ tenantId: 't1', userId }, 'ios', 'device-token-abcdef123');

    let notified: any = null;
    const ranking = new NailShowcaseRankingService(stubRepo((i) => { notified = i; }), push);
    await ranking.recomputeCustomer('t1', userId);

    // in-app notification still fired
    expect(notified?.reference).toBe('leaderboard');
    expect(notified?.title).toMatch(/Top 10/);
    // AND a push was delivered + logged to that user's device
    expect(pushRepo.logs.length).toBe(1);
    expect(pushRepo.logs[0].channel).toBe('push');
    expect(pushRepo.logs[0].template).toBe('leaderboard');
    expect(pushRepo.logs[0].status).toBe('sent');
  });

  it('does not throw and sends nothing when the customer has no registered device', async () => {
    const pushRepo = new InMemoryPushRepository();
    const push = new PushService(pushRepo, new MockPushProvider());
    const ranking = new NailShowcaseRankingService(stubRepo(() => {}), push);
    await ranking.recomputeCustomer('t1', 'customer-with-no-device');
    expect(pushRepo.logs.length).toBe(0); // nothing to deliver, no error
  });

  it('works without a PushService injected (push is optional)', async () => {
    let notified: any = null;
    const ranking = new NailShowcaseRankingService(stubRepo((i) => { notified = i; })); // no push
    await ranking.recomputeCustomer('t1', 'customer-user-2');
    expect(notified?.reference).toBe('leaderboard'); // in-app still fires; no crash
  });
});

import { NailShowcaseSocialService } from './nail-showcase-social.service';

describe('NailShowcase social → push', () => {
  function socialStub() {
    return {
      async blockState() { return { iBlocked: false, blockedMe: false }; },
      async getProfile() { return { is_public_profile: true, allow_followers: true, tenant_id: 't1' }; },
      async ensureProfile() {},
      async insertFollow() { return true; },
      async recountFollows() { return { followerCount: 1, followingCount: 0 }; },
      async displayInfo() { return new Map([['follower-user', { displayName: 'Alex' }]]); },
      async notifyUser() {},
    } as any;
  }

  it('pushes "started following you" to the target\'s devices on a new follow', async () => {
    const pushRepo = new InMemoryPushRepository();
    const push = new PushService(pushRepo, new MockPushProvider());
    const targetId = 'target-user';
    await push.register({ tenantId: 't1', userId: targetId }, 'android', 'target-device-token-99');

    const svc = new NailShowcaseSocialService(socialStub(), {} as any, push);
    await svc.follow({ userId: 'follower-user', tenantId: 't1' } as any, targetId);

    expect(pushRepo.logs.length).toBe(1);
    expect(pushRepo.logs[0].channel).toBe('push');
    expect(pushRepo.logs[0].template).toBe('follow');
    expect(pushRepo.logs[0].status).toBe('sent');
  });

  it('does not push when the followed customer has no device (and does not throw)', async () => {
    const pushRepo = new InMemoryPushRepository();
    const push = new PushService(pushRepo, new MockPushProvider());
    const svc = new NailShowcaseSocialService(socialStub(), {} as any, push);
    await svc.follow({ userId: 'follower-user', tenantId: 't1' } as any, 'target-user');
    expect(pushRepo.logs.length).toBe(0);
  });
});
