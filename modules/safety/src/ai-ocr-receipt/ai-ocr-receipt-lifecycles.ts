// ai-ocr-receipt-lifecycles.ts — the posting record's lifecycle (ocr_postings.status, migration 344's CHECK). A posting is
// written once per idempotency key: it lands `posted` or `failed`; a failed one is retried (failed → failed / posted);
// a posted one never changes — the expense it made is the books' record (Oct 21 2026: failed postings could never retry).
import { defineStateMachine } from '@aipowersalon/database';

export const OCR_POSTING = defineStateMachine({
  name: 'ocr_posting', table: 'ocr_postings', column: 'status',
  states: ['pending', 'posted', 'failed'],
  transitions: {
    pending: ['posted', 'failed'],
    failed: ['failed', 'posted'],
  },
  initial: ['pending', 'posted', 'failed'],
});
