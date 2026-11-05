// ai-voice-transcription-search.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { parseTerms, matchesAllTerms, snippet } from './ai-voice-transcription-search';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { VoiceTranscriptionForbiddenError } from './ai-voice-transcription.dto';
import type { VoiceTranscriptionContext } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];

describe('search helpers', () => {
  it('parseTerms keeps quoted phrases and drops noise', () => {
    expect(parseTerms('gel "nail art" a')).toEqual(['gel', 'nail art']);
  });
  it('matchesAllTerms is AND', () => {
    expect(matchesAllTerms('book a gel manicure', ['gel', 'manicure'])).toBe(true);
    expect(matchesAllTerms('book a gel manicure', ['gel', 'pedicure'])).toBe(false);
  });
  it('snippet windows around the first match', () => {
    const s = snippet('the customer wants a gel manicure on saturday afternoon please', ['manicure'], 10);
    expect(s).toContain('manicure');
    expect(s).toContain('…');
  });
});

function makeSvc(text: string) {
  const repo = new InMemoryVoiceTranscriptionRepository();
  const provider = { name: 'x', async fetchTranscript() { return { segments: [
    { channel: 0, speakerLabel: 'agent', startMs: 0, endMs: 1, text: 'Thanks for calling', language: 'en', confidence: 0.96, isFinal: true },
    { channel: 1, speakerLabel: 'caller', startMs: 2, endMs: 3, text, language: 'en', confidence: 0.95, isFinal: true },
  ], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
  return new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
}
async function ingest(svc: VoiceTranscriptionService, callId: string, tenant = 'A') {
  await svc.recordConsent(ctx(ALL, tenant), { branchId: 'b1', provider: 'retell', providerCallId: callId, consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
  return svc.ingest(ctx(ALL, tenant), { provider: 'retell', providerCallId: callId });
}

describe('service.search', () => {
  it('requires view_transcripts permission', async () => {
    const svc = makeSvc('book a gel manicure');
    await expect(svc.search(ctx(['ai_voice_transcription.view']), { q: 'gel' })).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
  });

  it('finds a transcript by a redacted-text keyword', async () => {
    const svc = makeSvc('I want a gel manicure on Saturday');
    await ingest(svc, 'c1');
    const res = await svc.search(ctx(ALL), { q: 'manicure' });
    expect(res.items.length).toBe(1);
    expect(res.items[0].matchedIn).toContain('transcript');
    expect(res.items[0].snippet.toLowerCase()).toContain('manicure');
  });

  it('filters by intent', async () => {
    const svc = makeSvc('I need to cancel my appointment');
    await ingest(svc, 'c1');
    expect((await svc.search(ctx(ALL), { intent: 'cancellation' })).items.length).toBe(1);
    expect((await svc.search(ctx(ALL), { intent: 'new_booking' })).items.length).toBe(0);
  });

  it('SAFETY: a redacted card number is NOT findable by its digits (raw is never indexed)', async () => {
    const svc = makeSvc('my card is 4111 1111 1111 1111 for the deposit');
    await ingest(svc, 'c1');
    // the digits were redacted → searching them returns nothing
    expect((await svc.search(ctx(ALL), { q: '4111' })).items.length).toBe(0);
    // but the surrounding words are still searchable
    expect((await svc.search(ctx(ALL), { q: 'deposit' })).items.length).toBe(1);
  });

  it('is tenant-isolated', async () => {
    const svc = makeSvc('gel manicure request');
    await ingest(svc, 'c1', 'A');
    expect((await svc.search(ctx(ALL, 'B'), { q: 'manicure' })).items.length).toBe(0);
  });

  it('excludes deleted transcripts', async () => {
    const svc = makeSvc('gel manicure request');
    const h = await ingest(svc, 'c1');
    await svc.deleteTranscript(ctx([...ALL, 'ai_voice_transcription.delete']), h.id, 'tenant_request');
    expect((await svc.search(ctx(ALL), { q: 'manicure' })).items.length).toBe(0);
  });
});
