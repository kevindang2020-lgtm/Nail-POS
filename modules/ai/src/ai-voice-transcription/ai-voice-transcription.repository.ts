// ai-voice-transcription.repository.ts — persistence port + in-memory implementation. Every method is tenant-scoped
// (the ctx.tenantId is the only tenant a call can touch). Transcript upsert is idempotent on
// (tenant, provider, providerCallId) so a redelivered webhook/retry never duplicates a transcript.
import type {
  VoiceTranscriptionContext, ConsentRecord, TranscriptHeader, TranscriptSegment, TranscriptStatus, RedactionStatus,
} from './ai-voice-transcription.dto';
import { parseTerms, matchesAllTerms, snippet } from './ai-voice-transcription-search';
import { decodeCursor, encodeCursor } from '@aipowersalon/api-contracts';

export interface TranscriptFilters {
  status?: TranscriptStatus;
  branchId?: string;
  customerId?: string;
  direction?: 'inbound' | 'outbound';
  limit?: number;
  cursor?: string | null;
}

export interface CreateTranscriptInput {
  provider: string;
  providerCallId: string;
  customerId: string | null;
  direction: 'inbound' | 'outbound';
  handler: 'ai' | 'human' | 'voicemail' | 'unknown';
  status: TranscriptStatus;
  primaryLanguage: string | null;
  languageConfidence: number | null;
  mixedLanguage: boolean;
  redactionStatus: RedactionStatus;
  confidence: number | null;
  durationSeconds: number | null;
  providerTranscriptRef: string | null;
  retentionExpiresAt: string | null;
}

export interface TranscriptIntelligence {
  transcriptId: string;
  providerCallId: string | null;
  quickSummary: string;
  detailedSummary: string | null;
  detailedSource: 'ai' | 'fallback' | null;
  intents: any[];
  appointment: any;
  unresolved: any[];
  sentiment: string | null;
  extractionConfidence: number | null;
}

export interface SearchQuery {
  q?: string; intent?: string; customerId?: string; branchId?: string; direction?: 'inbound' | 'outbound';
  language?: string; status?: string; dateFrom?: string; dateTo?: string; limit?: number;
}
export interface SearchResultItem { header: TranscriptHeader; snippet: string; matchedIn: string[]; }

export interface DeletionScope { tenantId: string; branchId: string | null; }
export interface ExpiredTranscript { tenantId: string; branchId: string | null; id: string; provider: string; providerCallId: string; segmentCount: number; }
export interface TombstoneResult { acted: boolean; segmentsDeleted: number; provider: string | null; providerCallId: string | null; }

export interface TranscriptionOverview {
  total: number;
  completed: number;
  withUnresolved: number;
  appointmentsExtracted: number;
  byStatus: { status: string; count: number }[];
  byLanguage: { language: string; count: number }[];
}

export interface PlatformTranscriptionAggregate {
  tenantsActive: number;
  totalTranscripts: number;
  deleted: number;
  consentDeclined: number;
  rawRetained: number;
  byStatus: { status: string; count: number }[];
  byProvider: { provider: string; count: number }[];
}

export interface UnresolvedRow { header: TranscriptHeader; quickSummary: string; unresolved: any[]; }

export interface VoiceSettings { transcriptionEnabled: boolean; retentionDays: number; retainRaw: boolean; consentAnnouncementVersion: string | null; }

