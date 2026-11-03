// ai-voice-transcription.service.ts — orchestrates the transcription pipeline foundation. Gates on (1) tenant
// entitlement to ai_voice_transcription and (2) recorded consent, then fetches via the provider adapter, runs the
// PURE normalization/language/speaker logic, and persists a tenant-scoped transcript. Heavy provider/AI work is
// delegated to the adapter, not done inline; later slices add redaction, summaries, retention, and search.
import { decodeCursor, withCode } from '@aipowersalon/api-contracts';
import { isSystemContext } from '@aipowersalon/tenant-context';
import type {
  VoiceTranscriptionContext, TranscriptHeader, TranscriptSegment, ConsentRecord,
} from './ai-voice-transcription.dto';
import {
  VoiceTranscriptionForbiddenError, VoiceTranscriptionValidationError, VoiceTranscriptionDisabledError, VoiceSettingsUnavailableError,
} from './ai-voice-transcription.dto';
import type { VoiceTranscriptionRepositoryPort, TranscriptFilters, VoiceSettings } from './ai-voice-transcription.repository';
import type { VoiceEntitlementPort } from './ai-voice-transcription-entitlement';
import type { TranscriptionProviderPort } from './ai-voice-transcription.provider';
import { normalizeSegments, detectLanguage, overallConfidence, transcriptionAuthorized, blockedStatusForConsent } from './ai-voice-transcription-normalize';
import { redactSegments } from './ai-voice-transcription-redaction';
import { redactVerificationTurns } from '@aipowersalon/booking';
import { detectIntents, extractAppointment, detectUnresolved, quickSummary, buildSummaryPrompt, finalizeSummary } from './ai-voice-transcription-intelligence';

// Constitution 10 Phase 23: the summarization call goes through AiPlatform.execute('voice.summarize'), which
// owns entitlement, routing, schema validation and per-call usage. §18: the module depends on this narrow port.
//
// The MINUTES usage logger below is NOT replaced by that: it meters transcribed audio minutes (the unit the
// package is sold in), which is a different fact from the per-call token usage the platform records. Two
// different units, two different rows — not duplication.
export interface AiSummarizePort {
  summarize(req: { tenantId: string; userId: string | null; transcript: string }): Promise<{ intent: string; service: string | null; requestedTime: string | null; followUp: string | null; summary: string } | null>;
}
// Tenant-authorized context for extraction/summary. Returns the ACTIVE service catalog + technician names — the
// authorized reference (never a hard-coded list). Defaults to empty when not wired.
export interface CatalogPort { serviceCatalog(tenantId: string, branchId: string | null): Promise<string[]>; technicianNames(tenantId: string, branchId: string | null): Promise<string[]>; }
// Reuse the platform usage logger (writes ai_usage_logs) so transcription minutes appear in the existing tenant +
// super-admin AI Usage surfaces — no parallel usage table.
export interface UsageLoggerPort { log(entry: { tenantId: string; userId: string | null; packageCode: string; action: string; modelProvider: string | null; modelName: string | null; inputTokens: number; outputTokens: number; usageUnit: string; usageAmount: number; costMicroUsd: number; status: string; createdAt: string; requestId?: string | null }): Promise<void>; }

const LOW_CONFIDENCE = 0.6;

export interface IngestRequest {
  provider: string;
  providerCallId: string;
  customerId?: string | null;
  recordingRef?: string | null;
  languageHint?: string | null;
}

export class VoiceTranscriptionService {
  constructor(
    private readonly repo: VoiceTranscriptionRepositoryPort,
    private readonly provider: TranscriptionProviderPort,
    private readonly entitlement?: VoiceEntitlementPort,
    private readonly retentionDays = Number(process.env.VOICE_TRANSCRIPT_RETENTION_DAYS) || 365,
    // Raw (pre-redaction) transcript retention is OFF by default; only enabled deliberately per policy, and even
    // then access is gated behind the view_raw permission.
    private readonly retainRaw = process.env.VOICE_RETAIN_RAW_TRANSCRIPT === '1',
    private readonly ai?: AiSummarizePort,
    private readonly catalog?: CatalogPort,
    private readonly usageLogger?: UsageLoggerPort,
  ) {}

