// community-evidence-blob.adapter.ts — bridges the Safety Community's evidence port to the platform's S3 store.
//
// Two different shapes, deliberately:
//   • `common/evidence-blob-store.ts` is the platform's generic object store: `put(key, body)`,
//     `signedUrl(key, ttl)` → `SignedUrl | null`, `remove(key)`.
//   • The community module's `EvidenceBlobStore` is narrower on purpose: it never handles file BYTES in the
//     request path (uploads go straight to S3), and it must never be able to hand out a URL for a blob that was
//     not properly stored.
//
// The important behaviour is what happens when there is NO storage configured. The platform store honestly
// returns `null` from `signedUrl()` rather than fabricating a URL. The community port's signature promises a
// URL — so this adapter THROWS instead of inventing one. A fabricated `https://…` would be indistinguishable
// from a working system right up until a moderator clicked it during an investigation and got nothing.
import type { EvidenceBlobStore as CommunityEvidenceBlobStore } from './community-evidence';
import type { EvidenceBlobStore as PlatformBlobStore } from './evidence-blob-store';

export class EvidenceStorageNotConfigured extends Error {
  constructor() {
    super('Evidence storage is not configured. Set EVIDENCE_S3_BUCKET to enable evidence attachments.');
    this.name = 'EvidenceStorageNotConfigured';
  }
}

export class CommunityEvidenceBlobAdapter implements CommunityEvidenceBlobStore {
  constructor(private readonly store: PlatformBlobStore) {}

  /** Record where the blob lives. The bytes themselves are uploaded directly to storage, never through here. */
  async putMetadata(_tenantId: string, _evidenceId: string, storageKey: string): Promise<void> {
    // Nothing to write to the object store: the row in `community_evidence` already carries the key. This exists
    // so the community service never has to know whether storage is object- or file-backed.
    if (!storageKey) throw new EvidenceStorageNotConfigured();
  }

  /**
   * A short-lived signed URL for a moderator to open the raw file. Access control happened upstream
   * (`canAccessRawEvidence`); by the time we get here the caller is authorised.
   */
  async signedUrl(storageKey: string): Promise<{ url: string; expiresAt: string }> {
    const signed = await this.store.signedUrl(storageKey);
    if (!signed) {
      // The platform store said "there is no storage". Do NOT fabricate a URL — fail loudly so the caller can
      // tell the moderator the truth instead of handing them a link that goes nowhere.
      throw new EvidenceStorageNotConfigured();
    }
    return { url: signed.url, expiresAt: signed.expiresAt };
  }
}