export interface VoiceTranscriptionRepositoryPort {
  overview(ctx: VoiceTranscriptionContext): Promise<TranscriptionOverview>;
  getSettings(ctx: VoiceTranscriptionContext): Promise<VoiceSettings | null>;
  saveSettings(ctx: VoiceTranscriptionContext, s: VoiceSettings): Promise<VoiceSettings>;
  // Transcripts with open follow-up items (from intelligence). Tenant-scoped; excludes deleted.
  listUnresolved(ctx: VoiceTranscriptionContext, limit?: number): Promise<{ items: UnresolvedRow[] }>;
  // Super-Admin: cross-tenant COUNTS only — never transcript content or tenant identifiers beyond an active count.
  platformAggregate(): Promise<PlatformTranscriptionAggregate>;
  upsertConsent(ctx: VoiceTranscriptionContext, c: Omit<ConsentRecord, 'tenantId'>): Promise<ConsentRecord>;
  getConsent(ctx: VoiceTranscriptionContext, providerCallId: string): Promise<ConsentRecord | null>;
  // Idempotent on (tenant, provider, providerCallId). Returns the header + whether it was created.
  upsertTranscript(ctx: VoiceTranscriptionContext, input: CreateTranscriptInput): Promise<{ header: TranscriptHeader; created: boolean }>;
  replaceSegments(ctx: VoiceTranscriptionContext, transcriptId: string, segments: TranscriptSegment[], opts?: { rawTexts?: (string | null)[]; rawRetained?: boolean }): Promise<void>;
  setRedaction(ctx: VoiceTranscriptionContext, transcriptId: string, r: { status: RedactionStatus; categories: string[]; rawAvailable: boolean }): Promise<void>;
  recordRedactionEvent(ctx: VoiceTranscriptionContext, transcriptId: string, categories: string[], segmentsRedacted: number, rawRetained: boolean): Promise<void>;
  getRawSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<{ seq: number; speakerRole: string; rawText: string | null }[]>;
  getTranscript(ctx: VoiceTranscriptionContext, id: string): Promise<TranscriptHeader | null>;
  getSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptSegment[]>;
  listTranscripts(ctx: VoiceTranscriptionContext, f: TranscriptFilters): Promise<{ items: TranscriptHeader[]; nextCursor: string | null }>;
  upsertIntelligence(ctx: VoiceTranscriptionContext, i: TranscriptIntelligence): Promise<void>;
  getIntelligence(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptIntelligence | null>;
  setDetailedSummary(ctx: VoiceTranscriptionContext, transcriptId: string, summary: string, source: 'ai' | 'fallback'): Promise<void>;
  setLegalHold(ctx: VoiceTranscriptionContext, transcriptId: string, hold: boolean): Promise<boolean>;
  findExpiredForDeletion(limit: number): Promise<ExpiredTranscript[]>;
  // Idempotent: removes segments + intelligence, tombstones the header. Returns acted=false if already deleted.
  tombstoneTranscript(scope: DeletionScope, transcriptId: string, reason: string, actor: string): Promise<TombstoneResult>;
  recordDeletionEvent(scope: DeletionScope, e: { transcriptId: string | null; provider: string | null; providerCallId: string | null; reason: string; segmentsDeleted: number; providerDeleted: boolean; actor: string }): Promise<void>;
  // Search over REDACTED text + summaries/intents only — never raw_text. Tenant-scoped; excludes deleted.
  searchTranscripts(ctx: VoiceTranscriptionContext, query: SearchQuery): Promise<{ items: SearchResultItem[] }>;
}

const now = () => new Date().toISOString();

export class InMemoryVoiceTranscriptionRepository implements VoiceTranscriptionRepositoryPort {
  private consents: (ConsentRecord & { id: string })[] = [];
  private transcripts: TranscriptHeader[] = [];
  private segments = new Map<string, TranscriptSegment[]>(); // transcriptId -> segments
  private rawByTranscript = new Map<string, (string | null)[]>();
  private redactionEvents: { tenantId: string; transcriptId: string; categories: string[]; segmentsRedacted: number; rawRetained: boolean }[] = [];
  private intelligence = new Map<string, TranscriptIntelligence & { tenantId: string }>();
  private deletionEvents: any[] = [];
  private settings = new Map<string, VoiceSettings>();

  async getSettings(ctx: VoiceTranscriptionContext): Promise<VoiceSettings | null> {
    return this.settings.get(ctx.tenantId) ?? null;
  }
  async saveSettings(ctx: VoiceTranscriptionContext, s: VoiceSettings): Promise<VoiceSettings> {
    this.settings.set(ctx.tenantId, { ...s }); return { ...s };
  }

  async upsertConsent(ctx: VoiceTranscriptionContext, c: Omit<ConsentRecord, 'tenantId'>): Promise<ConsentRecord> {
    const rec: ConsentRecord = { ...c, tenantId: ctx.tenantId };
    const idx = this.consents.findIndex((x) => x.tenantId === ctx.tenantId && x.providerCallId === c.providerCallId);
    if (idx >= 0) { this.consents[idx] = { ...this.consents[idx], ...rec }; return this.consents[idx]; }
    this.consents.push({ ...rec, id: `con_${this.consents.length + 1}` });
    return rec;
  }
  async getConsent(ctx: VoiceTranscriptionContext, providerCallId: string): Promise<ConsentRecord | null> {
    return this.consents.find((x) => x.tenantId === ctx.tenantId && x.providerCallId === providerCallId) ?? null;
  }

