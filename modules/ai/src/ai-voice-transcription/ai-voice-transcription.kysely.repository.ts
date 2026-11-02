// ai-voice-transcription.kysely.repository.ts — Postgres implementation of the repository port. Every statement is
// tenant-scoped by ctx.tenantId; transcript upsert is idempotent on (tenant, provider, provider_call_id). Segment
// writes are transactional replace (delete-then-insert) so a re-ingest yields a clean, ordered set.
import { escapeLike } from '@aipowersalon/database';   // Security Deep Scan D8: wildcard-escaped LIKE input
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { CALL_CONSENT, CALL_TRANSCRIPT, CALL_TRANSCRIPT_REDACTION } from '../ai-lifecycles';
import type {
  VoiceTranscriptionContext, ConsentRecord, TranscriptHeader, TranscriptSegment,
} from './ai-voice-transcription.dto';
import type { VoiceTranscriptionRepositoryPort, TranscriptFilters, CreateTranscriptInput, TranscriptIntelligence, DeletionScope, ExpiredTranscript, TombstoneResult, SearchQuery, SearchResultItem, TranscriptionOverview, PlatformTranscriptionAggregate, UnresolvedRow, VoiceSettings } from './ai-voice-transcription.repository';
import { parseTerms, snippet } from './ai-voice-transcription-search';
import { decodeCursor, encodeCursor } from '@aipowersalon/api-contracts';

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

