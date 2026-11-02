// Receipt / Expense mandate §155–§157 (Oct 27 2026): offline receipt capture — encrypted on the device, uploaded on reconnect,
// deleted the moment the server confirms. Re-exported from the package root.
export { createReceiptCaptureQueue, indexedDbCaptureStore, defaultCaptureStore, InMemoryCaptureStore, CaptureUnavailableError, isOffline, CAPTURE_TTL_MS, CAPTURE_MAX_QUEUED, type ReceiptCaptureQueue, type CaptureStore, type CaptureSummary, type CaptureUploader, type SyncResult, type QueuedCapture } from './receipt-capture-queue';