  async upsertTranscript(ctx: VoiceTranscriptionContext, input: CreateTranscriptInput): Promise<{ header: TranscriptHeader; created: boolean }> {
    const existing = this.transcripts.find((t) => t.tenantId === ctx.tenantId && t.provider === input.provider && t.providerCallId === input.providerCallId);
    if (existing) {
      Object.assign(existing, {
        status: input.status, primaryLanguage: input.primaryLanguage, languageConfidence: input.languageConfidence,
        mixedLanguage: input.mixedLanguage, redactionStatus: input.redactionStatus, confidence: input.confidence,
        durationSeconds: input.durationSeconds, customerId: input.customerId, updatedAt: now(),
      });
      return { header: existing, created: false };
    }
    const header: TranscriptHeader = {
      id: `tr_${this.transcripts.length + 1}`, tenantId: ctx.tenantId, branchId: ctx.branchId,
      provider: input.provider, providerCallId: input.providerCallId, customerId: input.customerId,
      direction: input.direction, handler: input.handler, status: input.status,
      primaryLanguage: input.primaryLanguage, languageConfidence: input.languageConfidence, mixedLanguage: input.mixedLanguage,
      redactionStatus: input.redactionStatus, rawAvailable: false, confidence: input.confidence,
      durationSeconds: input.durationSeconds, segmentCount: 0, legalHold: false,
      retentionExpiresAt: input.retentionExpiresAt, deletedAt: null, createdAt: now(), updatedAt: now(),
    };
    this.transcripts.push(header);
    return { header, created: true };
  }