function headerFrom(r: any): TranscriptHeader {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ?? null, provider: String(r.provider),
    providerCallId: String(r.provider_call_id), customerId: r.customer_id ?? null, direction: r.direction,
    handler: r.handler, status: r.status, primaryLanguage: r.primary_language ?? null,
    languageConfidence: r.language_confidence == null ? null : Number(r.language_confidence),
    mixedLanguage: !!r.mixed_language, redactionStatus: r.redaction_status, rawAvailable: !!r.raw_available,
    confidence: r.confidence == null ? null : Number(r.confidence),
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    segmentCount: Number(r.segment_count ?? 0), legalHold: !!r.legal_hold, retentionExpiresAt: iso(r.retention_expires_at),
    deletedAt: iso(r.deleted_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}

export class KyselyVoiceTranscriptionRepository implements VoiceTranscriptionRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async upsertConsent(ctx: VoiceTranscriptionContext, c: Omit<ConsentRecord, 'tenantId'>): Promise<ConsentRecord> {
    await sql`
      insert into call_consent_records (tenant_id, branch_id, provider, provider_call_id, consent_status, consent_method,
        recording_enabled, transcription_enabled, announcement_version, jurisdiction, initiated_by, consent_at)
      values (${ctx.tenantId}, ${c.branchId}, ${c.provider}, ${c.providerCallId}, ${c.consentStatus}, ${c.consentMethod},
        ${c.recordingEnabled}, ${c.transcriptionEnabled}, ${c.announcementVersion}, ${c.jurisdiction}, ${c.initiatedBy}, ${c.consentAt})
      on conflict (tenant_id, provider_call_id) do update set
        consent_status=excluded.consent_status, consent_method=excluded.consent_method,
        recording_enabled=excluded.recording_enabled, transcription_enabled=excluded.transcription_enabled,
        announcement_version=excluded.announcement_version, jurisdiction=excluded.jurisdiction,
        initiated_by=excluded.initiated_by, consent_at=excluded.consent_at, updated_at=now()
      where ${canMoveToSql(CALL_CONSENT, c.consentStatus, 'call_consent_records')}
    `.execute(this.db);
    return { ...c, tenantId: ctx.tenantId };
  }

  async getConsent(ctx: VoiceTranscriptionContext, providerCallId: string): Promise<ConsentRecord | null> {
    const r: any = await sql`select * from call_consent_records where tenant_id=${ctx.tenantId} and provider_call_id=${providerCallId} limit 1`.execute(this.db);
    const row = r.rows?.[0]; if (!row) return null;
    return {
      tenantId: String(row.tenant_id), branchId: row.branch_id ?? null, provider: String(row.provider),
      providerCallId: String(row.provider_call_id), consentStatus: row.consent_status, consentMethod: row.consent_method ?? null,
      recordingEnabled: !!row.recording_enabled, transcriptionEnabled: !!row.transcription_enabled,
      announcementVersion: row.announcement_version ?? null, jurisdiction: row.jurisdiction ?? null,
      initiatedBy: row.initiated_by ?? null, consentAt: iso(row.consent_at),
    };
  }

  async upsertTranscript(ctx: VoiceTranscriptionContext, input: CreateTranscriptInput): Promise<{ header: TranscriptHeader; created: boolean }> {
    const r: any = await sql`
      insert into call_transcripts (tenant_id, branch_id, provider, provider_call_id, customer_id, direction, handler,
        status, primary_language, language_confidence, mixed_language, redaction_status, confidence, duration_seconds,
        provider_transcript_ref, retention_expires_at)
      values (${ctx.tenantId}, ${ctx.branchId}, ${input.provider}, ${input.providerCallId}, ${input.customerId},
        ${input.direction}, ${input.handler}, ${input.status}, ${input.primaryLanguage}, ${input.languageConfidence},
        ${input.mixedLanguage}, ${input.redactionStatus}, ${input.confidence}, ${input.durationSeconds},
        ${input.providerTranscriptRef}, ${input.retentionExpiresAt})
      on conflict (tenant_id, provider, provider_call_id) do update set
        status=excluded.status, primary_language=excluded.primary_language, language_confidence=excluded.language_confidence,
        mixed_language=excluded.mixed_language, redaction_status=excluded.redaction_status, confidence=excluded.confidence,
        duration_seconds=excluded.duration_seconds, customer_id=excluded.customer_id, updated_at=now()
      where ${canMoveToSql(CALL_TRANSCRIPT, input.status, 'call_transcripts')} and ${canMoveToSql(CALL_TRANSCRIPT_REDACTION, input.redactionStatus, 'call_transcripts')}
      returning *, (xmax = 0) as _created
    `.execute(this.db);
    const row = r.rows[0];
    if (!row) {
      // Phase 12 (#27): the transcript exists in a FINAL state (deleted / retention-expired) — a replayed ingest never
      // revives it; the caller gets the row as it is and writes nothing more
      const cur: any = await sql`select id, tenant_id, branch_id, provider, provider_call_id, customer_id, direction, handler, status, primary_language, language_confidence, mixed_language, redaction_status, raw_available, confidence, duration_seconds, segment_count, legal_hold, retention_expires_at, deleted_at, created_at, updated_at
        from call_transcripts where tenant_id=${ctx.tenantId} and provider=${input.provider} and provider_call_id=${input.providerCallId} limit 1`.execute(this.db);
      return { header: headerFrom(cur.rows[0]), created: false };
    }
    return { header: headerFrom(row), created: row._created === true || row._created === 't' };
  }

  async replaceSegments(ctx: VoiceTranscriptionContext, transcriptId: string, segments: TranscriptSegment[], opts?: { rawTexts?: (string | null)[]; rawRetained?: boolean }): Promise<void> {
    const owns: any = await sql`select 1 from call_transcripts where id=${transcriptId} and tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    if (!owns.rows?.length) return;
    // Phase 14 (Constitution 12, webhook dedupe): a provider that re-delivers the same call while the first delivery is
    // still writing used to race "delete all, insert all" into the (transcript_id, seq) unique and fail. Upsert each
    // segment by its seq, then drop only the seqs this transcript no longer has — two concurrent replaces converge,
    // and a reader never sees the transcript emptied mid-replace.
    const seqs = segments.map((s) => Number(s.seq));
    await sql`delete from call_transcript_segments where transcript_id=${transcriptId} and tenant_id=${ctx.tenantId}
      and not (seq = any(${seqs}::int[]))`.execute(this.db);
    const raw = opts?.rawRetained ? (opts.rawTexts ?? []) : [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const rawText = opts?.rawRetained ? (raw[i] ?? null) : null;
      await sql`
        insert into call_transcript_segments (tenant_id, branch_id, transcript_id, seq, speaker_label, speaker_role,
          start_ms, end_ms, redacted_text, raw_text, language, confidence, is_final, redaction_applied, provider_segment_ref)
        values (${ctx.tenantId}, ${ctx.branchId}, ${transcriptId}, ${s.seq}, ${s.speakerLabel}, ${s.speakerRole},
          ${s.startMs}, ${s.endMs}, ${s.text}, ${rawText}, ${s.language}, ${s.confidence}, ${s.isFinal}, ${rawText != null}, ${s.providerSegmentRef})
        on conflict (transcript_id, seq) do update set
          speaker_label = excluded.speaker_label, speaker_role = excluded.speaker_role, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
          redacted_text = excluded.redacted_text, raw_text = excluded.raw_text, language = excluded.language, confidence = excluded.confidence,
          is_final = excluded.is_final, redaction_applied = excluded.redaction_applied, provider_segment_ref = excluded.provider_segment_ref
        where call_transcript_segments.tenant_id = excluded.tenant_id
      `.execute(this.db);
    }
    await sql`update call_transcripts set segment_count=${segments.length}, updated_at=now() where id=${transcriptId} and tenant_id=${ctx.tenantId}`.execute(this.db);
  }

  async setRedaction(ctx: VoiceTranscriptionContext, transcriptId: string, r: { status: string; categories: string[]; rawAvailable: boolean }): Promise<void> {
    await sql`
      update call_transcripts set redaction_status=${r.status}, redaction_categories=${JSON.stringify(r.categories)}::jsonb,
        raw_available=${r.rawAvailable}, updated_at=now()
      where id=${transcriptId} and tenant_id=${ctx.tenantId} and ${canMoveToSql(CALL_TRANSCRIPT_REDACTION, r.status)}`.execute(this.db);
  }
  async recordRedactionEvent(ctx: VoiceTranscriptionContext, transcriptId: string, categories: string[], segmentsRedacted: number, rawRetained: boolean): Promise<void> {
    await sql`
      insert into call_redaction_events (tenant_id, branch_id, transcript_id, categories, segments_redacted, raw_retained)
      values (${ctx.tenantId}, ${ctx.branchId}, ${transcriptId}, ${JSON.stringify(categories)}::jsonb, ${segmentsRedacted}, ${rawRetained})
    `.execute(this.db);
  }
  async getRawSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<{ seq: number; speakerRole: string; rawText: string | null }[]> {
    const owns: any = await sql`select 1 from call_transcripts where id=${transcriptId} and tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    if (!owns.rows?.length) return [];
    const r: any = await sql`select seq, speaker_role, raw_text from call_transcript_segments where transcript_id=${transcriptId} and tenant_id=${ctx.tenantId} order by seq asc`.execute(this.db);
    return (r.rows ?? []).map((s: any) => ({ seq: Number(s.seq), speakerRole: s.speaker_role, rawText: s.raw_text ?? null }));
  }

  async getTranscript(ctx: VoiceTranscriptionContext, id: string): Promise<TranscriptHeader | null> {
    const r: any = await sql`select * from call_transcripts where id=${id} and tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    return r.rows?.[0] ? headerFrom(r.rows[0]) : null;
  }

  async getSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptSegment[]> {
    const r: any = await sql`
      select * from call_transcript_segments where transcript_id=${transcriptId} and tenant_id=${ctx.tenantId} order by seq asc`.execute(this.db);
    return (r.rows ?? []).map((s: any): TranscriptSegment => ({
      seq: Number(s.seq), speakerLabel: s.speaker_label ?? null, speakerRole: s.speaker_role,
      startMs: s.start_ms == null ? null : Number(s.start_ms), endMs: s.end_ms == null ? null : Number(s.end_ms),
      text: String(s.redacted_text ?? ''), language: s.language ?? null,
      confidence: s.confidence == null ? null : Number(s.confidence), isFinal: !!s.is_final,
      providerSegmentRef: s.provider_segment_ref ?? null,
    }));
  }

  async upsertIntelligence(ctx: VoiceTranscriptionContext, i: TranscriptIntelligence): Promise<void> {
    const owns: any = await sql`select 1 from call_transcripts where id=${i.transcriptId} and tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    if (!owns.rows?.length) return;
    await sql`
      insert into call_transcript_intelligence (tenant_id, branch_id, transcript_id, provider_call_id, quick_summary,
        detailed_summary, detailed_source, intents, appointment, unresolved, sentiment, extraction_confidence)
      values (${ctx.tenantId}, ${ctx.branchId}, ${i.transcriptId}, ${i.providerCallId}, ${i.quickSummary},
        ${i.detailedSummary}, ${i.detailedSource}, ${JSON.stringify(i.intents)}::jsonb, ${JSON.stringify(i.appointment)}::jsonb,
        ${JSON.stringify(i.unresolved)}::jsonb, ${i.sentiment}, ${i.extractionConfidence})
      on conflict (transcript_id) do update set quick_summary=excluded.quick_summary, intents=excluded.intents,
        appointment=excluded.appointment, unresolved=excluded.unresolved, sentiment=excluded.sentiment,
        extraction_confidence=excluded.extraction_confidence, provider_call_id=excluded.provider_call_id, updated_at=now()
    `.execute(this.db);
  }
  async getIntelligence(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptIntelligence | null> {
    const r: any = await sql`select * from call_transcript_intelligence where transcript_id=${transcriptId} and tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    const row = r.rows?.[0]; if (!row) return null;
    const j = (v: any, d: any) => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return d; } } return v; };
    return {
      transcriptId, providerCallId: row.provider_call_id ?? null, quickSummary: String(row.quick_summary ?? ''),
      detailedSummary: row.detailed_summary ?? null, detailedSource: row.detailed_source ?? null,
      intents: j(row.intents, []), appointment: j(row.appointment, {}), unresolved: j(row.unresolved, []),
      sentiment: row.sentiment ?? null, extractionConfidence: row.extraction_confidence == null ? null : Number(row.extraction_confidence),
    };
  }
  async setDetailedSummary(ctx: VoiceTranscriptionContext, transcriptId: string, summary: string, source: 'ai' | 'fallback'): Promise<void> {
    await sql`update call_transcript_intelligence set detailed_summary=${summary}, detailed_source=${source}, updated_at=now() where transcript_id=${transcriptId} and tenant_id=${ctx.tenantId}`.execute(this.db);
  }

  async setLegalHold(ctx: VoiceTranscriptionContext, transcriptId: string, hold: boolean): Promise<boolean> {
    const r: any = await sql`update call_transcripts set legal_hold=${hold}, updated_at=now() where id=${transcriptId} and tenant_id=${ctx.tenantId} returning id`.execute(this.db);
    return !!r.rows?.length;
  }
  async findExpiredForDeletion(limit: number): Promise<ExpiredTranscript[]> {
    // Platform sweep: cross-tenant, but only expired, non-held, non-deleted rows. Per-item work is tenant-scoped.
    const r: any = await sql`
      select tenant_id, branch_id, id, provider, provider_call_id, segment_count from call_transcripts
      where deleted_at is null and legal_hold = false and retention_expires_at is not null and retention_expires_at <= now()
      order by retention_expires_at asc limit ${limit}`.execute(this.db);
    return (r.rows ?? []).map((t: any): ExpiredTranscript => ({ tenantId: String(t.tenant_id), branchId: t.branch_id ?? null, id: String(t.id), provider: String(t.provider), providerCallId: String(t.provider_call_id), segmentCount: Number(t.segment_count ?? 0) }));
  }
  async tombstoneTranscript(scope: DeletionScope, transcriptId: string, _reason: string, _actor: string): Promise<TombstoneResult> {
    const cur: any = await sql`select provider, provider_call_id, deleted_at, segment_count from call_transcripts where id=${transcriptId} and tenant_id=${scope.tenantId} limit 1`.execute(this.db);
    const row = cur.rows?.[0];
    if (!row || row.deleted_at) return { acted: false, segmentsDeleted: 0, provider: row?.provider ?? null, providerCallId: row?.provider_call_id ?? null };
    const segmentsDeleted = Number(row.segment_count ?? 0);
    await sql`delete from call_transcript_segments where transcript_id=${transcriptId} and tenant_id=${scope.tenantId}`.execute(this.db);
    await sql`delete from call_transcript_intelligence where transcript_id=${transcriptId} and tenant_id=${scope.tenantId}`.execute(this.db);
    await sql`update call_transcripts set status='deleted', deleted_at=now(), segment_count=0, raw_available=false, redaction_categories='[]'::jsonb, updated_at=now() where id=${transcriptId} and tenant_id=${scope.tenantId} and ${canMoveToSql(CALL_TRANSCRIPT, 'deleted')}`.execute(this.db);
    return { acted: true, segmentsDeleted, provider: String(row.provider), providerCallId: String(row.provider_call_id) };
  }
  async recordDeletionEvent(scope: DeletionScope, e: { transcriptId: string | null; provider: string | null; providerCallId: string | null; reason: string; segmentsDeleted: number; providerDeleted: boolean; actor: string }): Promise<void> {
    await sql`
      insert into call_deletion_events (tenant_id, branch_id, transcript_id, provider, provider_call_id, reason, segments_deleted, provider_deleted, actor)
      values (${scope.tenantId}, ${scope.branchId}, ${e.transcriptId}, ${e.provider}, ${e.providerCallId}, ${e.reason}, ${e.segmentsDeleted}, ${e.providerDeleted}, ${e.actor})
    `.execute(this.db);
  }

  async listUnresolved(ctx: VoiceTranscriptionContext, limit = 100): Promise<{ items: UnresolvedRow[] }> {
    const lim = Math.min(200, Math.max(1, limit));
    const r: any = await sql`
      select t.*, i.quick_summary _summary, i.unresolved _unresolved
      from call_transcript_intelligence i join call_transcripts t on t.id = i.transcript_id and t.tenant_id = i.tenant_id
      where i.tenant_id = ${ctx.tenantId} and t.deleted_at is null and jsonb_array_length(i.unresolved) > 0
      order by t.created_at desc limit ${lim}`.execute(this.db);
    const j = (v: any) => { if (v == null) return []; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } } return v; };
    const items: UnresolvedRow[] = (r.rows ?? []).map((row: any) => ({ header: headerFrom(row), quickSummary: String(row._summary ?? ''), unresolved: j(row._unresolved) }));
    const rank = (u: any[]) => Math.max(0, ...u.map((x) => (x.priority === 'high' ? 3 : x.priority === 'medium' ? 2 : 1)), 0);
    items.sort((a, b) => rank(b.unresolved) - rank(a.unresolved));
    return { items };
  }

  async getSettings(ctx: VoiceTranscriptionContext): Promise<VoiceSettings | null> {
    const r: any = await sql`select * from voice_transcription_settings where tenant_id=${ctx.tenantId} limit 1`.execute(this.db);
    const row = r.rows?.[0]; if (!row) return null;
    return { transcriptionEnabled: !!row.transcription_enabled, retentionDays: Number(row.retention_days), retainRaw: !!row.retain_raw, consentAnnouncementVersion: row.consent_announcement_version ?? null };
  }
  async saveSettings(ctx: VoiceTranscriptionContext, s: VoiceSettings): Promise<VoiceSettings> {
    await sql`
      insert into voice_transcription_settings (tenant_id, branch_id, transcription_enabled, retention_days, retain_raw, consent_announcement_version, updated_by)
      values (${ctx.tenantId}, ${ctx.branchId}, ${s.transcriptionEnabled}, ${s.retentionDays}, ${s.retainRaw}, ${s.consentAnnouncementVersion}, ${ctx.userId})
      on conflict (tenant_id) do update set transcription_enabled=excluded.transcription_enabled, retention_days=excluded.retention_days,
        retain_raw=excluded.retain_raw, consent_announcement_version=excluded.consent_announcement_version, updated_by=excluded.updated_by, updated_at=now()
    `.execute(this.db);
    return s;
  }

  async platformAggregate(): Promise<PlatformTranscriptionAggregate> {
    const a: any = await sql`
      select count(distinct tenant_id)::int tenants,
        count(*) filter (where deleted_at is null)::int total,
        count(*) filter (where deleted_at is not null)::int deleted,
        count(*) filter (where status='consent_declined')::int consent_declined,
        count(*) filter (where raw_available)::int raw_retained
      from call_transcripts`.execute(this.db);
    const st: any = await sql`select status, count(*)::int count from call_transcripts group by status`.execute(this.db);
    const pr: any = await sql`select provider, count(*)::int count from call_transcripts group by provider`.execute(this.db);
    const r = a.rows?.[0] ?? {};
    return {
      tenantsActive: Number(r.tenants) || 0, totalTranscripts: Number(r.total) || 0, deleted: Number(r.deleted) || 0,
      consentDeclined: Number(r.consent_declined) || 0, rawRetained: Number(r.raw_retained) || 0,
      byStatus: (st.rows ?? []).map((x: any) => ({ status: x.status, count: Number(x.count) })),
      byProvider: (pr.rows ?? []).map((x: any) => ({ provider: x.provider, count: Number(x.count) })),
    };
  }

  async overview(ctx: VoiceTranscriptionContext): Promise<TranscriptionOverview> {
    const agg: any = await sql`
      select count(*)::int total,
        count(*) filter (where status='completed')::int completed
      from call_transcripts where tenant_id=${ctx.tenantId} and deleted_at is null`.execute(this.db);
    const byStatus: any = await sql`select status, count(*)::int count from call_transcripts where tenant_id=${ctx.tenantId} and deleted_at is null group by status`.execute(this.db);
    const byLang: any = await sql`select primary_language language, count(*)::int count from call_transcripts where tenant_id=${ctx.tenantId} and deleted_at is null and primary_language is not null group by primary_language`.execute(this.db);
    const intel: any = await sql`
      select count(*) filter (where jsonb_array_length(unresolved) > 0)::int with_unresolved,
        count(*) filter (where (appointment->>'confidence')::float > 0)::int appts
      from call_transcript_intelligence where tenant_id=${ctx.tenantId}`.execute(this.db);
    const a = agg.rows?.[0] ?? {}; const i = intel.rows?.[0] ?? {};
    return {
      total: Number(a.total) || 0, completed: Number(a.completed) || 0,
      withUnresolved: Number(i.with_unresolved) || 0, appointmentsExtracted: Number(i.appts) || 0,
      byStatus: (byStatus.rows ?? []).map((r: any) => ({ status: r.status, count: Number(r.count) })),
      byLanguage: (byLang.rows ?? []).map((r: any) => ({ language: r.language, count: Number(r.count) })),
    };
  }

  async searchTranscripts(ctx: VoiceTranscriptionContext, query: SearchQuery): Promise<{ items: SearchResultItem[] }> {
    const terms = parseTerms(query.q ?? '');
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    // Structured filters. Keyword terms match ONLY redacted text / summary / intents — raw_text is never referenced.
    const conds: any[] = [sql`t.tenant_id = ${ctx.tenantId}`, sql`t.deleted_at is null`];
    if (query.branchId) conds.push(sql`t.branch_id = ${query.branchId}`);
    if (query.customerId) conds.push(sql`t.customer_id = ${query.customerId}`);
    if (query.direction) conds.push(sql`t.direction = ${query.direction}`);
    if (query.language) conds.push(sql`t.primary_language = ${query.language}`);
    if (query.status) conds.push(sql`t.status = ${query.status}`);
    if (query.dateFrom) conds.push(sql`t.created_at >= ${query.dateFrom}`);
    if (query.dateTo) conds.push(sql`t.created_at <= ${query.dateTo}`);
    if (query.intent) conds.push(sql`i.intents::text ilike ${'%' + escapeLike(String(query.intent)) + '%'}`);
    for (const term of terms) {
      const like = `%${escapeLike(term)}%`;
      conds.push(sql`(i.quick_summary ilike ${like} or i.intents::text ilike ${like}
        or exists (select 1 from call_transcript_segments s where s.transcript_id = t.id and s.tenant_id = t.tenant_id and s.redacted_text ilike ${like}))`);
    }
    const where = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} and ${c}`));
    const r: any = await sql`
      select t.*, i.quick_summary as _summary from call_transcripts t
      left join call_transcript_intelligence i on i.transcript_id = t.id and i.tenant_id = t.tenant_id
      where ${where} order by t.created_at desc limit ${limit}`.execute(this.db);

    const items: SearchResultItem[] = [];
    for (const row of (r.rows ?? [])) {
      const header = headerFrom(row);
      let snippetSource = row._summary ?? '';
      let matchedIn: string[] = ['summary'];
      if (terms.length) {
        // find a matching redacted segment for a snippet (bounded: one lookup per result, limit is small)
        const seg: any = await sql`
          select redacted_text from call_transcript_segments where transcript_id=${header.id} and tenant_id=${ctx.tenantId}
          and (${terms.map((t) => sql`redacted_text ilike ${'%' + t + '%'}`).reduce((a, c) => sql`${a} or ${c}`)}) limit 1`.execute(this.db);
        if (seg.rows?.[0]?.redacted_text) { snippetSource = seg.rows[0].redacted_text; matchedIn = ['transcript']; }
      }
      items.push({ header, snippet: snippet(snippetSource, terms), matchedIn });
    }
    return { items };
  }

  async listTranscripts(ctx: VoiceTranscriptionContext, f: TranscriptFilters): Promise<{ items: TranscriptHeader[]; nextCursor: string | null }> {
    const limit = Math.min(100, Math.max(1, f.limit ?? 50));
    let q = this.db.selectFrom('call_transcripts').selectAll().where('tenant_id', '=', ctx.tenantId).where('deleted_at', 'is', null);
    if (f.status) q = q.where('status', '=', f.status);
    if (f.branchId) q = q.where('branch_id', '=', f.branchId);
    if (f.customerId) q = q.where('customer_id', '=', f.customerId);
    if (f.direction) q = q.where('direction', '=', f.direction);
    // Constitution 5 §46: keyset on (created_at, id) — newest first, id breaks ties. The cursor carries created_at as
    // Postgres text (microseconds), not a JS Date (milliseconds), so two calls in the same millisecond are never skipped.
    const after = decodeCursor(f.cursor);
    if (after) q = q.where(sql<boolean>`(created_at, id) < (${String(after.sortValue)}::timestamptz, ${after.id}::uuid)`);
    const rows: any[] = await q.select(sql<string>`created_at::text`.as('cursor_ts')).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1).execute();
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page.map(headerFrom), nextCursor: rows.length > limit && last ? encodeCursor({ sortValue: last.cursor_ts, id: last.id }) : null };
  }
}
