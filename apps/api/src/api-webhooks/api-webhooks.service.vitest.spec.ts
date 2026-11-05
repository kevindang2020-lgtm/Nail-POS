import { describe, it, expect } from 'vitest';
import { ApiWebhooksService, ForbiddenError, ValidationError, NotFoundError, type WebhookSender } from './api-webhooks.service';
import { InMemoryApiWebhooksRepository } from './api-webhooks.repository';
import type { ApiWebhooksContext } from './api-webhooks.dto';

const owner: ApiWebhooksContext = { tenantId: 't_test', branchId: '', userId: 'u_owner', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const manager: ApiWebhooksContext = { tenantId: 't_test', branchId: '', userId: 'u_mgr', role: 'MANAGER', permissions: ['settings.view', 'settings.edit'] };
const frontDesk: ApiWebhooksContext = { tenantId: 't_test', branchId: '', userId: 'u_fd', role: 'FRONT_DESK', permissions: [] };
const otherTenant: ApiWebhooksContext = { ...owner, tenantId: 't_other' };

const svc = (sender?: WebhookSender) => new ApiWebhooksService(new InMemoryApiWebhooksRepository(), undefined, sender);

describe('ApiWebhooksService — API keys', () => {
  it('creates a key, returns the raw secret exactly once, and lists it masked', async () => {
    const s = svc();
    const created = await s.createKey(owner, { name: 'CI key', environment: 'live', scopes: ['pos.services.view', 'services.read', 'pos.checkout.refund', 'BAD SCOPE'] });
    expect(created.secret).toMatch(/^ak_live_/);
    // Oct 3 2026 (Constitution 3 Step 7): only real, allow-listed, read-only permission keys survive — an invented name
    // ('services.read'), a write permission ('pos.checkout.refund') and a malformed one are dropped
    expect(created.scopes).toEqual(['pos.services.view']);
    const list = await s.listKeys(owner);
    expect(list).toHaveLength(1);
    expect((list[0] as any).secret).toBeUndefined(); // secret never in list
    expect((list[0] as any).secretHash).toBeUndefined(); // hash never exposed
    expect(list[0].masked.endsWith('••••••••')).toBe(true);
    expect(list[0].status).toBe('active');
  });

  it('only the OWNER can mint or rotate secrets', async () => {
    const s = svc();
    await expect(s.createKey(manager, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError); // manager has edit but not owner
    await expect(s.listKeys(frontDesk)).rejects.toBeInstanceOf(ForbiddenError); // no settings.view
  });

  it('rotates and revokes a key', async () => {
    const s = svc();
    const a = await s.createKey(owner, { name: 'k' });
    const rotated = await s.rotateKey(owner, a.id);
    expect(rotated.secret).toMatch(/^ak_/);
    expect(rotated.secret).not.toEqual(a.secret);
    const rev = await s.revokeKey(owner, a.id);
    expect(rev.revoked).toBe(true);
    expect(await s.listKeys(owner)).toHaveLength(0); // revoked keys drop out of the active list
    await expect(s.rotateKey(owner, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an empty name and isolates tenants', async () => {
    const s = svc();
    await expect(s.createKey(owner, { name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await s.createKey(owner, { name: 'visible to t_test only' });
    expect(await s.listKeys(otherTenant)).toHaveLength(0);
    const audit = s.auditLog();
    expect(audit.some((a) => a.actionType === 'api_key_created')).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/ak_live_[A-Za-z0-9]{8}/); // no raw secret in audit
  });
});

describe('ApiWebhooksService — webhooks', () => {
  it('creates a webhook with a one-time signing secret over a safe https URL', async () => {
    const s = svc();
    const w = await s.createWebhook(owner, { name: 'CRM', url: 'https://hooks.example.com/x', events: ['appointment.created'] });
    expect(w.signingSecret).toMatch(/^whsec_/);
    const list = await s.listWebhooks(owner);
    expect((list[0] as any).signingSecret).toBeUndefined();
    expect(list[0].hasSecret).toBe(true);
  });

  it('blocks SSRF-prone URLs (http, localhost, private, metadata)', async () => {
    const s = svc();
    for (const url of ['http://hooks.example.com/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://169.254.169.254/x']) {
      await expect(s.createWebhook(owner, { name: 'bad', url })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('pauses/disables (manage) and rotates secret (owner only); signs and delivers a real test event', async () => {
    const sent: any[] = [];
    const fakeSender: WebhookSender = async (req) => { sent.push(req); return { ok: true, status: 200 }; };
    const s = svc(fakeSender);
    const w = await s.createWebhook(owner, { name: 'h', url: 'https://hooks.example.com/y' });
    expect((await s.pauseWebhook(owner, w.id)).status).toBe('paused');
    expect((await s.disableWebhook(owner, w.id)).status).toBe('disabled');
    const rot = await s.rotateWebhookSecret(owner, w.id);
    expect(rot.signingSecret).toMatch(/^whsec_/);
    const test = await s.testWebhook(owner, w.id);
    expect(test.delivered).toBe(true);                                 // real signed delivery via injected sender
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['Webhook-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/); // HMAC-SHA256 signature header
    expect(JSON.parse(sent[0].body).type).toBe('webhook.test');
    await expect(s.createWebhook(manager, { name: 'm', url: 'https://hooks.example.com/z' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reports an honest failure and increments the failure count when delivery fails', async () => {
    const failSender: WebhookSender = async () => ({ ok: false, status: 500, error: undefined });
    const s = svc(failSender);
    const w = await s.createWebhook(owner, { name: 'h', url: 'https://hooks.example.com/fail' });
    const test = await s.testWebhook(owner, w.id);
    expect(test.delivered).toBe(false);
    expect(test.detail).toMatch(/HTTP 500/);
    const after = (await s.listWebhooks(owner)).find((x) => x.id === w.id)!;
    expect(after.failureCount).toBe(1);
  });

  it('writes an integration log entry through the injected log sink on test delivery', async () => {
    const writes: any[] = [];
    const fakeSender: WebhookSender = async () => ({ ok: true, status: 200 });
    const sink = { write: async (ctx: any, entry: any) => { writes.push({ ctx, entry }); } };
    const s = new ApiWebhooksService(new InMemoryApiWebhooksRepository(), undefined, fakeSender, sink);
    const w = await s.createWebhook(owner, { name: 'h', url: 'https://hooks.example.com/log' });
    await s.testWebhook(owner, w.id);
    const delivery = writes.map((x) => x.entry).find((e: any) => e.status === 'delivered' || e.status === 'failed');
    expect(delivery).toBeTruthy();
    expect(delivery.category).toBe('integration');
    expect(delivery.source).toBe('webhook');
    expect(delivery.status).toBe('delivered');
  });

  it('emits integration logs on key and webhook lifecycle events', async () => {
    const writes: any[] = [];
    const sink = { write: async (_c: any, e: any) => { writes.push(e); } };
    const s = new ApiWebhooksService(new InMemoryApiWebhooksRepository(), undefined, undefined, sink);
    const k = await s.createKey(owner, { name: 'CI' });
    await s.rotateKey(owner, k.id);
    await s.revokeKey(owner, k.id);
    const w = await s.createWebhook(owner, { name: 'H', url: 'https://hooks.example.com/a' });
    await s.disableWebhook(owner, w.id);
    expect(writes.every((x) => x.category === 'integration')).toBe(true);
    expect(writes.filter((x) => x.source === 'api_key').length).toBeGreaterThanOrEqual(3);
    expect(writes.filter((x) => x.source === 'webhook').length).toBeGreaterThanOrEqual(2);
  });
});
