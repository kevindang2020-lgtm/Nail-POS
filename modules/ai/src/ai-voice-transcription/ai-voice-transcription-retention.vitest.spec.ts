// ai-voice-transcription-retention.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository } from './ai-voice-transcription.repository';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { VoiceTranscriptionForbiddenError, VoiceTranscriptionValidationError } from './ai-voice-transcription.dto';
import type { VoiceTranscriptionContext } from './ai-voice-transcription.dto';

const ctx = (perms: string[], tenantId = 'A'): VoiceTranscriptionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings', 'ai_voice_transcription.delete'];

function makeProvider() {
  const deletions: string[] = [];
  const provider = {
    name: 'x',
    async fetchTranscript() { return { segments: [{ channel: 1, speakerLabel: 'caller', startMs: 0, endMs: 1, text: 'book a manicure', language: 'en', confidence: 0.95, isFinal: true }], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 5, providerTranscriptRef: 'r' }; },
    async deleteRecording(_p: string, callId: string) { deletions.push(callId); return { deleted: true }; },
    async healthy() { return true; },
  };
  return { provider, deletions };
}
async function ingest(svc: VoiceTranscriptionService, callId: string) {
  await svc.recordConsent(ctx(ALL), { branchId: 'b1', provider: 'retell', providerCallId: callId, consentStatus: 'granted', consentMethod: 'announcement', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v1', jurisdiction: null, initiatedBy: 'system', consentAt: null });
  return svc.ingest(ctx(ALL), { provider: 'retell', providerCallId: callId });
}

describe('explicit erasure', () => {
  it('requires the delete permission', async () => {
    const { provider } = makeProvider();
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true));
    const h = await ingest(svc, 'c1');
    await expect(svc.deleteTranscript(ctx(['ai_voice_transcription.view']), h.id)).rejects.toBeInstanceOf(VoiceTranscriptionForbiddenError);
  });

  it('tombstones the transcript, deletes provider-side, and is idempotent', async () => {
    const { provider, deletions } = makeProvider();
    const repo = new InMemoryVoiceTranscriptionRepository();
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true));
    const h = await ingest(svc, 'c1');

    const r1 = await svc.deleteTranscript(ctx(ALL), h.id, 'tenant_request');
    expect(r1.deleted).toBe(true);
    expect(r1.providerDeleted).toBe(true);
    expect(deletions).toContain('c1');
    // no longer listed or readable
    expect((await svc.listTranscripts(ctx(ALL), {})).items.find((t) => t.id === h.id)).toBeUndefined();
    expect((await svc.getTranscript(ctx(ALL), h.id)).segments).toHaveLength(0);
    // idempotent re-delete → no-op
    const r2 = await svc.deleteTranscript(ctx(ALL), h.id, 'tenant_request');
    expect(r2.deleted).toBe(false);
  });

  it('refuses deletion while under legal hold', async () => {
    const { provider } = makeProvider();
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true));
    const h = await ingest(svc, 'c1');
    await svc.setLegalHold(ctx(ALL), h.id, true);
    await expect(svc.deleteTranscript(ctx(ALL), h.id)).rejects.toThrow('LEGAL_HOLD');
  });

  it('cannot delete another tenant\'s transcript', async () => {
    const { provider } = makeProvider();
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true));
    const h = await ingest(svc, 'c1');
    await expect(svc.deleteTranscript(ctx(ALL, 'B'), h.id)).rejects.toBeInstanceOf(VoiceTranscriptionValidationError);
  });
});

describe('retention sweep', () => {
  it('deletes expired transcripts, skips legal-hold, and deletes provider-side', async () => {
    const { provider, deletions } = makeProvider();
    const repo = new InMemoryVoiceTranscriptionRepository();
    // retentionDays = -1 → retention_expires_at is already in the past at ingest
    const svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true), -1);
    const expired = await ingest(svc, 'exp1');
    const held = await ingest(svc, 'held1');
    await svc.setLegalHold(ctx(ALL), held.id, true);

    const res = await svc.runRetentionSweep(100);
    expect(res.deleted).toBe(1);           // only the non-held expired one
    expect(deletions).toContain('exp1');   // provider deletion happened
    expect(deletions).not.toContain('held1');
    // held one survives, expired one is tombstoned
    expect((await svc.getTranscript(ctx(ALL), held.id)).header.status).not.toBe('deleted');
    expect((await svc.getTranscript(ctx(ALL), expired.id)).header.status).toBe('deleted');
  });

  it('sweep is idempotent — a second run deletes nothing new', async () => {
    const { provider } = makeProvider();
    const svc = new VoiceTranscriptionService(new InMemoryVoiceTranscriptionRepository(), provider, new InMemoryVoiceEntitlement(() => true), -1);
    await ingest(svc, 'exp1');
    expect((await svc.runRetentionSweep(100)).deleted).toBe(1);
    expect((await svc.runRetentionSweep(100)).deleted).toBe(0);
  });
});
