// ai-webhook-dedupe.pgtest — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider") on the real
// migrated schema, for the three provider callbacks the AI module owns:
//   • AI subscription billing (POST /internal/ai-billing/webhook, HMAC over the raw body): one ai_billing_events row per
//     provider event; the subscription moves once; the repeats answer duplicate_event; a forged signature moves nothing.
//   • call transcription (POST /voice-transcription/webhook, integration key): a re-delivered completed call is one
//     transcript with the same segments AND one usage row — the minutes are metered once (they were metered per delivery).
//   • voice call outcome (POST /voice/calls/:callId/outcome): one voice_call_outcomes row per call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiSubscriptionBillingService } from './ai-subscription-billing.service';
import { KyselyAiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import { KyselyAiUsageLogger } from './ai-access.kysely.repository';
import { KyselyVoiceTranscriptionRepository } from '../ai-voice-transcription/ai-voice-transcription.kysely.repository';
import { VoiceTranscriptionService } from '../ai-voice-transcription/ai-voice-transcription.service';
import { InMemoryVoiceEntitlement } from '../ai-voice-transcription/ai-voice-transcription-entitlement';
import { MockTranscriptionProvider } from '../ai-voice-transcription/ai-voice-transcription.provider';
import { KyselyCallOutcomeRepo } from '../voice-booking/voice-call-outcome.kysely.repository';
import { VoiceCallOutcomeService } from '../voice-booking/voice-call-outcome.service';

const T = 'e4400000-0000-4000-8000-00000000000a', BR = 'e4410000-0000-4000-8000-00000000000a';
const SECRET = 'p14-ai-billing-fixture';   // test fixture, not a credential
let pg: any; let db: any;
const count = async (q: string, p: unknown[] = []) => Number((await pg.query(q, p)).rows[0].c);
const prev = { secret: process.env.AI_BILLING_WEBHOOK_SECRET, scheme: process.env.AI_BILLING_WEBHOOK_SCHEME };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'AI', 'AI', 'ai-p14', 'AIP14', 'active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${BR}', '${T}', 'Main');
    INSERT INTO tenant_ai_subscriptions (tenant_id, package_code, status) VALUES ('${T}', 'ai_booking_assistant', 'past_due');`);
  process.env.AI_BILLING_WEBHOOK_SECRET = SECRET; delete process.env.AI_BILLING_WEBHOOK_SCHEME;
}, 120_000);
afterAll(() => {
  if (prev.secret === undefined) delete process.env.AI_BILLING_WEBHOOK_SECRET; else process.env.AI_BILLING_WEBHOOK_SECRET = prev.secret;
  if (prev.scheme !== undefined) process.env.AI_BILLING_WEBHOOK_SCHEME = prev.scheme;
});

describe('AI subscription billing webhook: one provider event is applied once', () => {
  const header = (raw: string, secret = SECRET) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; };
  const svc = () => new AiSubscriptionBillingService(new KyselyAiSubscriptionBillingRepo(db), db);
  it('in sequence and concurrently → one ai_billing_events row, the subscription moved once, repeats are duplicate_event', async () => {
    const raw = JSON.stringify({ id: 'evt_p14_ai_1', type: 'invoice.payment_succeeded', data: { object: { metadata: { tenant_id: T, package_code: 'ai_booking_assistant' } } } });
    expect(await svc().ingestRawWebhook(raw, header(raw))).toMatchObject({ applied: true, fromStatus: 'past_due', toStatus: 'active' });
    const again = await Promise.all([svc().ingestRawWebhook(raw, header(raw)), svc().ingestRawWebhook(raw, header(raw)), svc().ingestRawWebhook(raw, header(raw))]);
    expect(again.every((r) => r.duplicate === true && r.reason === 'duplicate_event')).toBe(true);
    expect(await count(`SELECT count(*)::int c FROM ai_billing_events WHERE event_id = 'evt_p14_ai_1'`)).toBe(1);
    expect(await count(`SELECT count(*)::int c FROM audit_logs WHERE action_type = 'ai_subscription_billing_event' AND tenant_id = $1`, [T])).toBe(1);
  });
  it('a forged signature is refused and records nothing', async () => {
    const raw = JSON.stringify({ id: 'evt_p14_ai_forged', type: 'invoice.payment_failed', data: { object: { metadata: { tenant_id: T, package_code: 'ai_booking_assistant' } } } });
    const r = await svc().ingestRawWebhook(raw, header(raw, 'not-the-secret'));
    expect(r.applied).toBe(false); expect(r.reason).toMatch(/^signature_/);
    expect(await count(`SELECT count(*)::int c FROM ai_billing_events WHERE event_id = 'evt_p14_ai_forged'`)).toBe(0);
    expect((await pg.query(`SELECT status FROM tenant_ai_subscriptions WHERE tenant_id = $1`, [T])).rows[0].status).toBe('active');
  });
});

describe('call transcription webhook: a re-delivered call is one transcript, metered once', () => {
  const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];
  const ctx = { tenantId: T, branchId: BR, userId: 'system', role: 'SYSTEM', permissions: ALL } as any;
  it('the same completed call delivered twice in sequence and twice concurrently → one transcript, 4 segments, ONE usage row', async () => {
    const svc = new VoiceTranscriptionService(new KyselyVoiceTranscriptionRepository(db), new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true),
      undefined, undefined, undefined, undefined, new KyselyAiUsageLogger(db));
    await svc.recordConsent(ctx, { branchId: BR, provider: 'retell', providerCallId: 'call_p14_1', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: 'US-NJ', initiatedBy: 'provider', consentAt: null });
    const first = await svc.ingest(ctx, { provider: 'retell', providerCallId: 'call_p14_1' });
    expect(first.status).toBe('completed');
    await svc.ingest(ctx, { provider: 'retell', providerCallId: 'call_p14_1' });
    await Promise.all([svc.ingest(ctx, { provider: 'retell', providerCallId: 'call_p14_1' }), svc.ingest(ctx, { provider: 'retell', providerCallId: 'call_p14_1' })]);
    expect(await count(`SELECT count(*)::int c FROM call_transcripts WHERE tenant_id = $1 AND provider_call_id = 'call_p14_1'`, [T])).toBe(1);
    expect(await count(`SELECT count(*)::int c FROM call_transcript_segments WHERE transcript_id = $1`, [first.id])).toBe(4);
    expect(await count(`SELECT count(*)::int c FROM ai_usage_logs WHERE tenant_id = $1 AND package_code = 'ai_voice_transcription'`, [T])).toBe(1);
  });
});

describe('voice call outcome webhook: one row per call', () => {
  it('the same outcome posted twice in sequence and concurrently → one voice_call_outcomes row', async () => {
    const svc = new VoiceCallOutcomeService(new KyselyCallOutcomeRepo(db));
    const vctx = { tenantId: T, branchId: BR } as any;
    const body = { providerCallId: 'call_p14_out', bookingOutcome: 'booked', durationSeconds: 42 } as any;
    await svc.record(vctx, 'retell', body);
    await svc.record(vctx, 'retell', body);
    await Promise.all([svc.record(vctx, 'retell', body), svc.record(vctx, 'retell', body)]);
    expect(await count(`SELECT count(*)::int c FROM voice_call_outcomes WHERE tenant_id = $1 AND provider_call_id = 'call_p14_out'`, [T])).toBe(1);
  });
});