  private need(ctx: VoiceTranscriptionContext, perm: string) {
    if (!ctx?.tenantId) throw new VoiceTranscriptionValidationError('Missing tenant context');
    if (!(ctx.permissions || []).includes(perm)) throw new VoiceTranscriptionForbiddenError();
  }
  private async assertEnabled(ctx: VoiceTranscriptionContext) {
    if (this.entitlement && !(await this.entitlement.hasVoiceTranscription(ctx.tenantId))) {
      throw new VoiceTranscriptionDisabledError();
    }
  }

  // Record/refresh consent evidence for a call (server-derived context; never trusts client-supplied tenant).
  async recordConsent(ctx: VoiceTranscriptionContext, c: Omit<ConsentRecord, 'tenantId'>): Promise<ConsentRecord> {
    this.need(ctx, 'ai_voice_transcription.manage_settings');
    await this.assertEnabled(ctx);
    if (!c.providerCallId) throw new VoiceTranscriptionValidationError('providerCallId required');
    return this.repo.upsertConsent(ctx, c);
  }

  // Ingest + transcribe an authorized call. Idempotent per (tenant, provider, providerCallId). If consent blocks
  // transcription, a header is written with the blocked status and NO segments — we never store unauthorized voice.
  async ingest(ctx: VoiceTranscriptionContext, req: IngestRequest): Promise<TranscriptHeader> {
    this.need(ctx, 'ai_voice_transcription.manage_rules');
    await this.assertEnabled(ctx);
    if (!req.providerCallId) throw new VoiceTranscriptionValidationError('providerCallId required');

    // Tenant policy (falls back to env defaults only when NOTHING is saved). A tenant can turn transcription off entirely.
    // Voice Transcription Settings guide (Nov 2026): no `.catch(() => null)` — an unreadable settings row used to fall back
    // to the defaults, so a salon that had switched transcription OFF (or raw text OFF) was transcribed on defaults. Now the
    // ingest fails (503) and the provider redelivers; nothing is stored.
    let settings: Awaited<ReturnType<VoiceTranscriptionRepositoryPort['getSettings']>>;
    try { settings = await this.repo.getSettings(ctx); } catch { throw new VoiceSettingsUnavailableError(); }
    if (settings && settings.transcriptionEnabled === false) {
      const { header } = await this.repo.upsertTranscript(ctx, {
        provider: req.provider, providerCallId: req.providerCallId, customerId: req.customerId ?? null,
        direction: 'inbound', handler: 'unknown', status: 'transcription_disabled', primaryLanguage: null,
        languageConfidence: null, mixedLanguage: false, redactionStatus: 'not_required', confidence: null,
        durationSeconds: null, providerTranscriptRef: null, retentionExpiresAt: null,
      });
      return header;
    }
    const effRetentionDays = settings?.retentionDays ?? this.retentionDays;
    const effRetainRaw = settings?.retainRaw ?? this.retainRaw;

    const consent = await this.repo.getConsent(ctx, req.providerCallId);
    const consentStatus = consent?.consentStatus ?? 'unknown';
    const transcriptionEnabled = consent?.transcriptionEnabled ?? false;

    const blocked = blockedStatusForConsent(consentStatus, transcriptionEnabled);
    if (blocked || !transcriptionAuthorized({ consentStatus, transcriptionEnabled })) {
      const { header } = await this.repo.upsertTranscript(ctx, {
        provider: req.provider, providerCallId: req.providerCallId, customerId: req.customerId ?? null,
        direction: 'inbound', handler: 'unknown', status: blocked ?? 'transcription_disabled',
        primaryLanguage: null, languageConfidence: null, mixedLanguage: false, redactionStatus: 'not_required',
        confidence: null, durationSeconds: null, providerTranscriptRef: null, retentionExpiresAt: null,
      });
      return header; // no segments persisted — unauthorized voice is never stored
    }

    // Authorized: fetch + normalize (pure) + persist.
    let fetched;
    try {
      fetched = await this.provider.fetchTranscript({ provider: req.provider, providerCallId: req.providerCallId, recordingRef: req.recordingRef, languageHint: req.languageHint });
    } catch {
      const { header } = await this.repo.upsertTranscript(ctx, {
        provider: req.provider, providerCallId: req.providerCallId, customerId: req.customerId ?? null,
        direction: 'inbound', handler: 'unknown', status: 'provider_error', primaryLanguage: null, languageConfidence: null,
        mixedLanguage: false, redactionStatus: 'not_required', confidence: null, durationSeconds: null, providerTranscriptRef: null, retentionExpiresAt: null,
      });
      return header;
    }

    const segments: TranscriptSegment[] = normalizeSegments(fetched.segments, fetched.meta);
    const lang = detectLanguage(segments);
    const conf = overallConfidence(segments);
    const status = segments.length === 0 ? 'audio_unavailable' : (conf != null && conf < LOW_CONFIDENCE ? 'low_confidence' : 'completed');
    const retentionExpiresAt = new Date(Date.now() + effRetentionDays * 86400_000).toISOString();

    // REDACT before anything is stored/searched/sent to AI. Raw text is retained only when policy allows and only
    // where something was actually redacted; it stays access-gated (view_raw) and off by default.
    const rawRetained = effRetainRaw;

    // ── verification codes FIRST, and STATEFULLY ────────────────────────────────────────────────────────
    //
    // `redactSegments` works one segment at a time, so it structurally cannot see a spoken verification code: the
    // assistant asks for it in one turn ("say your six-digit code") and the caller answers in the next ("one two
    // three four five six"). The anchor and the value are never visible to the same regex.
    //
    // I probed it: FOUR OF FIVE real cases leaked. The only one it caught was the artificial one with the keyword
    // and the value in a single string. A code that reaches the transcript then flows into the AI prompt, the call
    // summary, the search index and the stored recording — a permanent, searchable authentication secret sitting
    // in a salon's call history.
    //
    // This pass REMEMBERS that a code was just asked for, and scrubs the caller's next digit-bearing turn. It runs
    // BEFORE redactSegments so the code is gone before anything else touches the text.
    //
    // (The real answer is DTMF — a code typed on the keypad never reaches the recogniser at all. This is defence
    // in depth for the caller who ignores the prompt and speaks the digits anyway.)
    // The 'assistant' is whoever ASKS for the code — the AI receptionist or a human one. Everyone else is a
    // 'caller' whose next digit-bearing turn is a candidate secret. Mapping `unknown` to 'caller' is the safe
    // direction: an unlabelled speaker who recites six digits after a code prompt gets scrubbed rather than
    // waved through because the diariser was unsure who was talking.
    const ASKERS = ['ai_receptionist', 'human_receptionist'];
    const codeScrubbed = redactVerificationTurns(
      segments.map((sg) => ({
        speaker: ASKERS.includes(sg.speakerRole) ? 'assistant' : 'caller',
        text: sg.text ?? '',
      })),
    );
    const segmentsNoCode = segments.map((sg, i) => ({ ...sg, text: codeScrubbed.turns[i]?.text ?? sg.text }));

    const { segments: redacted, rawTexts, categories, anyApplied } = redactSegments(segmentsNoCode);

    const { header } = await this.repo.upsertTranscript(ctx, {
      provider: req.provider, providerCallId: req.providerCallId, customerId: req.customerId ?? null,
      direction: fetched.meta.direction, handler: fetched.meta.handler, status,
      primaryLanguage: lang.primaryLanguage, languageConfidence: lang.confidence, mixedLanguage: lang.mixedLanguage,
      redactionStatus: 'pending', confidence: conf, durationSeconds: fetched.durationSeconds,
      providerTranscriptRef: fetched.providerTranscriptRef, retentionExpiresAt,
    });
    // Phase 12 (#27): a deleted / retention-expired transcript is final — a replayed ingest writes no segments again
    if (header.status === 'deleted' || header.status === 'retention_expired') return header;
    await this.repo.replaceSegments(ctx, header.id, redacted, { rawTexts, rawRetained });
    await this.repo.setRedaction(ctx, header.id, { status: anyApplied ? 'completed' : 'not_required', categories, rawAvailable: rawRetained && anyApplied });
    await this.repo.recordRedactionEvent(ctx, header.id, categories, redacted.filter((_, i) => rawTexts[i] != null).length, rawRetained && anyApplied);

    // Deterministic call intelligence over REDACTED text (offline, no AI). AI detailed summary is on-demand.
    if (redacted.length > 0) {
      const svcCatalog = this.catalog ? await this.catalog.serviceCatalog(ctx.tenantId, ctx.branchId).catch(() => []) : [];
      const techs = this.catalog ? await this.catalog.technicianNames(ctx.tenantId, ctx.branchId).catch(() => []) : [];
      const intents = detectIntents(redacted);
      const appt = extractAppointment(redacted, svcCatalog, techs);
      const unresolved = detectUnresolved(redacted, intents);
      await this.repo.upsertIntelligence(ctx, {
        transcriptId: header.id, providerCallId: req.providerCallId, quickSummary: quickSummary(redacted, intents, appt),
        detailedSummary: null, detailedSource: null, intents, appointment: appt, unresolved, sentiment: null,
        extractionConfidence: appt.confidence,
      });
    }
    // Usage: log transcribed minutes to the shared usage ledger (reused by tenant + super-admin AI Usage surfaces).
    if ((status === 'completed' || status === 'low_confidence') && this.usageLogger && (fetched.durationSeconds ?? 0) > 0) {
      const minutes = Math.max(1, Math.ceil((fetched.durationSeconds ?? 0) / 60));
      try {
        // A system actor has no user id (systemContext → 'system:<job>', role SYSTEM); ai_usage_logs.user_id is a UUID.
        await this.usageLogger.log({ tenantId: ctx.tenantId, userId: isSystemContext(ctx) || ctx.userId === 'system' ? null : ctx.userId, packageCode: 'ai_voice_transcription', action: 'transcribe', modelProvider: req.provider, modelName: null, inputTokens: 0, outputTokens: 0, usageUnit: 'minutes', usageAmount: minutes, costMicroUsd: 0, status: 'success', createdAt: new Date().toISOString(),
          // Phase 14: one call is metered once — a re-delivered webhook for the same call adds no minutes (565)
          requestId: `transcribe:${req.provider}:${req.providerCallId}` });
      } catch { /* usage logging is best-effort; never blocks transcription */ }
    }
    return (await this.repo.getTranscript(ctx, header.id))!;
  }

