// ai-voice-transcription-pgtest.vitest.spec.ts — exercises the REAL Kysely repository against PGlite (PG15):
// consent upsert, idempotent transcript upsert, segment replace, tenant-scoped list, and tenant isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyVoiceTranscriptionRepository } from './ai-voice-transcription.kysely.repository';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { MockTranscriptionProvider } from './ai-voice-transcription.provider';
import type { VoiceTranscriptionContext } from './ai-voice-transcription.dto';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[] }; }, async *streamQuery() {} };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

let pg: PGlite; let db: Kysely<any>;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const BR = 'b0000000-0000-0000-0000-0000000000b1';
const ctx = (tenantId: string, perms: string[] = []): VoiceTranscriptionContext => ({ tenantId, branchId: BR, userId: '99999999-9999-9999-9999-999999999999', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings'];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/326_call_transcription_core.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/327_call_transcription_redaction.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/328_call_transcription_intelligence.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/329_call_transcription_deletion.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/330_call_transcription_settings.sql`, 'utf8'));
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('KyselyVoiceTranscriptionRepository (real SQL, PGlite)', () => {
  it('records consent, ingests, replaces segments, and is idempotent + tenant-isolated', async () => {
    const repo = new KyselyVoiceTranscriptionRepository(db);
    const svc = new VoiceTranscriptionService(repo, new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true));

    // no consent → blocked header, no segments
    const blocked = await svc.ingest(ctx(A, ALL), { provider: 'retell', providerCallId: 'call1' });
    expect(blocked.status).toBe('transcription_disabled');
    expect((await svc.getTranscript(ctx(A, ALL), blocked.id)).segments).toHaveLength(0);

    // consent granted → full transcript with classified speakers
    await svc.recordConsent(ctx(A, ALL), { branchId: BR, provider: 'retell', providerCallId: 'call2', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: 'US-NJ', initiatedBy: 'system', consentAt: new Date().toISOString() });
    const h = await svc.ingest(ctx(A, ALL), { provider: 'retell', providerCallId: 'call2' });
    expect(h.status).toBe('completed');
    expect(h.primaryLanguage).toBe('en');
    expect(h.segmentCount).toBe(4);
    const { segments } = await svc.getTranscript(ctx(A, ALL), h.id);
    expect(segments[0].speakerRole).toBe('ai_receptionist');
    expect(segments[1].speakerRole).toBe('customer');

    // idempotent: re-ingest same call → same transcript id, still 4 segments (replace, not append)
    const h2 = await svc.ingest(ctx(A, ALL), { provider: 'retell', providerCallId: 'call2' });
    expect(h2.id).toBe(h.id);
    expect((await svc.getTranscript(ctx(A, ALL), h.id)).segments).toHaveLength(4);

    // list tenant-scoped
    const listA = await svc.listTranscripts(ctx(A, ALL), {});
    expect(listA.items.length).toBeGreaterThanOrEqual(2);
    expect(listA.items.every((t) => t.tenantId === A)).toBe(true);

    // tenant B sees nothing of A's, and cannot read A's transcript by id
    expect((await svc.listTranscripts(ctx(B, ALL), {})).items).toHaveLength(0);
    await expect(svc.getTranscript(ctx(B, ALL), h.id)).rejects.toThrow();
  });

  // Constitution 5 §46: the transcript list pages by keyset (created_at, id). Rows share a timestamp to the microsecond,
  // and two differ only below the millisecond — a JS-Date cursor would skip or repeat those.
  it('pages transcripts with a keyset cursor: every row once, newest first, ties by id, sub-millisecond safe', async () => {
    const C = '33333333-3333-3333-3333-333333333333';
    const ts = ['2026-10-01 10:00:00.000300+00', '2026-10-01 10:00:00.000300+00', '2026-10-01 10:00:00.000300+00',
      '2026-10-01 10:00:00.000100+00', '2026-10-01 10:00:00.000900+00', '2026-09-30 09:00:00+00', '2026-10-02 08:00:00+00'];
    for (let i = 0; i < ts.length; i++)
      await pg.query(`insert into call_transcripts (tenant_id, provider_call_id, created_at) values ($1, $2, $3)`, [C, `kc${i}`, ts[i]]);
    const expected = (await pg.query(`select id from call_transcripts where tenant_id = $1 order by created_at desc, id desc`, [C])).rows.map((r: any) => r.id);
    const svc = new VoiceTranscriptionService(new KyselyVoiceTranscriptionRepository(db), new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true));
    const seen: string[] = []; let cursor: string | undefined; let pages = 0;
    do {
      const r = await svc.listTranscripts(ctx(C, ALL), { limit: 2, cursor });
      seen.push(...r.items.map((t) => t.id)); cursor = r.nextCursor ?? undefined; pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(expected);
    expect(pages).toBe(4);
    await expect(svc.listTranscripts(ctx(C, ALL), { limit: 2, cursor: 'not-a-cursor' })).rejects.toThrow(/cursor is not valid/);
  });

  it('consent upsert is idempotent per (tenant, provider_call_id)', async () => {
    const repo = new KyselyVoiceTranscriptionRepository(db);
    const svc = new VoiceTranscriptionService(repo, new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true));
    await svc.recordConsent(ctx(A, ALL), { branchId: BR, provider: 'retell', providerCallId: 'callc', consentStatus: 'unknown', consentMethod: null, recordingEnabled: false, transcriptionEnabled: false, announcementVersion: null, jurisdiction: null, initiatedBy: 'system', consentAt: null });
    await svc.recordConsent(ctx(A, ALL), { branchId: BR, provider: 'retell', providerCallId: 'callc', consentStatus: 'granted', consentMethod: 'keypad', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: null, jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const c = await repo.getConsent(ctx(A), 'callc');
    expect(c?.consentStatus).toBe('granted');
    expect(c?.transcriptionEnabled).toBe(true);
  });

  it('erasure tombstones over real SQL, removes segments/intelligence, and is idempotent', async () => {
    const repo = new KyselyVoiceTranscriptionRepository(db);
    const del: string[] = [];
    const provider = { name: 'x', async fetchTranscript() { return { segments: [{ channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text: 'book a manicure', language: 'en', confidence: 0.95, isFinal: true }], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording(_p: string, id: string) { del.push(id); return { deleted: true }; }, async healthy() { return true; } };
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    await svc.recordConsent(ctx(A, ALL), { branchId: BR, provider: 'retell', providerCallId: 'delcall', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    const h = await svc.ingest(ctx(A, ['ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings']), { provider: 'retell', providerCallId: 'delcall' });
    const r1 = await svc.deleteTranscript(ctx(A, ['ai_voice_transcription.view', 'ai_voice_transcription.delete']), h.id, 'tenant_request');
    expect(r1.deleted).toBe(true);
    expect(del).toContain('delcall');
    const after = await svc.getTranscript(ctx(A, ['ai_voice_transcription.view']), h.id);
    expect(after.header.status).toBe('deleted');
    expect(after.segments).toHaveLength(0);
    // idempotent
    expect((await svc.deleteTranscript(ctx(A, ['ai_voice_transcription.view', 'ai_voice_transcription.delete']), h.id)).deleted).toBe(false);
  });

  it('search over real SQL matches redacted text + intents, tenant-scoped, and never the redacted digits', async () => {
    const repo = new KyselyVoiceTranscriptionRepository(db);
    const provider = { name: 'x', async fetchTranscript() { return { segments: [
      { channel: 0, speakerLabel: 'agent', startMs: 0, endMs: 1, text: 'Thanks for calling', language: 'en', confidence: 0.96, isFinal: true },
      { channel: 1, speakerLabel: 'caller', startMs: 2, endMs: 3, text: 'I want to book a gel manicure, my card is 4111 1111 1111 1111', language: 'en', confidence: 0.95, isFinal: true },
    ], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    await svc.recordConsent(ctx(A, ALL), { branchId: BR, provider: 'retell', providerCallId: 'searchcall', consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
    await svc.ingest(ctx(A, ['ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings']), { provider: 'retell', providerCallId: 'searchcall' });
    const sv = ctx(A, ['ai_voice_transcription.view_transcripts']);
    expect((await svc.search(sv, { q: 'manicure' })).items.length).toBeGreaterThanOrEqual(1);
    expect((await svc.search(sv, { intent: 'new_booking' })).items.length).toBeGreaterThanOrEqual(1);
    expect((await svc.search(sv, { q: '4111' })).items.length).toBe(0);
    expect((await svc.search(ctx(B, ['ai_voice_transcription.view_transcripts']), { q: 'manicure' })).items.length).toBe(0);
  });
});
