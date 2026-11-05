import { describe, it, expect } from 'vitest';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { ApiWebhooksService, ForbiddenError } from './api-webhooks.service';
import { InMemoryApiWebhooksRepository } from './api-webhooks.repository';
import { InMemoryWebhookDeliveriesRepository } from './webhook-deliveries.repository';
import type { ApiWebhooksContext } from './api-webhooks.dto';
import type { WebhookSendResult } from './api-webhooks.service';

const owner: ApiWebhooksContext = { tenantId: 't_disp', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const noPerm: ApiWebhooksContext = { tenantId: 't_disp', branchId: '', userId: 'u2', role: 'FRONT_DESK', permissions: [] };
const other: ApiWebhooksContext = { ...owner, tenantId: 't_else' };

async function setup(sender: () => Promise<WebhookSendResult>, now = () => 1_000_000) {
  const wrepo = new InMemoryApiWebhooksRepository();
  const drepo = new InMemoryWebhookDeliveriesRepository();
  const api = new ApiWebhooksService(wrepo);
  const w = await api.createWebhook(owner, { name: 'CRM', url: 'https://hooks.example.com/x', events: ['deployment.completed'] });
  const dispatch = new WebhookDispatchService(wrepo, drepo, now, sender);
  return { dispatch, w };
}

describe('WebhookDispatchService', () => {
  it('plans + enqueues a pending delivery only for subscribed active webhooks', async () => {
    const { dispatch, w } = await setup(async () => ({ ok: true, status: 200 }));
    await dispatch.dispatch(owner, 'deployment.completed', { id: 'd1' });
    await dispatch.dispatch(owner, 'unrelated.event', { id: 'd2' }); // no subscriber → no rows
    const { deliveries } = await dispatch.listDeliveries(owner, w.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('pending');
    expect(deliveries[0].eventType).toBe('deployment.completed');
  });

  it('processDue delivers on success and records the terminal state', async () => {
    const { dispatch, w } = await setup(async () => ({ ok: true, status: 200 }));
    await dispatch.dispatch(owner, 'deployment.completed', { id: 'd1' });
    const r = await dispatch.processDue(owner, 1_000_000);
    expect(r).toMatchObject({ processed: 1, delivered: 1, retried: 0, dead: 0 });
    const { deliveries } = await dispatch.listDeliveries(owner, w.id);
    expect(deliveries[0].status).toBe('delivered');
    expect(deliveries[0].lastStatusCode).toBe(200);
  });

  it('retries on 5xx with a scheduled next attempt, then goes dead after the attempt cap', async () => {
    const { dispatch, w } = await setup(async () => ({ ok: false, status: 500 }));
    await dispatch.dispatch(owner, 'deployment.completed', { id: 'd1' });
    let now = 1_000_000;
    const r1 = await dispatch.processDue(owner, now);
    expect(r1.retried).toBe(1);
    let cur = (await dispatch.listDeliveries(owner, w.id)).deliveries[0];
    expect(cur.status).toBe('pending');
    expect(cur.attemptCount).toBe(1);
    expect(cur.nextAttemptIso).not.toBeNull();
    // drive subsequent attempts far enough in the future to be due each time
    let guard = 0;
    while (cur.status === 'pending' && guard++ < 10) {
      now += 120_000; // 2 min jumps clear any backoff (cap 60s)
      await dispatch.processDue(owner, now);
      cur = (await dispatch.listDeliveries(owner, w.id)).deliveries[0];
    }
    expect(cur.status).toBe('dead');
    expect(cur.attemptCount).toBe(5);
  });

  it('enforces read permission and tenant isolation on listDeliveries', async () => {
    const { dispatch, w } = await setup(async () => ({ ok: true, status: 200 }));
    await dispatch.dispatch(owner, 'deployment.completed', { id: 'd1' });
    await expect(dispatch.listDeliveries(noPerm, w.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await dispatch.listDeliveries(other, w.id)).deliveries).toHaveLength(0);
  });
});