  async getTranscript(ctx: VoiceTranscriptionContext, id: string): Promise<{ header: TranscriptHeader; segments: TranscriptSegment[] }> {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    const header = await this.repo.getTranscript(ctx, id);
    if (!header) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    const segments = await this.repo.getSegments(ctx, id);
    return { header, segments };
  }

  // ── Retention & deletion ─────────────────────────────────────────────────────────────────────────────────
  // Explicit erasure (retention expiry, tenant/customer request). Idempotent; refuses while under legal hold.
  async deleteTranscript(ctx: VoiceTranscriptionContext, id: string, reason: 'tenant_request' | 'customer_request' | 'manual' | 'admin' = 'manual'): Promise<{ deleted: boolean; providerDeleted: boolean }> {
    this.need(ctx, 'ai_voice_transcription.delete');
    await this.assertEnabled(ctx);
    const header = await this.repo.getTranscript(ctx, id);
    if (!header) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    if (header.legalHold) throw new VoiceTranscriptionValidationError('LEGAL_HOLD');
    return this.eraseOne({ tenantId: ctx.tenantId, branchId: ctx.branchId }, id, reason, ctx.userId);
  }

  async setLegalHold(ctx: VoiceTranscriptionContext, id: string, hold: boolean): Promise<{ ok: boolean }> {
    this.need(ctx, 'ai_voice_transcription.manage_settings');
    await this.assertEnabled(ctx);
    const ok = await this.repo.setLegalHold(ctx, id, hold);
    if (!ok) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    return { ok };
  }

