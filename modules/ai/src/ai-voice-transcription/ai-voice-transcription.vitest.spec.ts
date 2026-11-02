// ai-voice-transcription.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { normalizeSegments, classifySpeaker, detectLanguage, transcriptionAuthorized, blockedStatusForConsent } from './ai-voice-transcription-normalize';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { MockTranscriptionProvider } from './ai-voice-transcription.provider';
import { VoiceTranscriptionDisabledError, VoiceTranscriptionForbiddenError, VoiceTranscriptionValidationError } from './ai-voice-transcription.dto';
import type { VoiceTranscriptionContext, RawTranscriptSegment, CallMeta } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];

describe('speaker classification (never "speaker 1 = customer")', () => {
  const meta: CallMeta = { direction: 'inbound', handler: 'ai', agentChannel: 0 };
  it('uses the agent channel hint to separate agent from caller', () => {
    expect(classifySpeaker({ channel: 0, text: 'hello' }, meta, null)).toBe('ai_receptionist');
    expect(classifySpeaker({ channel: 1, text: 'hi' }, meta, null)).toBe('customer');
  });
  it('uses role words in the label when no channel hint', () => {
    const m2: CallMeta = { direction: 'inbound', handler: 'human' };
    expect(classifySpeaker({ speakerLabel: 'Receptionist', text: 'x' }, m2, null)).toBe('human_receptionist');
    expect(classifySpeaker({ speakerLabel: 'Caller', text: 'x' }, m2, null)).toBe('customer');
  });
  it('does not fabricate a role when there is no signal', () => {
    expect(classifySpeaker({ text: 'x' }, { direction: 'inbound', handler: 'unknown' }, null)).toBe('unknown');
  });
});

describe('normalizeSegments', () => {
  it('orders by start time, drops empties, classifies roles by channel', () => {
    const raw: RawTranscriptSegment[] = [
      { channel: 1, startMs: 2000, text: 'I want a manicure' },
      { channel: 0, startMs: 0, text: 'Hello' },
      { channel: 0, startMs: 1000, text: '   ' },
    ];
    const segs = normalizeSegments(raw, { direction: 'inbound', handler: 'ai', agentChannel: 0 });
    expect(segs.map((s) => s.text)).toEqual(['Hello', 'I want a manicure']);
    expect(segs[0].speakerRole).toBe('ai_receptionist');
    expect(segs[1].speakerRole).toBe('customer');
    expect(segs.map((s) => s.seq)).toEqual([0, 1]);
  });
});

describe('detectLanguage', () => {
  it('weights by text length and flags mixed language', () => {
    const segs = normalizeSegments([
      { startMs: 0, text: 'Hello I would like to book an appointment please', language: 'en' },
      { startMs: 1, text: 'Hola quiero una cita por favor gracias amigo', language: 'es' },
    ], { direction: 'inbound', handler: 'ai' });
    const r = detectLanguage(segs);
    expect(['en', 'es']).toContain(r.primaryLanguage);
    expect(r.mixedLanguage).toBe(true);
  });
  it('returns null when no per-segment language', () => {
    expect(detectLanguage(normalizeSegments([{ text: 'hi' }], { direction: 'inbound', handler: 'ai' })).primaryLanguage).toBeNull();
  });
});

describe('consent gating (pure)', () => {
  it('authorizes only granted/not_required with transcription enabled', () => {
    expect(transcriptionAuthorized({ consentStatus: 'granted', transcriptionEnabled: true })).toBe(true);
    expect(transcriptionAuthorized({ consentStatus: 'not_required', transcriptionEnabled: true })).toBe(true);
    expect(transcriptionAuthorized({ consentStatus: 'declined', transcriptionEnabled: true })).toBe(false);
    expect(transcriptionAuthorized({ consentStatus: 'granted', transcriptionEnabled: false })).toBe(false);
  });
  it('maps blocked reasons to statuses', () => {
    expect(blockedStatusForConsent('granted', false)).toBe('transcription_disabled');
    expect(blockedStatusForConsent('declined', true)).toBe('consent_declined');
    expect(blockedStatusForConsent('unknown', true)).toBe('consent_missing');
    expect(blockedStatusForConsent('granted', true)).toBeNull();
  });
});

describe('VoiceTranscriptionService', () => {
  function mk(entitled = true) {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => entitled));
    return { repo, svc };
  }

  it('blocks a non-entitled tenant', async () => {
    const { svc } = mk(false);
    await expect(svc.listTranscripts(ctx(ALL), {})).rejects.toBeInstanceOf(VoiceTranscriptionDisabledError);
  });

  it('requires permission', async () => {
    const { svc } = mk();
    await expect(svc.listTranscripts(ctx([]), {})).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
  });

  it('without consent, stores a blocked header and NO segments', async () => {
    const { svc } = mk();
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'call1' });
    expect(h.status).toBe('transcription_disabled');
    const { segments } = await svc.getTranscript(ctx(ALL), h.id);
    expect(segments).toHaveLength(0);
  });

  it('with consent, transcribes and classifies speakers by channel', async () => {
    const { svc } = mk();
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'call2', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: 'US-NJ', initiatedBy: 'system', consentAt: new Date().toISOString() });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'call2' });
    expect(h.status).toBe('completed');
    expect(h.primaryLanguage).toBe('en');
    const { segments } = await svc.getTranscript(ctx(ALL), h.id);
    expect(segments.length).toBe(4);
    expect(segments[0].speakerRole).toBe('ai_receptionist');
    expect(segments[1].speakerRole).toBe('customer');
  });

  it('is idempotent per (tenant, provider, providerCallId)', async () => {
    const { svc, repo } = mk();
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c3', consentStatus: 'not_required', consentMethod: null, recordingEnabled: true, transcriptionEnabled: true, announcementVersion: null, jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const a = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c3' });
    const b = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c3' });
    expect(a.id).toBe(b.id);
    expect((await repo.listTranscripts(ctx(ALL), {})).items).toHaveLength(1);
  });

  it('is tenant-isolated: tenant B cannot read tenant A transcript', async () => {
    const { svc } = mk();
    await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: 'c4', consentStatus: 'granted', consentMethod: 'keypad', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: null, jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const h = await svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: 'c4' });
    await expect(svc.getTranscript(ctx(ALL, 'B'), h.id)).rejects.toBeInstanceOf(VoiceTranscriptionValidationError);
    expect((await svc.listTranscripts(ctx(ALL, 'B'), {})).items).toHaveLength(0);
  });
});

describe('transcript list paging (Constitution 5 §46 keyset)', () => {
  it('in-memory adapter: every row once, newest first, ties by id; an unreadable cursor is refused', async () => {
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true));
    const at = ['2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z', '2026-09-30T09:00:00.000Z', '2026-10-02T08:00:00.000Z'];
    at.forEach((createdAt, i) => (repo as any).transcripts.push({ id: `t${i}`, tenantId: 'A', createdAt, deletedAt: null, status: 'completed', direction: 'inbound' }));
    const seen: string[] = []; let cursor: string | undefined;
    do { const r = await svc.listTranscripts(ctx(ALL), { limit: 2, cursor }); seen.push(...r.items.map((t) => t.id)); cursor = r.nextCursor ?? undefined; } while (cursor && seen.length < 20);
    expect(seen).toEqual(['t4', 't2', 't1', 't0', 't3']);
    await expect(svc.listTranscripts(ctx(ALL), { cursor: 'junk' })).rejects.toBeInstanceOf(VoiceTranscriptionValidationError);
  });
});
