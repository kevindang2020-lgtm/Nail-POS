// ai-voice-transcription-integration.vitest.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { mapRetellCall, RetellTranscriptionAdapter } from './ai-voice-transcription-retell.adapter';
import { resolveTranscriptionProvider, MockTranscriptionProvider } from './ai-voice-transcription.provider';
import { mapTwilioSentences, TwilioTranscriptionAdapter } from './ai-voice-transcription-twilio.adapter';
import { voiceRetentionSweepCronEnabled, VoiceRetentionSweepScheduler } from './ai-voice-transcription-retention.scheduler';

const retellPayload = {
  call_id: 'call_abc', duration_ms: 42000, direction: 'inbound',
  transcript_object: [
    { role: 'agent', content: 'Thank you for calling, how can I help?', words: [{ word: 'Thank', start: 0.0, end: 0.4 }, { word: 'help', start: 1.0, end: 1.4 }] },
    { role: 'user', content: 'I want to book a gel manicure', words: [{ word: 'I', start: 2.0, end: 2.1 }, { word: 'manicure', start: 3.0, end: 3.6 }] },
    { role: 'agent', content: '', words: [] }, // empty utterance is dropped
  ],
};

describe('mapRetellCall', () => {
  it('maps Retell utterances to normalized segments (agent→ch0, user→ch1), drops empties, honest null confidence', () => {
    const r = mapRetellCall(retellPayload, 'call_abc');
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toMatchObject({ channel: 0, speakerLabel: 'agent', text: 'Thank you for calling, how can I help?', startMs: 0, endMs: 1400, confidence: null, isFinal: true });
    expect(r.segments[1]).toMatchObject({ channel: 1, speakerLabel: 'caller', text: 'I want to book a gel manicure', startMs: 2000, endMs: 3600 });
    expect(r.meta.direction).toBe('inbound');
    expect(r.durationSeconds).toBe(42);
    expect(r.providerTranscriptRef).toBe('retell:call_abc');
  });
});

describe('RetellTranscriptionAdapter (injected fetch, no network)', () => {
  it('fetchTranscript calls get-call and maps the result', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => retellPayload }));
    const a = new RetellTranscriptionAdapter('key_123', 'https://api.retellai.com', fetchImpl as any);
    const r = await a.fetchTranscript({ provider: 'retell', providerCallId: 'call_abc' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/v2/get-call/call_abc'), expect.objectContaining({ method: 'GET' }));
    expect(r.segments).toHaveLength(2);
  });

  it('deleteRecording is idempotent (404 counts as deleted)', async () => {
    const notFound = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const a = new RetellTranscriptionAdapter('key_123', 'https://api.retellai.com', notFound as any);
    expect((await a.deleteRecording('retell', 'gone')).deleted).toBe(true);
  });

  it('surfaces a non-ok get-call as a throwing error (ingest handles it)', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const a = new RetellTranscriptionAdapter('key_123', 'https://api.retellai.com', bad as any);
    await expect(a.fetchTranscript({ provider: 'retell', providerCallId: 'x' })).rejects.toThrow(/502/);
  });
});

describe('resolveTranscriptionProvider', () => {
  it('returns Mock when nothing is configured', () => {
    expect(resolveTranscriptionProvider({} as any)).toBeInstanceOf(MockTranscriptionProvider);
  });
  it('returns the Retell adapter when VOICE_TRANSCRIPTION_PROVIDER=retell + RETELL_API_KEY', () => {
    const p = resolveTranscriptionProvider({ VOICE_TRANSCRIPTION_PROVIDER: 'retell', RETELL_API_KEY: 'k' } as any);
    expect(p.name).toBe('retell');
  });
  it('returns the Twilio adapter when VOICE_TRANSCRIPTION_PROVIDER=twilio + TWILIO creds', () => {
    const p = resolveTranscriptionProvider({ VOICE_TRANSCRIPTION_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' } as any);
    expect(p.name).toBe('twilio');
  });
  it('falls back to Mock if the key is missing even when provider=retell', () => {
    expect(resolveTranscriptionProvider({ VOICE_TRANSCRIPTION_PROVIDER: 'retell' } as any)).toBeInstanceOf(MockTranscriptionProvider);
  });
  it('falls back to Mock if TWILIO creds are missing even when provider=twilio', () => {
    expect(resolveTranscriptionProvider({ VOICE_TRANSCRIPTION_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1' } as any)).toBeInstanceOf(MockTranscriptionProvider);
  });
});

describe('mapTwilioSentences', () => {
  const payload = { sentences: [
    { media_channel: 2, sentence_index: 0, transcript: 'Thanks for calling', confidence: 0.98, start_time: 0.0, end_time: 1.2 },
    { media_channel: 1, sentence_index: 1, transcript: 'I want a pedicure', confidence: 0.91, start_time: 1.5, end_time: 3.0 },
    { media_channel: 1, sentence_index: 2, transcript: '', confidence: 0.5, start_time: 3.1, end_time: 3.2 },
  ] };
  it('maps sentences to segments, carries real confidence, drops empties, agent=media 2', () => {
    const r = mapTwilioSentences(payload, 'GX123');
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toMatchObject({ channel: 1, speakerLabel: 'agent', text: 'Thanks for calling', startMs: 0, endMs: 1200, confidence: 0.98 });
    expect(r.segments[1]).toMatchObject({ channel: 0, speakerLabel: 'caller', text: 'I want a pedicure', confidence: 0.91 });
    expect(r.meta.agentChannel).toBe(1);
    expect(r.durationSeconds).toBe(3);
    expect(r.providerTranscriptRef).toBe('twilio:GX123');
  });
});

describe('TwilioTranscriptionAdapter (injected fetch)', () => {
  it('fetchTranscript calls Sentences and maps', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sentences: [{ media_channel: 1, transcript: 'hi', confidence: 0.9, start_time: 0, end_time: 1 }] }) }));
    const a = new TwilioTranscriptionAdapter('AC1', 'tok', 'https://intelligence.twilio.com/v2', 2, fetchImpl as any);
    const r = await a.fetchTranscript({ provider: 'twilio', providerCallId: 'GX1' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/Transcripts/GX1/Sentences'), expect.objectContaining({ method: 'GET' }));
    expect(r.segments[0].confidence).toBe(0.9);
  });
  it('deleteRecording idempotent on 404', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const a = new TwilioTranscriptionAdapter('AC1', 'tok', 'https://intelligence.twilio.com/v2', 2, f as any);
    expect((await a.deleteRecording('twilio', 'gone')).deleted).toBe(true);
  });
});

describe('retention sweep scheduler', () => {
  it('cron flag parses truthy values', () => {
    expect(voiceRetentionSweepCronEnabled({ VOICE_RETENTION_SWEEP_CRON_ENABLED: 'true' } as any)).toBe(true);
    expect(voiceRetentionSweepCronEnabled({ VOICE_RETENTION_SWEEP_CRON_ENABLED: 'off' } as any)).toBe(false);
    expect(voiceRetentionSweepCronEnabled({} as any)).toBe(false);
  });
  it('does not arm a timer when disabled', () => {
    const svc = { runRetentionSweep: vi.fn(async () => ({ scanned: 0, deleted: 0, failed: 0 })) } as any;
    const sched = new VoiceRetentionSweepScheduler(svc);
    sched.onModuleInit(); // disabled by default → no tick, no timer
    expect(svc.runRetentionSweep).not.toHaveBeenCalled();
    sched.onModuleDestroy();
  });
});