  // Background retention sweep (system job; wire to the scheduler). Deletes expired, non-held transcripts across
  // tenants — each deletion is tenant-scoped and idempotent. Returns counts; never throws on a single failure.
  async runRetentionSweep(limit = 200): Promise<{ scanned: number; deleted: number; failed: number }> {
    const expired = await this.repo.findExpiredForDeletion(limit);
    let deleted = 0, failed = 0;
    for (const t of expired) {
      try { const r = await this.eraseOne({ tenantId: t.tenantId, branchId: t.branchId }, t.id, 'retention_expired', 'system'); if (r.deleted) deleted++; }
      catch { failed++; }
    }
    return { scanned: expired.length, deleted, failed };
  }

  // Shared idempotent erasure: tombstone locally, then delete provider-side (idempotent), then audit.
  private async eraseOne(scope: { tenantId: string; branchId: string | null }, id: string, reason: string, actor: string): Promise<{ deleted: boolean; providerDeleted: boolean }> {
    const t = await this.repo.tombstoneTranscript(scope, id, reason, actor);
    if (!t.acted) return { deleted: false, providerDeleted: false };
    let providerDeleted = false;
    if (t.provider && t.providerCallId) {
      try { providerDeleted = (await this.provider.deleteRecording(t.provider, t.providerCallId)).deleted; } catch { providerDeleted = false; }
    }
    await this.repo.recordDeletionEvent(scope, { transcriptId: id, provider: t.provider, providerCallId: t.providerCallId, reason, segmentsDeleted: t.segmentsDeleted, providerDeleted, actor });
    return { deleted: true, providerDeleted };
  }