  async replaceSegments(ctx: VoiceTranscriptionContext, transcriptId: string, segments: TranscriptSegment[], opts?: { rawTexts?: (string | null)[]; rawRetained?: boolean }): Promise<void> {
    const t = this.transcripts.find((x) => x.id === transcriptId && x.tenantId === ctx.tenantId);
    if (!t) return; // tenant-scoped: never write segments for another tenant's transcript
    this.segments.set(transcriptId, segments.slice());
    if (opts?.rawRetained && opts.rawTexts) this.rawByTranscript.set(transcriptId, opts.rawTexts.slice());
    else this.rawByTranscript.delete(transcriptId);
    t.segmentCount = segments.length; t.updatedAt = now();
  }
  async setRedaction(ctx: VoiceTranscriptionContext, transcriptId: string, r: { status: RedactionStatus; categories: string[]; rawAvailable: boolean }): Promise<void> {
    const t = this.transcripts.find((x) => x.id === transcriptId && x.tenantId === ctx.tenantId);
    if (!t) return;
    t.redactionStatus = r.status; t.rawAvailable = r.rawAvailable; (t as any).redactionCategories = r.categories; t.updatedAt = now();
  }
  async recordRedactionEvent(ctx: VoiceTranscriptionContext, transcriptId: string, categories: string[], segmentsRedacted: number, rawRetained: boolean): Promise<void> {
    this.redactionEvents.push({ tenantId: ctx.tenantId, transcriptId, categories, segmentsRedacted, rawRetained });
  }
  async getRawSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<{ seq: number; speakerRole: string; rawText: string | null }[]> {
    const t = this.transcripts.find((x) => x.id === transcriptId && x.tenantId === ctx.tenantId);
    if (!t) return [];
    const segs = this.segments.get(transcriptId) ?? [];
    const raw = this.rawByTranscript.get(transcriptId) ?? [];
    return segs.map((s, i) => ({ seq: s.seq, speakerRole: s.speakerRole, rawText: raw[i] ?? null }));
  }
  async getTranscript(ctx: VoiceTranscriptionContext, id: string): Promise<TranscriptHeader | null> {
    return this.transcripts.find((t) => t.id === id && t.tenantId === ctx.tenantId) ?? null;
  }
  async getSegments(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptSegment[]> {
    const t = await this.getTranscript(ctx, transcriptId);
    if (!t) return [];
    return (this.segments.get(transcriptId) ?? []).slice();
  }
  async upsertIntelligence(ctx: VoiceTranscriptionContext, i: TranscriptIntelligence): Promise<void> {
    const t = this.transcripts.find((x) => x.id === i.transcriptId && x.tenantId === ctx.tenantId);
    if (!t) return;
    this.intelligence.set(`${ctx.tenantId}:${i.transcriptId}`, { ...i, tenantId: ctx.tenantId });
  }
  async getIntelligence(ctx: VoiceTranscriptionContext, transcriptId: string): Promise<TranscriptIntelligence | null> {
    return this.intelligence.get(`${ctx.tenantId}:${transcriptId}`) ?? null;
  }
  async setDetailedSummary(ctx: VoiceTranscriptionContext, transcriptId: string, summary: string, source: 'ai' | 'fallback'): Promise<void> {
    const rec = this.intelligence.get(`${ctx.tenantId}:${transcriptId}`);
    if (rec) { rec.detailedSummary = summary; rec.detailedSource = source; }
  }

  async setLegalHold(ctx: VoiceTranscriptionContext, transcriptId: string, hold: boolean): Promise<boolean> {
    const t = this.transcripts.find((x) => x.id === transcriptId && x.tenantId === ctx.tenantId);
    if (!t) return false;
    t.legalHold = hold; t.updatedAt = now(); return true;
  }
  async findExpiredForDeletion(limit: number): Promise<ExpiredTranscript[]> {
    const nowMs = Date.now();
    return this.transcripts
      .filter((t) => !t.deletedAt && !t.legalHold && t.retentionExpiresAt && new Date(t.retentionExpiresAt).getTime() <= nowMs)
      .slice(0, limit)
      .map((t) => ({ tenantId: t.tenantId, branchId: t.branchId, id: t.id, provider: t.provider, providerCallId: t.providerCallId, segmentCount: t.segmentCount }));
  }
  async tombstoneTranscript(scope: DeletionScope, transcriptId: string, _reason: string, _actor: string): Promise<TombstoneResult> {
    const t = this.transcripts.find((x) => x.id === transcriptId && x.tenantId === scope.tenantId);
    if (!t || t.deletedAt) return { acted: false, segmentsDeleted: 0, provider: t?.provider ?? null, providerCallId: t?.providerCallId ?? null };
    const segs = this.segments.get(transcriptId) ?? [];
    const segmentsDeleted = segs.length;
    this.segments.delete(transcriptId); this.rawByTranscript.delete(transcriptId);
    this.intelligence.delete(`${scope.tenantId}:${transcriptId}`);
    t.status = 'deleted'; t.deletedAt = now(); t.segmentCount = 0; t.rawAvailable = false; t.updatedAt = now();
    return { acted: true, segmentsDeleted, provider: t.provider, providerCallId: t.providerCallId };
  }
  async recordDeletionEvent(scope: DeletionScope, e: { transcriptId: string | null; provider: string | null; providerCallId: string | null; reason: string; segmentsDeleted: number; providerDeleted: boolean; actor: string }): Promise<void> {
    this.deletionEvents.push({ tenantId: scope.tenantId, ...e });
  }

  async listUnresolved(ctx: VoiceTranscriptionContext, limit = 100): Promise<{ items: UnresolvedRow[] }> {
    const rows: UnresolvedRow[] = [];
    for (const t of this.transcripts) {
      if (t.tenantId !== ctx.tenantId || t.deletedAt) continue;
      const intel = this.intelligence.get(`${ctx.tenantId}:${t.id}`);
      if (intel && (intel.unresolved?.length ?? 0) > 0) rows.push({ header: t, quickSummary: intel.quickSummary, unresolved: intel.unresolved });
    }
    const rank = (u: any[]) => Math.max(0, ...u.map((x) => (x.priority === 'high' ? 3 : x.priority === 'medium' ? 2 : 1)));
    rows.sort((a, b) => rank(b.unresolved) - rank(a.unresolved) || b.header.createdAt.localeCompare(a.header.createdAt));
    return { items: rows.slice(0, Math.min(200, Math.max(1, limit))) };
  }

  async platformAggregate(): Promise<PlatformTranscriptionAggregate> {
    const all = this.transcripts;
    const byStatus = new Map<string, number>(); const byProvider = new Map<string, number>();
    for (const t of all) { byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1); byProvider.set(t.provider, (byProvider.get(t.provider) ?? 0) + 1); }
    return {
      tenantsActive: new Set(all.map((t) => t.tenantId)).size,
      totalTranscripts: all.filter((t) => !t.deletedAt).length,
      deleted: all.filter((t) => t.deletedAt).length,
      consentDeclined: all.filter((t) => t.status === 'consent_declined').length,
      rawRetained: all.filter((t) => t.rawAvailable).length,
      byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
      byProvider: [...byProvider.entries()].map(([provider, count]) => ({ provider, count })),
    };
  }

