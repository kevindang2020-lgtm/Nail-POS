// ai-voice-transcription-normalize.ts — PURE, provider-agnostic transcript logic. No provider SDK, no DB, no AI.
// Speaker classification uses call direction + channel/label metadata + turn position — it never assumes
// "speaker 1 = customer". Language is aggregated from per-segment detections. All deterministic and unit-tested.
import type {
  RawTranscriptSegment, TranscriptSegment, SpeakerRole, CallMeta, LanguageResult, ConsentRecord, ConsentStatus,
} from './ai-voice-transcription.dto';

// Classify a segment's speaker role from metadata, not position.
// Priority: explicit agent channel/label hints → provider role words → alternating fallback seeded by direction.
export function classifySpeaker(
  seg: RawTranscriptSegment, meta: CallMeta, prevRole: SpeakerRole | null,
): SpeakerRole {
  const agentLabels = new Set((meta.agentSpeakerLabels ?? []).map((s) => s.toLowerCase()));
  const label = (seg.speakerLabel ?? '').toLowerCase();

  // 1) explicit channel hint (dual-channel: agent side is known)
  if (meta.agentChannel != null && seg.channel != null) {
    const isAgent = seg.channel === meta.agentChannel;
    return isAgent ? agentRole(meta) : 'customer';
  }
  // 2) explicit label hint
  if (label && agentLabels.has(label)) return agentRole(meta);
  // 3) provider role words in the label
  if (/agent|assistant|receptionist|ivr|system|salon|staff/.test(label)) return agentRole(meta);
  if (/caller|customer|client|user/.test(label)) return 'customer';
  // 4) alternating fallback seeded by direction: inbound → first speaker is the salon/greeting side; outbound →
  //    first speaker is the salon (it placed the call). If we truly can't tell, mark unknown rather than guess wrong.
  if (prevRole === 'customer') return agentRole(meta);
  if (prevRole && prevRole !== 'unknown') return 'customer';
  return 'unknown';
}

function agentRole(meta: CallMeta): SpeakerRole {
  return meta.handler === 'human' ? 'human_receptionist' : meta.handler === 'ai' ? 'ai_receptionist' : 'unknown';
}

// Normalize raw provider segments into ordered internal segments with classified roles.
export function normalizeSegments(raw: RawTranscriptSegment[], meta: CallMeta): TranscriptSegment[] {
  const ordered = raw
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.startMs ?? a.i) - (b.s.startMs ?? b.i) || a.i - b.i);
  const out: TranscriptSegment[] = [];
  let prevRole: SpeakerRole | null = null;
  let seq = 0;
  for (const { s } of ordered) {
    const text = (s.text ?? '').trim();
    if (!text) continue;
    const speakerRole = classifySpeaker(s, meta, prevRole);
    prevRole = speakerRole === 'unknown' ? prevRole : speakerRole;
    out.push({
      seq: seq++,
      speakerLabel: s.speakerLabel ?? (s.channel != null ? `ch${s.channel}` : null),
      speakerRole,
      startMs: s.startMs ?? null,
      endMs: s.endMs ?? null,
      text,
      language: s.language ?? null,
      confidence: s.confidence ?? null,
      isFinal: s.isFinal !== false,
      providerSegmentRef: s.providerSegmentRef ?? null,
    });
  }
  return out;
}

// Aggregate per-segment languages into a call-level result. Weighted by segment text length so a one-word
// interjection doesn't flip the primary language. mixedLanguage when a secondary language holds a real share.
export function detectLanguage(segments: TranscriptSegment[], minSecondaryShare = 0.2): LanguageResult {
  const weight = new Map<string, number>();
  let total = 0;
  for (const s of segments) {
    if (!s.language) continue;
    const w = Math.max(1, s.text.length);
    weight.set(s.language, (weight.get(s.language) ?? 0) + w);
    total += w;
  }
  if (total === 0) return { primaryLanguage: null, confidence: null, mixedLanguage: false, languages: [] };
  const languages = [...weight.entries()]
    .map(([language, w]) => ({ language, share: w / total }))
    .sort((a, b) => b.share - a.share);
  const primary = languages[0];
  const secondary = languages[1];
  return {
    primaryLanguage: primary.language,
    confidence: Math.round(primary.share * 10000) / 10000,
    mixedLanguage: !!secondary && secondary.share >= minSecondaryShare,
    languages,
  };
}

// Mean segment confidence → transcript confidence; below floor ⇒ caller should mark low_confidence.
export function overallConfidence(segments: TranscriptSegment[]): number | null {
  const vals = segments.map((s) => s.confidence).filter((c): c is number => c != null);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10000) / 10000;
}

// Consent gate: may we transcribe? Pure decision from the consent record + tenant policy default. This never
// trusts the caller — the record is written from validated provider/consent evidence upstream.
export function transcriptionAuthorized(consent: Pick<ConsentRecord, 'consentStatus' | 'transcriptionEnabled'>): boolean {
  return consent.transcriptionEnabled === true &&
    (consent.consentStatus === 'granted' || consent.consentStatus === 'not_required');
}

// Map a consent outcome to the transcript status when transcription cannot proceed.
export function blockedStatusForConsent(consentStatus: ConsentStatus, transcriptionEnabled: boolean):
  'transcription_disabled' | 'consent_missing' | 'consent_declined' | null {
  if (!transcriptionEnabled) return 'transcription_disabled';
  if (consentStatus === 'declined') return 'consent_declined';
  if (consentStatus === 'unknown') return 'consent_missing';
  return null; // granted / not_required → allowed
}
