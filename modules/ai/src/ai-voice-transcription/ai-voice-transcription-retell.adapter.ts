// ai-voice-transcription-retell.adapter.ts — real Retell transcription adapter implementing TranscriptionProviderPort.
// Mirrors the voice-booking RetellVoiceAdapter conventions (env-configured key, defensive parsing). It fetches a
// completed call from Retell's REST API and maps Retell's `transcript_object` into the core's normalized segments;
// it never lets provider-specific shapes leak past this file. `fetchImpl` is injectable so the mapping is unit-tested
// without network. The Mock resolver is still used unless VOICE_TRANSCRIPTION_PROVIDER=retell and RETELL_API_KEY are set.
import type { RawTranscriptSegment, CallMeta } from './ai-voice-transcription.dto';
import type { TranscriptionProviderPort, FetchTranscriptRequest, FetchTranscriptResult } from './ai-voice-transcription.provider';

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

// Retell's get-call payload (subset we depend on). `transcript_object` is the utterance list; each has a role and
// word timings. We map role → channel/speaker label and derive timing from the first/last word.
interface RetellWord { word: string; start?: number; end?: number }
interface RetellUtterance { role?: string; content?: string; words?: RetellWord[] }
interface RetellCall {
  call_id?: string; transcript?: string; transcript_object?: RetellUtterance[];
  duration_ms?: number; direction?: string; recording_url?: string | null; call_type?: string;
}

const secToMs = (s?: number) => (typeof s === 'number' && isFinite(s) ? Math.round(s * 1000) : null);

export function mapRetellCall(call: RetellCall, providerCallId: string, languageHint?: string | null): FetchTranscriptResult {
  const utterances = Array.isArray(call.transcript_object) ? call.transcript_object : [];
  const segments: RawTranscriptSegment[] = utterances.map((u, i) => {
    const role = (u.role ?? '').toLowerCase();
    // Retell roles: 'agent' (the AI/receptionist) and 'user' (the caller). Map to channels the normalizer expects.
    const isAgent = role === 'agent' || role === 'assistant' || role === 'bot';
    const words = Array.isArray(u.words) ? u.words : [];
    const startMs = words.length ? secToMs(words[0].start) : null;
    const endMs = words.length ? secToMs(words[words.length - 1].end) : null;
    return {
      channel: isAgent ? 0 : 1,
      speakerLabel: isAgent ? 'agent' : 'caller',
      startMs: startMs ?? i * 1000,
      endMs: endMs ?? i * 1000 + 500,
      text: (u.content ?? '').trim(),
      language: languageHint ?? 'en',
      confidence: null, // Retell does not expose reliable per-utterance confidence — honest null, not a fabricated score
      isFinal: true,
      providerSegmentRef: `${providerCallId}:${i}`,
    };
  }).filter((s) => s.text.length > 0);

  const direction: CallMeta['direction'] = call.direction === 'outbound' ? 'outbound' : 'inbound';
  return {
    segments,
    meta: { direction, handler: 'ai', agentChannel: 0 },
    durationSeconds: typeof call.duration_ms === 'number' ? Math.round(call.duration_ms / 1000) : null,
    providerTranscriptRef: call.call_id ? `retell:${call.call_id}` : `retell:${providerCallId}`,
  };
}

export class RetellTranscriptionAdapter implements TranscriptionProviderPort {
  name = 'retell';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.RETELL_API_BASE_URL || 'https://api.retellai.com',
    private readonly fetchImpl: FetchLike = ((globalThis as any).fetch as FetchLike),
  ) {}

  private headers() { return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }; }

  async fetchTranscript(req: FetchTranscriptRequest): Promise<FetchTranscriptResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/v2/get-call/${encodeURIComponent(req.providerCallId)}`, { method: 'GET', headers: this.headers() });
    if (!res.ok) {
      // Surface as an empty/audio-unavailable result the ingest path already handles gracefully.
      const err: any = new Error(`retell get-call ${res.status}`); err.status = res.status; throw err;
    }
    const call = (await res.json()) as RetellCall;
    return mapRetellCall(call, req.providerCallId, req.languageHint);
  }

  async deleteRecording(_provider: string, providerCallId: string): Promise<{ deleted: boolean }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v2/delete-call/${encodeURIComponent(providerCallId)}`, { method: 'DELETE', headers: this.headers() });
      // Idempotent: a 404 (already gone) is a successful deletion from our perspective.
      return { deleted: res.ok || res.status === 404 };
    } catch { return { deleted: false }; }
  }

  async healthy(): Promise<boolean> {
    return !!this.apiKey; // credential presence; a real ping can be added when Retell exposes a health route
  }
}
