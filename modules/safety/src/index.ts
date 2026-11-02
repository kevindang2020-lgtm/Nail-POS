// modules/safety — the safety domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { AiOcrReceiptModule } from './ai-ocr-receipt/ai-ocr-receipt.module';
export { TenantSafetyCommunityModule } from './tenant-safety-community/tenant-safety-community.module';
export { MAX_SIGNED_URL_TTL, S3EvidenceBlobStore } from './tenant-safety-community/evidence-blob-store';   // used by the API today
