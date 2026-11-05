// ai-voice-transcription.provider.ts — the transcription provider adapter contract. This is distinct from the
// receptionist gateway's VoiceProviderPort (that handles tool-calls); this handles recording/transcription
// retrieval + deletion. Provider-specific code (Retell/Twilio/Deepgram/etc.) lives inside adapters; the core only
// ever sees these normalized shapes. A deterministic Mock lets dev/test/CI run with no network and no credentials.
import type { RawTranscriptSegment, CallMeta } from './ai-voice-transcription.dto';
import { RetellTranscriptionAdapter } from './ai-voice-transcription-retell.adapter';
import { TwilioTranscriptionAdapter } from './ai-voice-transcription-twilio.adapter';

export interface FetchTranscriptRequest {
  provider: string;
  providerCallId: string;
  recordingRef?: string | null;
  languageHint?: string | null;
}
export interface FetchTranscriptResult {
  segments: RawTranscriptSegment[];
  meta: CallMeta;
  durationSeconds: number | null;
  providerTranscriptRef: string | null;
}

export interface TranscriptionProviderPort {
  name: string;
  // Retrieve + transcribe an authorized recording (batch). Streaming is handled by the ingestion slice.
  fetchTranscript(req: FetchTranscriptRequest): Promise<FetchTranscriptResult>;
  // Provider-side deletion for retention/right-to-erasure. Idempotent: deleting an absent recording succeeds.
  deleteRecording(provider: string, providerCallId: string): Promise<{ deleted: boolean }>;
  healthy(): Promise<boolean>;
}

// Deterministic Mock — no network. Produces a stable two-speaker nail-salon transcript from the call id so tests
// and local dev exercise the whole pipeline offline. Never used when a real provider is configured.
export class MockTranscriptionProvider implements TranscriptionProviderPort {
  name = 'mock';
  async fetchTranscript(req: FetchTranscriptRequest): Promise<FetchTranscriptResult> {
    const segments: RawTranscriptSegment[] = [
      { channel: 0, speakerLabel: 'agent', startMs: 0, endMs: 2500, text: 'Thank you for calling, how can I help you today?', language: 'en', confidence: 0.97, isFinal: true, providerSegmentRef: `${req.providerCallId}:0` },
      { channel: 1, speakerLabel: 'caller', startMs: 2600, endMs: 6000, text: 'Hi, I would like to book a gel manicure for Saturday afternoon.', language: 'en', confidence: 0.95, isFinal: true, providerSegmentRef: `${req.providerCallId}:1` },
      { channel: 0, speakerLabel: 'agent', startMs: 6100, endMs: 9000, text: 'We have two o clock available with Kim. Would that work?', language: 'en', confidence: 0.96, isFinal: true, providerSegmentRef: `${req.providerCallId}:2` },
      { channel: 1, speakerLabel: 'caller', startMs: 9100, endMs: 11000, text: 'Yes, two o clock is perfect. Thank you.', language: 'en', confidence: 0.94, isFinal: true, providerSegmentRef: `${req.providerCallId}:3` },
    ];
    return { segments, meta: { direction: 'inbound', handler: 'ai', agentChannel: 0 }, durationSeconds: 11, providerTranscriptRef: `mock:${req.providerCallId}` };
  }
  async deleteRecording() { return { deleted: true }; }
  async healthy() { return true; }
}

// Resolve the configured transcription provider. Returns the Mock when nothing real is wired (dev/test/CI).
export function resolveTranscriptionProvider(env: NodeJS.ProcessEnv = process.env): TranscriptionProviderPort {
  const which = String(env.VOICE_TRANSCRIPTION_PROVIDER ?? '').trim().toLowerCase();
  if (which === 'retell' && env.RETELL_API_KEY) {
    return new RetellTranscriptionAdapter(env.RETELL_API_KEY);
  }
  if (which === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    return new TwilioTranscriptionAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return new MockTranscriptionProvider();
}