  async overview(ctx: VoiceTranscriptionContext): Promise<TranscriptionOverview> {
    const live = this.transcripts.filter((t) => t.tenantId === ctx.tenantId && !t.deletedAt);
    const byStatusMap = new Map<string, number>(); const byLangMap = new Map<string, number>();
    for (const t of live) {
      byStatusMap.set(t.status, (byStatusMap.get(t.status) ?? 0) + 1);
      if (t.primaryLanguage) byLangMap.set(t.primaryLanguage, (byLangMap.get(t.primaryLanguage) ?? 0) + 1);
    }
    let withUnresolved = 0, appointmentsExtracted = 0;
    for (const t of live) {
      const intel = this.intelligence.get(`${ctx.tenantId}:${t.id}`);
      if (intel && (intel.unresolved?.length ?? 0) > 0) withUnresolved++;
      if (intel && ((intel.appointment?.requestedServices?.length ?? 0) > 0 || (intel.appointment?.confidence ?? 0) > 0)) appointmentsExtracted++;
    }
    return {
      total: live.length, completed: live.filter((t) => t.status === 'completed').length, withUnresolved, appointmentsExtracted,
      byStatus: [...byStatusMap.entries()].map(([status, count]) => ({ status, count })),
      byLanguage: [...byLangMap.entries()].map(([language, count]) => ({ language, count })),
    };
  }

  async searchTranscripts(ctx: VoiceTranscriptionContext, query: SearchQuery): Promise<{ items: SearchResultItem[] }> {
    const terms = parseTerms(query.q ?? '');
    let items = this.transcripts.filter((t) => t.tenantId === ctx.tenantId && !t.deletedAt);
    if (query.branchId) items = items.filter((t) => t.branchId === query.branchId);
    if (query.customerId) items = items.filter((t) => t.customerId === query.customerId);
    if (query.direction) items = items.filter((t) => t.direction === query.direction);
    if (query.language) items = items.filter((t) => t.primaryLanguage === query.language);
    if (query.status) items = items.filter((t) => t.status === query.status);
    if (query.dateFrom) items = items.filter((t) => t.createdAt >= query.dateFrom!);
    if (query.dateTo) items = items.filter((t) => t.createdAt <= query.dateTo!);

    const results: SearchResultItem[] = [];
    for (const t of items) {
      const intel = this.intelligence.get(`${ctx.tenantId}:${t.id}`);
      if (query.intent && !(intel?.intents ?? []).some((i: any) => i.intent === query.intent)) continue;
      const segs = this.segments.get(t.id) ?? [];
      const matchedIn: string[] = [];
      const summaryText = intel?.quickSummary ?? '';
      const intentsText = (intel?.intents ?? []).map((i: any) => i.intent).join(' ');
      const segText = segs.map((s) => s.text).join(' \n '); // redacted text only
      if (terms.length) {
        if (matchesAllTerms(summaryText, terms)) matchedIn.push('summary');
        if (matchesAllTerms(intentsText, terms)) matchedIn.push('intent');
        if (matchesAllTerms(segText, terms)) matchedIn.push('transcript');
        if (matchedIn.length === 0) continue;
      }
      const snippetSource = matchedIn.includes('transcript') ? (segs.find((s) => matchesAllTerms(s.text, terms))?.text ?? segText) : summaryText;
      results.push({ header: t, snippet: snippet(snippetSource, terms), matchedIn: matchedIn.length ? matchedIn : ['summary'] });
    }
    return { items: results.sort((a, b) => b.header.createdAt.localeCompare(a.header.createdAt)).slice(0, Math.min(100, Math.max(1, query.limit ?? 50))) };
  }

  async listTranscripts(ctx: VoiceTranscriptionContext, f: TranscriptFilters): Promise<{ items: TranscriptHeader[]; nextCursor: string | null }> {
    let items = this.transcripts.filter((t) => t.tenantId === ctx.tenantId && !t.deletedAt);
    if (f.status) items = items.filter((t) => t.status === f.status);
    if (f.branchId) items = items.filter((t) => t.branchId === f.branchId);
    if (f.customerId) items = items.filter((t) => t.customerId === f.customerId);
    if (f.direction) items = items.filter((t) => t.direction === f.direction);
    const limit = Math.min(100, Math.max(1, f.limit ?? 50));
    const desc = (a: TranscriptHeader, b: TranscriptHeader) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    items = items.sort(desc);
    const after = decodeCursor(f.cursor);
    if (after) items = items.filter((t) => desc({ createdAt: String(after.sortValue), id: after.id } as TranscriptHeader, t) < 0);
    const page = items.slice(0, limit); const last = page[page.length - 1];
    return { items: page, nextCursor: items.length > limit && last ? encodeCursor({ sortValue: last.createdAt, id: last.id }) : null };
  }
}