  async getOverview(ctx: VoiceTranscriptionContext) {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    return this.repo.overview(ctx);
  }

  // Tenant transcription settings. Effective defaults are surfaced when no row is saved yet.
  private defaults(): VoiceSettings { return { transcriptionEnabled: true, retentionDays: this.retentionDays, retainRaw: this.retainRaw, consentAnnouncementVersion: null }; }
  async getSettings(ctx: VoiceTranscriptionContext) {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    return this.settingsView(ctx);
  }
  /** the saved policy + its version (0 = never saved; the defaults are shown) — no entitlement check (the center uses it) */
  async settingsView(ctx: VoiceTranscriptionContext) {
    const s = await this.repo.getSettings(ctx);
    const meta = this.repo.settingsMeta ? await this.repo.settingsMeta(ctx) : { version: 0, updatedAt: null, updatedBy: null };
    return { ...(s ?? this.defaults()), version: meta.version, updatedAt: meta.updatedAt, saved: !!s };
  }
  /** Voice Transcription Settings guide (Nov 2026): versioned (expectedVersion), sensitive changes need `confirm` (the 409
   *  carries the impact), and a retention change re-dates stored transcripts / raw OFF purges raw text — in one transaction. */
  async updateSettings(ctx: VoiceTranscriptionContext, patch: Partial<{ transcriptionEnabled: boolean; retentionDays: number; retainRaw: boolean; consentAnnouncementVersion: string | null }>, opts: { expectedVersion?: number | null; confirm?: boolean } = {}) {
    this.need(ctx, 'ai_voice_transcription.manage_settings');
    await this.assertEnabled(ctx);
    const cur = await this.repo.getSettings(ctx) ?? this.defaults();
    const days = patch.retentionDays ?? cur.retentionDays;
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new VoiceTranscriptionValidationError('retentionDays must be 1..3650');
    const version = patch.consentAnnouncementVersion !== undefined ? (patch.consentAnnouncementVersion ? String(patch.consentAnnouncementVersion).trim() || null : null) : cur.consentAnnouncementVersion;
    if (version != null && !/^[A-Za-z0-9._-]{1,64}$/.test(version)) throw withCode(new VoiceTranscriptionValidationError('consentAnnouncementVersion must be letters, digits, dot, dash or underscore'), 'VALIDATION_FAILED');
    const next: VoiceSettings = {
      transcriptionEnabled: patch.transcriptionEnabled ?? cur.transcriptionEnabled,
      retentionDays: days,
      retainRaw: patch.retainRaw ?? cur.retainRaw,
      consentAnnouncementVersion: version,
    };
    if (!this.repo.applySettings) return this.repo.saveSettings(ctx, next);
    const r = await this.repo.applySettings(ctx, next, { expectedVersion: opts.expectedVersion ?? null, confirm: opts.confirm === true, defaults: this.defaults() });
    return { ...r.settings, version: r.version, impact: r.impact, saved: true };
  }

