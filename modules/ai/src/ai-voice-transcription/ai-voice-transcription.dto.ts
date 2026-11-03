// ai-voice-transcription.dto.ts — contracts for the transcription layer. Provider-agnostic: adapters normalize
// their payloads into these shapes so the core never sees provider-specific data. Tenant/branch are always
// server-derived and carried in the context, never trusted from a webhook body.
export type CallDirection = 'inbound' | 'outbound';
export type CallHandler = 'ai' | 'human' | 'voicemail' | 'unknown';
export type SpeakerRole =
  | 'customer' | 'ai_receptionist' | 'human_receptionist' | 'technician' | 'manager' | 'additional_caller' | 'unknown';
export type ConsentStatus = 'granted' | 'declined' | 'not_required' | 'unknown';
export type ConsentMethod = 'verbal_recorded' | 'announcement' | 'keypad' | 'provider_recorded' | 'policy_ack' | 'disabled';
export type TranscriptStatus =
  | 'queued' | 'processing' | 'partial' | 'completed' | 'low_confidence' | 'transcription_disabled'
  | 'consent_missing' | 'consent_declined' | 'recording_disabled' | 'audio_unavailable' | 'provider_error'
  | 'manual_review_required' | 'retention_expired' | 'deleted' | 'failed';
export type RedactionStatus = 'pending' | 'processing' | 'completed' | 'not_required' | 'failed';

// Server-derived request context. Resolved from the authenticated user (tenant membership + branch + role) or from
// a validated provider integration key — never from client/webhook-supplied ids.
export interface VoiceTranscriptionContext {
  tenantId: string;
  branchId: string | null;
  userId: string;
  role: string;
  permissions: string[];
}

// A raw segment as an adapter hands it up (already normalized out of provider-specific JSON).
export interface RawTranscriptSegment {
  channel?: number | null;        // provider audio channel, when dual-channel
  speakerLabel?: string | null;   // provider speaker/diarization id
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  language?: string | null;
  confidence?: number | null;
  isFinal?: boolean;
  providerSegmentRef?: string | null;
}

// Call metadata an adapter provides alongside segments (drives speaker classification — see normalize).
export interface CallMeta {
  direction: CallDirection;
  handler: CallHandler;
  // provider hints, when available: which channel/label is the salon/agent side vs the caller side.
  agentChannel?: number | null;
  agentSpeakerLabels?: string[];  // labels known to be the AI/human receptionist
}

// A normalized internal segment (what we persist).
export interface TranscriptSegment {
  seq: number;
  speakerLabel: string | null;
  speakerRole: SpeakerRole;
  startMs: number | null;
  endMs: number | null;
  text: string;                   // redacted text lives here after slice 3; raw handled separately
  language: string | null;
  confidence: number | null;
  isFinal: boolean;
  providerSegmentRef: string | null;
}

export interface LanguageResult {
  primaryLanguage: string | null;
  confidence: number | null;
  mixedLanguage: boolean;
  languages: { language: string; share: number }[];
}

export interface TranscriptHeader {
  id: string;
  tenantId: string;
  branchId: string | null;
  provider: string;
  providerCallId: string;
  customerId: string | null;
  direction: CallDirection;
  handler: CallHandler;
  status: TranscriptStatus;
  primaryLanguage: string | null;
  languageConfidence: number | null;
  mixedLanguage: boolean;
  redactionStatus: RedactionStatus;
  rawAvailable: boolean;
  confidence: number | null;
  durationSeconds: number | null;
  segmentCount: number;
  legalHold: boolean;
  retentionExpiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentRecord {
  tenantId: string;
  branchId: string | null;
  provider: string;
  providerCallId: string;
  consentStatus: ConsentStatus;
  consentMethod: ConsentMethod | null;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  announcementVersion: string | null;
  jurisdiction: string | null;
  initiatedBy: string | null;
  consentAt: string | null;
}

// Errors (mapped to HTTP in the controller).
export class VoiceTranscriptionForbiddenError extends Error {
  constructor(msg = 'INSUFFICIENT_PERMISSION') { super(msg); this.name = 'VoiceTranscriptionForbiddenError'; }
}
export class VoiceTranscriptionValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'VoiceTranscriptionValidationError'; }
}
// Voice Transcription Settings guide (Nov 2026)
/** a save based on a version that is no longer the latest (someone else saved first) */
export class VoiceSettingsConflictError extends Error {
  constructor(readonly currentVersion: number) { super('VT_SETTINGS_VERSION_CONFLICT'); this.name = 'VoiceSettingsConflictError'; }
}
/** a sensitive change (shorter retention, raw text on / off, transcription off) needs an explicit confirm; carries the impact */
export class VoiceSettingsConfirmRequiredError extends Error {
  constructor(readonly impact: VoiceSettingsImpact) { super('VT_CONFIRM_REQUIRED'); this.name = 'VoiceSettingsConfirmRequiredError'; }
}
/** the settings could not be read — nothing is transcribed on defaults (fail closed) */
export class VoiceSettingsUnavailableError extends Error {
  constructor() { super('VT_SETTINGS_UNAVAILABLE'); this.name = 'VoiceSettingsUnavailableError'; }
}
export interface VoiceSettingsImpact {
  sensitive: string[];                 // which sensitive changes this save makes: retention_shortened · raw_on · raw_off · transcription_off
  transcripts: number;                 // live (not deleted) transcripts whose deletion date moves with the new window
  dueNow: number;                      // of those, not on legal hold and past the NEW window — erased by the next retention sweep
  rawToPurge: number;                  // transcripts whose raw (pre-redaction) text is removed now (raw off; legal holds keep theirs)
}
export class VoiceTranscriptionDisabledError extends Error {
  constructor(msg = 'AI_VOICE_TRANSCRIPTION_DISABLED') { super(msg); this.name = 'VoiceTranscriptionDisabledError'; }
}
export class ConsentRequiredError extends Error {
  constructor(msg = 'CONSENT_REQUIRED') { super(msg); this.name = 'ConsentRequiredError'; }
}
