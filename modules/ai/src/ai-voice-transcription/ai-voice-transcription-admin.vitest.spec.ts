// ai-voice-transcription-admin.vitest.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { VoiceTranscriptionService, type UsageLoggerPort } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import type { VoiceTranscriptionContext } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];

function provider(duration: number) {
  return { name: 'retell', async fetchTranscript() { return { segments: [{ channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text: 'book a manicure', language: 'en', confidence: 0.95, isFinal: true }], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: duration, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
}

describe('usage logging (reuses ai_usage_logs via AiUsageLogger)', () => {
  it('logs transcribed minutes under ai_voice_transcription on a completed call', async () => {
    const log = vi.fn(async () => {});
    const usage: UsageLoggerPort = { log };
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider(150), new InMemoryVoiceEntitlement(() => true), 365, false, undefined, undefined, usage);
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c1', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' });
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0][0];
    expect(entry.packageCode).toBe('ai_voice_transcription');
    expect(entry.usageUnit).toBe('minutes');
    expect(entry.usageAmount).toBe(3); // ceil(150/60)
    expect(entry.status).toBe('success');
  });

  it('a SYSTEM-context ingest (the provider webhook) logs usage with NO user id — ai_usage_logs.user_id is a UUID', async () => {
    // The webhook ingests under systemContext() ('system:voice-transcription-ingest', role SYSTEM). The logger used to test
    // for the literal 'system'; after Constitution 13 renamed the system user, that test no longer matched.
    const { systemContext } = await import('@aipowersalon/tenant-context');
    const log = vi.fn(async () => {});
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider(150), new InMemoryVoiceEntitlement(() => true), 365, false, undefined, undefined, { log });
    const sys = { ...systemContext({ tenantId: ctx(ALL).tenantId, branchId: 'b1', actor: 'voice-transcription-ingest', permissions: ALL }) } as any;
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c9', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true } as any);
    await svc.ingest(sys, { provider: 'retell', providerCallId: 'c9' });
    expect(log).toHaveBeenCalledTimes(1);
    expect((log.mock.calls[0] as any[])[0].userId).toBeNull();
  });

  it('does NOT log usage when transcription was blocked (no consent)', async () => {
    const log = vi.fn(async () => {});
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider(150), new InMemoryVoiceEntitlement(() => true), 365, false, undefined, undefined, { log });
    await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' }); // no consent → blocked
    expect(log).not.toHaveBeenCalled();
  });
});

describe('super-admin platform aggregate', () => {
  it('returns cross-tenant counts with no transcript content', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, provider(60), new InMemoryVoiceEntitlement(() => true));
    for (const [tenant, call] of [['A', 'a1'], ['A', 'a2'], ['B', 'b1']] as const) {
      await svc.recordConsent(ctx(ALL, tenant), { branchId: 'b1', provider: 'retell', providerCallId: call, consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
      await svc.ingest(ctx(ALL, tenant), { provider: 'retell', providerCallId: call });
    }
    const agg = await svc.getPlatformOverview();
    expect(agg.tenantsActive).toBe(2);
    expect(agg.totalTranscripts).toBe(3);
    expect(agg.byStatus.find((s) => s.status === 'completed')?.count).toBe(3);
    // no transcript text/segments leak into the aggregate
    expect(JSON.stringify(agg)).not.toMatch(/manicure/);
  });
});