  // Calls with open follow-up items — the staff worklist.
  async listUnresolved(ctx: VoiceTranscriptionContext, limit = 100) {
    this.need(ctx, 'ai_voice_transcription.view_transcripts');
    await this.assertEnabled(ctx);
    return this.repo.listUnresolved(ctx, limit);
  }

  // Super-Admin platform aggregate — cross-tenant COUNTS only (no transcript content). Auth is enforced by the
  // SuperAdminGuard on the controller.
  async getPlatformOverview() {
    return this.repo.platformAggregate();
  }

  async listTranscripts(ctx: VoiceTranscriptionContext, f: TranscriptFilters) {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    // §46: a cursor we cannot read is refused — restarting at the top would repeat rows in an appending list.
    if (f.cursor && !decodeCursor(f.cursor)) throw new VoiceTranscriptionValidationError('cursor is not valid — restart from the first page');
    return this.repo.listTranscripts(ctx, f);
  }

  // Tenant-scoped search over REDACTED text + summaries/intents only (raw is never indexed). Redacted snippets only.
  async search(ctx: VoiceTranscriptionContext, query: import('./ai-voice-transcription.repository').SearchQuery) {
    this.need(ctx, 'ai_voice_transcription.view_transcripts');
    await this.assertEnabled(ctx);
    return this.repo.searchTranscripts(ctx, query);
  }

  // Structured call intelligence (deterministic, computed at ingest) — summaries/intents/appointment/unresolved.
  async getIntelligence(ctx: VoiceTranscriptionContext, transcriptId: string) {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    const header = await this.repo.getTranscript(ctx, transcriptId);
    if (!header) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    return this.repo.getIntelligence(ctx, transcriptId);
  }

  // On-demand AI detailed summary over REDACTED text. Prompt carries only redacted lines + authorized catalog;
  // output is sanitized (no raw-data leakage) with a deterministic fallback, and gateway failure never throws.
  async generateDetailedSummary(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<{ summary: string; source: 'ai' | 'fallback' }> {
    this.need(ctx, 'ai_voice_transcription.view');
    await this.assertEnabled(ctx);
    const header = await this.repo.getTranscript(ctx, transcriptId);
    if (!header) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    const segments = await this.repo.getSegments(ctx, transcriptId); // redacted text
    const intel = await this.repo.getIntelligence(ctx, transcriptId);
    const deterministic = intel?.quickSummary || 'Call summary unavailable.';
    if (!this.ai || segments.length === 0) {
      await this.repo.setDetailedSummary(ctx, transcriptId, deterministic, 'fallback');
      return { summary: deterministic, source: 'fallback' };
    }
    const svcCatalog = this.catalog ? await this.catalog.serviceCatalog(ctx.tenantId, ctx.branchId).catch(() => []) : [];
    // The platform renders the registered voice.summarize prompt; buildSummaryPrompt still assembles the
    // redacted transcript text (its own PII rules) that we pass as the task's declared variable.
    const { prompt } = buildSummaryPrompt(segments, { serviceCatalog: svcCatalog });
    let text: string | null = null;
    try {
      const r = await this.ai.summarize({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, transcript: prompt });
      text = r ? [r.summary, r.followUp ? `Follow-up: ${r.followUp}` : null].filter(Boolean).join(' ') : null;
    } catch { text = null; }
    const res = finalizeSummary(text, deterministic);
    await this.repo.setDetailedSummary(ctx, transcriptId, res.summary, res.source);
    return res;
  }
  async getRawTranscript(ctx: VoiceTranscriptionContext, id: string): Promise<{ seq: number; speakerRole: string; rawText: string | null }[]> {
    this.need(ctx, 'ai_voice_transcription.view_raw');
    await this.assertEnabled(ctx);
    const header = await this.repo.getTranscript(ctx, id);
    if (!header) throw new VoiceTranscriptionValidationError('TRANSCRIPT_NOT_FOUND');
    if (!header.rawAvailable) throw new VoiceTranscriptionForbiddenError('RAW_NOT_AVAILABLE');
    // Voice Transcription Settings guide (Nov 2026): every raw-text view is logged BEFORE the text is returned; a failed log
    // refuses the view (it used to leave no trace at all)
    if (this.repo.recordRawAccess) await this.repo.recordRawAccess(ctx, id);
    return this.repo.getRawSegments(ctx, id);
  }
}
