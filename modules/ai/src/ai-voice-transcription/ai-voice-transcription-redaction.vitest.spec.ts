// ai-voice-transcription-redaction.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { redactText, redactSegments } from './ai-voice-transcription-redaction';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { MockTranscriptionProvider } from './ai-voice-transcription.provider';
import { VoiceTranscriptionForbiddenError } from './ai-voice-transcription.dto';
import type { VoiceTranscriptionContext, TranscriptSegment } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];

describe('redactText — strips sensitive data', () => {
  it('redacts a card number', () => {
    const r = redactText('my card is 4111 1111 1111 1111 okay');
    expect(r.text).not.toContain('4111');
    expect(r.text).toContain('[REDACTED_CARD]');
    expect(r.categories).toContain('card');
  });
  it('redacts a 16-digit unspaced card', () => {
    expect(redactText('4111111111111111').text).toContain('[REDACTED_CARD]');
  });
  it('redacts CVV / security code by keyword', () => {
    const r = redactText('the cvv is 123');
    expect(r.text).toContain('[REDACTED_CVV]');
    expect(r.text).not.toMatch(/\b123\b/);
  });
  it('redacts an SSN', () => {
    expect(redactText('ssn 123-45-6789').text).toContain('[REDACTED_SSN]');
  });
  it('redacts a spoken password / OTP', () => {
    expect(redactText('my password is hunter2please').text).toContain('[REDACTED_SECRET]');
    expect(redactText('the verification code is 998877').text).toContain('[REDACTED_SECRET]');
  });
  it('redacts a bank account / routing number', () => {
    expect(redactText('routing number 021000021').text).toContain('[REDACTED_BANK]');
  });
});

describe('redactText — preserves data the salon needs', () => {
  it('does NOT redact a 10-digit phone number', () => {
    const r = redactText('call me at 8565551234');
    expect(r.text).toContain('8565551234');
    expect(r.applied).toBe(false);
  });
  it('does NOT redact a clock time or price', () => {
    const r = redactText('book me for 2:30 and it is 45 dollars');
    expect(r.text).toContain('2:30');
    expect(r.text).toContain('45');
    expect(r.applied).toBe(false);
  });
});

describe('redactSegments', () => {
  it('replaces segment text and aggregates categories, keeping raw aside only where redacted', () => {
    const segs: TranscriptSegment[] = [
      { seq: 0, speakerLabel: null, speakerRole: 'customer', startMs: 0, endMs: 1, text: 'my card is 4111111111111111', language: 'en', confidence: 0.9, isFinal: true, providerSegmentRef: null },
      { seq: 1, speakerLabel: null, speakerRole: 'ai_receptionist', startMs: 2, endMs: 3, text: 'see you at 2:30', language: 'en', confidence: 0.9, isFinal: true, providerSegmentRef: null },
    ];
    const r = redactSegments(segs);
    expect(r.segments[0].text).toContain('[REDACTED_CARD]');
    expect(r.rawTexts[0]).toContain('4111');   // raw kept aside for the redacted one
    expect(r.rawTexts[1]).toBeNull();          // nothing redacted → no raw kept
    expect(r.categories).toContain('card');
    expect(r.anyApplied).toBe(true);
  });
});

describe('service — redacted by default, raw gated', () => {
  async function ingestWith(retainRaw: boolean, text = 'my card is 4111111111111111') {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const provider = { name: 'x', async fetchTranscript() { return { segments: [{ channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text, language: 'en', confidence: 0.95, isFinal: true }], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true), 365, retainRaw);
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c1', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' });
    return { svc, h };
  }

  it('stored segments are redacted; raw is unavailable when retention is off', async () => {
    const { svc, h } = await ingestWith(false);
    const { segments } = await svc.getTranscript(ctx(ALL), h.id);
    expect(segments[0].text).toContain('[REDACTED_CARD]');
    expect(h.rawAvailable).toBe(false);
    await expect(svc.getRawTranscript(ctx([...ALL, 'ai_voice_transcription.view_raw']), h.id)).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
  });

  it('with raw retention on, raw needs the view_raw permission', async () => {
    const { svc, h } = await ingestWith(true);
    expect(h.rawAvailable).toBe(true);
    // no view_raw permission → forbidden
    await expect(svc.getRawTranscript(ctx(ALL), h.id)).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
    // with view_raw → returns the raw text
    const raw = await svc.getRawTranscript(ctx([...ALL, 'ai_voice_transcription.view_raw']), h.id);
    expect(raw[0].rawText).toContain('4111');
  });
});
