// @aipowersalon/media — Constitution 13 §115. The MediaStorage port and its adapters; no Nest, no global state.
export * from './media-storage';   // moved from apps/api/src/tech-profile/media-storage.ts (Constitution 13 §219)
export * from './image-info';      // what an uploaded image really is, from its bytes (advertising images, the salon logo)
export * from './private-store';   // BUILD_PLAN Phase 12: the PRIVATE store (async exports) — never a public URL
export * from './upload-policy';   // Phase 12 (Constitution 5 §158–166): the ONE upload policy (size, sniffed type, extensions, metadata strip, scan hook, tenant keys, quota)
export * from './clamav-scanner';   // BUILD_PLAN Phase 14 (Constitution 12): ClamAV (clamd INSTREAM) scanner + quarantine, used by acceptUpload when CLAMAV_HOST is set
