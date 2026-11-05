// ai-voice-transcription-settings.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { VoiceTranscriptionForbiddenError, VoiceTranscriptionValidationError } from './ai-voice-transcription.dto';
import type { VoiceTranscriptionContext } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings', 'ai_voice_transcription.view_raw'];
const provider = { name: 'retell', async fetchTranscript() { return { segments: [{ channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text: 'my card is 4111111111111111', language: 'en', confidence: 0.95, isFinal: true }], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 30, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
const consent = { branchId: 'b1', provider: 'retell', providerCallId: 'c1', consentStatus: 'granted' as const, consentMethod: 'announcement' as const, recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system' as const, consentAt: null };

describe('settings', () => {
  it('returns effective defaults when nothing is saved', async () => {
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true), 365, false);
    const s = await svc.getSettings(ctx(ALL));
    expect(s).toEqual({ transcriptionEnabled: true, retentionDays: 365, retainRaw: false, consentAnnouncementVersion: null });
  });

  it('requires manage_settings to update', async () => {
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true));
    await expect(svc.updateSettings(ctx(['ai_voice_transcription.view']), { retentionDays: 30 })).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
  });

  it('validates the retention window', async () => {
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true));
    await expect(svc.updateSettings(ctx(ALL), { retentionDays: 0 })).rejects.toBeInstanceOf(VoiceTranscriptionValidationError);
    await expect(svc.updateSettings(ctx(ALL), { retentionDays: 99999 })).rejects.toBeInstanceOf(VoiceTranscriptionValidationError);
  });

  it('a saved transcription_enabled=false blocks ingest', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    await svc.recordConsent(ctx(ALL), consent);
    await svc.updateSettings(ctx(ALL), { transcriptionEnabled: false });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' });
    expect(h.status).toBe('transcription_disabled');
    expect((await svc.getTranscript(ctx(ALL), h.id)).segments).toHaveLength(0);
  });

  it('retainRaw=true from settings makes raw available (overriding the constructor default)', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true), 365, false /* default off */);
    await svc.recordConsent(ctx(ALL), consent);
    await svc.updateSettings(ctx(ALL), { retainRaw: true });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' });
    expect(h.rawAvailable).toBe(true);
    const raw = await svc.getRawTranscript(ctx(ALL), h.id);
    expect(raw[0].rawText).toContain('4111');
  });

  it('settings are tenant-isolated', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    await svc.updateSettings(ctx(ALL, 'A'), { retentionDays: 30 });
    expect((await svc.getSettings(ctx(ALL, 'B'))).retentionDays).not.toBe(30);
  });
});
