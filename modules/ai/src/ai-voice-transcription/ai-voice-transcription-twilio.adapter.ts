// ai-voice-transcription-twilio.adapter.ts — real Twilio transcription adapter implementing TranscriptionProviderPort.
// Mirrors the voice-booking TwilioTelephonyProvider conventions (HTTP Basic auth AccountSid:AuthToken, injectable
// fetch). It reads a Twilio Voice Intelligence Transcript's Sentences and maps them into the core's normalized
// segments. Twilio DOES expose per-sentence confidence, so we carry it through honestly (unlike Retell, where it is
// null). Provider-specific shapes never leak past this file. The Mock resolver is used unless
// VOICE_TRANSCRIPTION_PROVIDER=twilio and TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set.
import type { RawTranscriptSegment, CallMeta } from './ai-voice-transcription.dto';
import type { TranscriptionProviderPort, FetchTranscriptRequest, FetchTranscriptResult } from './ai-voice-transcription.provider';

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

// Twilio Voice Intelligence "Sentences" (subset). media_channel is 1-based; start/end are seconds.
interface TwilioSentence { media_channel?: number; sentence_index?: number; transcript?: string; confidence?: number; start_time?: number; end_time?: number }
interface TwilioSentencesResponse { sentences?: TwilioSentence[] }

const secToMs = (s?: number) => (typeof s === 'number' && isFinite(s) ? Math.round(s * 1000) : null);

export function mapTwilioSentences(
  payload: TwilioSentencesResponse, providerCallId: string,
  opts: { agentMediaChannel?: number; direction?: CallMeta['direction']; languageHint?: string | null } = {},
): FetchTranscriptResult {
  const agentMedia = opts.agentMediaChannel ?? 2; // default: media_channel 2 is the agent leg
  const sentences = Array.isArray(payload.sentences) ? payload.sentences : [];
  let maxEndMs = 0;
  const segments: RawTranscriptSegment[] = sentences.map((s, i) => {
    const media = typeof s.media_channel === 'number' ? s.media_channel : 1;
    const isAgent = media === agentMedia;
    const startMs = secToMs(s.start_time) ?? i * 1000;
    const endMs = secToMs(s.end_time) ?? startMs + 500;
    if (endMs > maxEndMs) maxEndMs = endMs;
    return {
      channel: Math.max(0, media - 1),
      speakerLabel: isAgent ? 'agent' : 'caller',
      startMs, endMs,
      text: (s.transcript ?? '').trim(),
      language: opts.languageHint ?? 'en',
      confidence: typeof s.confidence === 'number' ? s.confidence : null, // Twilio provides this — carry it honestly
      isFinal: true,
      providerSegmentRef: `${providerCallId}:${typeof s.sentence_index === 'number' ? s.sentence_index : i}`,
    };
  }).filter((s) => s.text.length > 0);

  return {
    segments,
    meta: { direction: opts.direction ?? 'inbound', handler: 'ai', agentChannel: Math.max(0, agentMedia - 1) },
    durationSeconds: maxEndMs > 0 ? Math.round(maxEndMs / 1000) : null,
    providerTranscriptRef: `twilio:${providerCallId}`,
  };
}

export class TwilioTranscriptionAdapter implements TranscriptionProviderPort {
  name = 'twilio';
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly baseUrl = process.env.TWILIO_INTELLIGENCE_BASE_URL || 'https://intelligence.twilio.com/v2',
    private readonly agentMediaChannel = Number(process.env.TWILIO_AGENT_MEDIA_CHANNEL) || 2,
    private readonly fetchImpl: FetchLike = ((globalThis as any).fetch as FetchLike),
  ) {}

  private headers() { return { authorization: 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64') }; }

  async fetchTranscript(req: FetchTranscriptRequest): Promise<FetchTranscriptResult> {
    // providerCallId is the Voice Intelligence Transcript SID supplied by the transcription webhook.
    const res = await this.fetchImpl(`${this.baseUrl}/Transcripts/${encodeURIComponent(req.providerCallId)}/Sentences`, { method: 'GET', headers: this.headers() });
    if (!res.ok) { const err: any = new Error(`twilio sentences ${res.status}`); err.status = res.status; throw err; }
    const payload = (await res.json()) as TwilioSentencesResponse;
    return mapTwilioSentences(payload, req.providerCallId, { agentMediaChannel: this.agentMediaChannel, languageHint: req.languageHint });
  }

  async deleteRecording(_provider: string, providerCallId: string): Promise<{ deleted: boolean }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/Transcripts/${encodeURIComponent(providerCallId)}`, { method: 'DELETE', headers: this.headers() });
      return { deleted: res.ok || res.status === 404 }; // idempotent
    } catch { return { deleted: false }; }
  }

  async healthy(): Promise<boolean> { return !!(this.accountSid && this.authToken); }
}
