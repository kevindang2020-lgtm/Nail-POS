import { describe, it, expect, beforeEach } from 'vitest';
import { LegalDocumentsService, LegalError } from './legal-documents.service';
import { InMemoryLegalDocsRepo } from './legal-documents.repository';

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io', role: 'SUPER_ADMIN' };

describe('LegalDocumentsService', () => {
  let svc: LegalDocumentsService; let repo: InMemoryLegalDocsRepo;
  beforeEach(() => { repo = new InMemoryLegalDocsRepo(); svc = new LegalDocumentsService(repo); });

  it('creates a draft, publishes it, and keeps prior versions immutable', async () => {
    const d1 = await svc.createDraft(CTX, { docType: 'terms_of_service', version: 'v2.2.0', title: 'Terms', content: 'old' });
    await svc.publish(CTX, d1.id);
    expect((await svc.getVersion(d1.id)).status).toBe('published');

    // a new version supersedes the old, which remains available + immutable
    const d2 = await svc.createDraft(CTX, { docType: 'terms_of_service', version: 'v2.3.0', content: 'new' });
    await svc.publish(CTX, d2.id);
    expect((await svc.getVersion(d1.id)).status).toBe('superseded'); // old version preserved, not deleted
    expect((await svc.getVersion(d2.id)).status).toBe('published');
    await expect(svc.assertEditable(d1.id)).rejects.toThrow(/immutable/i); // cannot edit a published/superseded version
  });

  it('rejects a duplicate version and a version not newer than the published one', async () => {
    const d = await svc.createDraft(CTX, { docType: 'privacy_policy', version: 'v1.0.0' });
    await svc.publish(CTX, d.id);
    await expect(svc.createDraft(CTX, { docType: 'privacy_policy', version: 'v1.0.0' })).rejects.toThrow(/already exists/i);
    await expect(svc.createDraft(CTX, { docType: 'privacy_policy', version: 'v0.9.0' })).rejects.toThrow(/newer/i);
  });

  it('rejects an unknown doc type and a malformed version', async () => {
    await expect(svc.createDraft(CTX, { docType: 'nope', version: 'v1.0.0' })).rejects.toThrow(LegalError);
    await expect(svc.createDraft(CTX, { docType: 'cookie_policy', version: '1.0' })).rejects.toThrow(/v2\.3\.0/);
  });

  it('will not publish a version from a terminal state', async () => {
    const d = await svc.createDraft(CTX, { docType: 'cookie_policy', version: 'v1.0.0' });
    await svc.publish(CTX, d.id);
    await expect(svc.publish(CTX, d.id)).rejects.toThrow(/cannot move from published/i);
  });

  it('reports acceptance status tied to the current published version', async () => {
    const d = await svc.createDraft(CTX, { docType: 'terms_of_service', version: 'v1.0.0' });
    await svc.publish(CTX, d.id);
    repo.seedAcceptances([{ versionId: d.id, decision: 'accepted' }, { versionId: d.id, decision: 'accepted' }, { versionId: d.id, decision: 'declined' }]);
    (repo as any).tenants = 5;
    const st = await svc.acceptanceStatus('terms_of_service');
    expect(st).toMatchObject({ available: true, version: 'v1.0.0', accepted: 2, declined: 1, pending: 2, total: 5 });
  });

  it('overview version: unavailable with no published docs, then the published version', async () => {
    expect(await svc.overviewVersion()).toEqual({ available: false, version: null, docCount: 0 });
    const d = await svc.createDraft(CTX, { docType: 'terms_of_service', version: 'v3.0.0' });
    await svc.publish(CTX, d.id);
    expect(await svc.overviewVersion()).toEqual({ available: true, version: 'v3.0.0', docCount: 1 });
  });
});
