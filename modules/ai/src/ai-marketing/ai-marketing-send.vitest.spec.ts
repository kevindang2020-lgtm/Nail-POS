// ai-marketing-send.vitest.spec.ts — the send-safety guarantees, proven against in-memory fakes.
import { describe, it, expect, vi } from 'vitest';
import { idempotencyKey, decideSend, type RecipientState } from './ai-marketing-send-core';
import {
  AiMarketingSendService,
  SendExecutionError,
  type CampaignLifecyclePort,
  type RecipientSourcePort,
  type SendLedgerPort,
  type LimitEvaluatorPort,
  type SuppressionPort,
  type QuietHoursPort,
  type DispatcherPort,
  type RecipientRow,
} from './ai-marketing-send.service';
import type { AiMarketingContext } from './ai-marketing.dto';

function ctx(over: Partial<AiMarketingContext> = {}): AiMarketingContext {
  return { tenantId: 'tenantA', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['marketing.manage'], ...over };
}
const consented = (id: string, addr: string): RecipientRow => ({ customerId: id, channel: 'sms', address: addr, hasConsent: true });

// --- pure core ---
describe('idempotencyKey', () => {
  it('is stable and distinct per field', () => {
    const base = { tenantId: 't', campaignId: 'c', customerId: 'u', channel: 'sms' as const, messageVersion: 1 };
    expect(idempotencyKey(base)).toBe(idempotencyKey(base));
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, messageVersion: 2 }));
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, customerId: 'u2' }));
  });
});

describe('decideSend', () => {
  const ok: RecipientState = { hasConsent: true, hasUsableContact: true, isSuppressed: false };
  it('sends when everything is clear', () => {
    expect(decideSend(ok, false, { action: 'allow' }).action).toBe('send');
  });
  it('skips already-sent (idempotency)', () => {
    expect(decideSend(ok, true, { action: 'allow' })).toEqual({ action: 'skip', reason: 'already_sent' });
  });
  it('skips a recipient who opted out AFTER approval', () => {
    expect(decideSend({ ...ok, isSuppressed: true }, false, { action: 'allow' })).toEqual({ action: 'skip', reason: 'opted_out' });
  });
  it('skips without consent, missing contact, quiet hours, and frequency cap', () => {
    expect(decideSend({ ...ok, hasConsent: false }, false, { action: 'allow' }).reason).toBe('no_consent');
    expect(decideSend({ ...ok, hasUsableContact: false }, false, { action: 'allow' }).reason).toBe('missing_contact');
    expect(decideSend(ok, false, { action: 'allow' }, true).reason).toBe('quiet_hours');
    expect(decideSend(ok, false, { action: 'block' }).reason).toBe('frequency_capped');
  });
});

// --- orchestrator with in-memory fakes ---
function makeLedger(pre: Record<string, string> = {}): SendLedgerPort & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(pre));
  return {
    store,
    async claim(key) {
      if (store.has(key)) return { created: false, status: store.get(key)! };
      store.set(key, 'queued');
      return { created: true, status: 'queued' };
    },
    async markSent(key) { store.set(key, 'sent'); },
    async markSkipped(key) { store.set(key, 'skipped'); },
    async markFailed(key) { store.set(key, 'failed'); },
  };
}
function makeCampaign(status: string) {
  const transitions: string[] = [];
  const port: CampaignLifecyclePort = {
    detail: vi.fn(async (_c, id) => ({ id, status, audienceSize: 3 } as any)),
    transition: vi.fn(async (_c, id, to) => { transitions.push(to); return { id, status: to } as any; }),
  };
  return { port, transitions };
}
function build(opts: {
  status?: string; recipients: RecipientRow[]; ledgerPre?: Record<string, string>;
  suppressed?: Set<string>; limit?: 'allow' | 'block'; quiet?: boolean; dispatch?: (to: string) => { sent: boolean; reason?: string };
}) {
  const camp = makeCampaign(opts.status ?? 'scheduled');
  const recipients: RecipientSourcePort = { enumerate: async () => opts.recipients };
  const ledger = makeLedger(opts.ledgerPre);
  const limits: LimitEvaluatorPort = { evaluate: async () => ({ action: opts.limit ?? 'allow' }) };
  const suppression: SuppressionPort = { isOptedOut: async (_t, _c, addr) => !!opts.suppressed?.has(addr) };
  const quietHours: QuietHoursPort = { isActive: async () => !!opts.quiet };
  const dispatched: string[] = [];
  const dispatcher: DispatcherPort = {
    send: vi.fn(async (_c, m) => { dispatched.push(m.to); const r = opts.dispatch ? opts.dispatch(m.to) : { sent: true }; return { sent: r.sent, status: r.sent ? 'sent' : 'blocked', reason: r.reason, providerId: r.sent ? 'p1' : null }; }),
  };
  const svc = new AiMarketingSendService(camp.port, recipients, ledger, limits, suppression, quietHours, dispatcher);
  return { svc, camp, ledger, dispatcher, dispatched };
}

describe('AiMarketingSendService.executeCampaign', () => {
  it('sends to all clear recipients and completes the campaign', async () => {
    const { svc, camp, dispatched } = build({ recipients: [consented('a', '+1a'), consented('b', '+1b'), consented('c', '+1c')] });
    const s = await svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: 'Hi {{booking_link}}' });
    expect(s.sent).toBe(3);
    expect(dispatched).toHaveLength(3);
    expect(camp.transitions).toEqual(['in_progress', 'completed']);
  });

  it('never sends to a recipient who opted out after approval', async () => {
    const { svc, dispatched } = build({ recipients: [consented('a', '+1a'), consented('b', '+1b')], suppressed: new Set(['+1b']) });
    const s = await svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: 'Hi' });
    expect(s.sent).toBe(1);
    expect(dispatched).toEqual(['+1a']);
    expect(s.byReason.opted_out).toBe(1);
  });

  it('is idempotent on resume — already-sent recipients are not sent again', async () => {
    // recipient "a" was already sent in a prior run (ledger row terminal). Campaign is mid-flight (in_progress).
    const keyA = idempotencyKey({ tenantId: 'tenantA', campaignId: 'camp1', customerId: 'a', channel: 'sms', messageVersion: 1 });
    const { svc, dispatched } = build({
      status: 'in_progress', recipients: [consented('a', '+1a'), consented('b', '+1b')], ledgerPre: { [keyA]: 'sent' },
    });
    const s = await svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: 'Hi' });
    expect(dispatched).toEqual(['+1b']); // "a" is skipped, only "b" dispatched
    expect(s.byReason.already_sent).toBe(1);
    expect(s.sent).toBe(1);
  });

  it('skips everyone when the tenant frequency cap is blocked', async () => {
    const { svc, dispatched } = build({ recipients: [consented('a', '+1a')], limit: 'block' });
    const s = await svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: 'Hi' });
    expect(dispatched).toHaveLength(0);
    expect(s.byReason.frequency_capped).toBe(1);
  });

  it('refuses to send a campaign that is not scheduled/in_progress', async () => {
    const { svc } = build({ status: 'completed', recipients: [consented('a', '+1a')] });
    await expect(svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: 'Hi' })).rejects.toBeInstanceOf(SendExecutionError);
  });

  it('requires a message body', async () => {
    const { svc } = build({ recipients: [consented('a', '+1a')] });
    await expect(svc.executeCampaign(ctx(), { campaignId: 'camp1', messageVersion: 1, body: '  ' })).rejects.toBeInstanceOf(SendExecutionError);
  });
});
