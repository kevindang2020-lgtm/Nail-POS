// ai-voice-transcription-intelligence.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { detectIntents, extractAppointment, detectUnresolved, quickSummary, buildSummaryPrompt, finalizeSummary } from './ai-voice-transcription-intelligence';
import { VoiceTranscriptionService, type AiSummarizePort } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import type { VoiceTranscriptionContext, TranscriptSegment } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];
const seg = (seq: number, role: TranscriptSegment['speakerRole'], text: string): TranscriptSegment =>
  ({ seq, speakerLabel: null, speakerRole: role, startMs: seq * 1000, endMs: seq * 1000 + 500, text, language: 'en', confidence: 0.95, isFinal: true, providerSegmentRef: null });

describe('detectIntents', () => {
  it('detects booking + technician + pricing intents from customer lines', () => {
    const segs = [seg(0, 'ai_receptionist', 'Thanks for calling'), seg(1, 'customer', 'I want to book a gel manicure with Kim, how much is it?')];
    const intents = detectIntents(segs).map((i) => i.intent);
    expect(intents).toContain('new_booking');
    expect(intents).toContain('technician_request');
    expect(intents).toContain('pricing');
  });
  it('falls back to general_question when nothing matches', () => {
    expect(detectIntents([seg(0, 'customer', 'hello there')])[0].intent).toBe('general_question');
  });
});

describe('extractAppointment uses the tenant catalog', () => {
  it('pulls service from the catalog + day/time', () => {
    const segs = [seg(0, 'customer', 'can I get a gel manicure on Saturday at 2pm')];
    const a = extractAppointment(segs, ['Gel Manicure', 'Pedicure'], ['Kim']);
    expect(a.requestedServices).toContain('Gel Manicure');
    expect(a.preferredDate?.toLowerCase()).toBe('saturday');
    expect(a.preferredTime?.toLowerCase()).toContain('2pm');
    expect(a.confidence).toBeGreaterThan(0);
  });
  it('does not invent a service absent from the catalog', () => {
    const a = extractAppointment([seg(0, 'customer', 'I want a moon dust facial')], ['Gel Manicure'], []);
    expect(a.requestedServices).toHaveLength(0);
  });
});

describe('detectUnresolved', () => {
  it('flags callback, manager, health-safety, and unanswered pricing', () => {
    const segs = [seg(0, 'customer', 'I had an allergic reaction and want a refund, please have a manager call me back'), seg(1, 'customer', 'also how much for a fill')];
    const items = detectUnresolved(segs, detectIntents(segs)).map((u) => u.type);
    expect(items).toContain('health_safety');
    expect(items).toContain('manager_requested');
    expect(items).toContain('callback_requested');
    expect(items).toContain('refund_requested');
    expect(items).toContain('pricing_unanswered');
  });
});

describe('AI summary sanitization', () => {
  it('keeps a clean AI summary', () => {
    expect(finalizeSummary('Customer booked a gel manicure for Saturday.', 'fallback').source).toBe('ai');
  });
  it('discards output containing card/SSN-looking numbers → fallback', () => {
    expect(finalizeSummary('Customer gave card 4111 1111 1111 1111.', 'fallback text').source).toBe('fallback');
    expect(finalizeSummary('', 'fallback text').source).toBe('fallback');
  });
  it('prompt contains only redacted lines + never instructions to follow', () => {
    const { system, prompt } = buildSummaryPrompt([seg(0, 'customer', 'book me a manicure')], { serviceCatalog: ['Manicure'] });
    expect(system.toLowerCase()).toContain('redacted');
    expect(prompt).toContain('customer: book me a manicure');
  });
});

describe('service integration', () => {
  async function ingest() {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const provider = { name: 'x', async fetchTranscript() { return { segments: [
      { channel: 0, speakerLabel: 'agent', startMs: 0, endMs: 1, text: 'Thanks for calling', language: 'en', confidence: 0.96, isFinal: true },
      { channel: 1, speakerLabel: 'caller', startMs: 2, endMs: 3, text: 'I want to book a gel manicure Saturday', language: 'en', confidence: 0.95, isFinal: true },
    ], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
    // Constitution 10 Phase 23: the fake is the platform port returning the VALIDATED voice.summary.v1 shape.
    // The service composes summary + follow-up into the sanitized text it stores.
    const cleanAi: AiSummarizePort = { async summarize() { return { intent: 'book', service: 'gel manicure', requestedTime: 'Saturday', followUp: 'confirm a time.', summary: 'The customer wants to book a gel manicure on Saturday.' }; } };
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true), 365, false, cleanAi);
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c1', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c1' });
    return { svc, h };
  }

  it('computes intelligence at ingest and generates a sanitized AI summary on demand', async () => {
    const { svc, h } = await ingest();
    const intel = await svc.getIntelligence(ctx(ALL), h.id);
    expect(intel?.quickSummary).toMatch(/new booking|booking/i);
    expect(intel?.intents.some((i: any) => i.intent === 'new_booking')).toBe(true);
    const sum = await svc.generateDetailedSummary(ctx(ALL), h.id);
    expect(sum.source).toBe('ai');
    expect(sum.summary).toMatch(/gel manicure/i);
  });

  it('is tenant-isolated for intelligence', async () => {
    const { svc, h } = await ingest();
    await expect(svc.getIntelligence(ctx(ALL, 'B'), h.id)).rejects.toThrow();
  });

  it('listUnresolved surfaces calls with follow-up items, high-priority first', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const provider = { name: 'x', async fetchTranscript() { return { segments: [
      { channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text: 'I had an allergic reaction, please have a manager call me back', language: 'en', confidence: 0.95, isFinal: true },
    ], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'u1', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'u1' });
    const res = await svc.listUnresolved(ctx(ALL));
    expect(res.items.length).toBe(1);
    expect(res.items[0].unresolved.some((u: any) => u.type === 'health_safety')).toBe(true);
    // tenant isolation
    expect((await svc.listUnresolved(ctx(ALL, 'B'))).items.length).toBe(0);
  });
});
