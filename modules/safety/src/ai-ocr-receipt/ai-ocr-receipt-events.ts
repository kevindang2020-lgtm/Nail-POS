// ai-ocr-receipt-events.ts — mandate §150: the receipt half of the expense event vocabulary (expense_receipt.uploaded /
// extracted / review_required / processing_failed), written to the transactional outbox. Realtime delivery is the
// projection consumer's job (apps/api/src/events/consumers/realtime-projection.consumer.ts) — nothing here emits realtime.
// Payloads carry the document id, its pipeline state and money in cents — never receipt text, a card number or a person.
import type { Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReceiptEventKind = 'uploaded' | 'extracted' | 'review_required' | 'processing_failed';
export const RECEIPT_EVENT_TYPE: Record<ReceiptEventKind, DomainEventType> = {
  uploaded: DOMAIN_EVENTS.EXPENSE_RECEIPT_UPLOADED,
  extracted: DOMAIN_EVENTS.EXPENSE_RECEIPT_EXTRACTED,
  review_required: DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED,
  processing_failed: DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED,
};
type EvCtx = { tenantId: string; branchId: string | null; userId: string };

export interface ReceiptEventsPort { emit(ctx: EvCtx, kind: ReceiptEventKind, documentId: string, payload: Record<string, unknown>): Promise<void> }

export function receiptEvent(ctx: EvCtx, kind: ReceiptEventKind, documentId: string, payload: Record<string, unknown>) {
  const user = UUID_RE.test(ctx.userId ?? '') ? ctx.userId : undefined;
  return createDomainEvent({
    eventType: RECEIPT_EVENT_TYPE[kind],
    tenantId: ctx.tenantId,
    branchId: ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : undefined,
    aggregateType: 'ocr_document', aggregateId: documentId,
    actorId: user, actorType: user ? 'user' : 'system',
    payload: { documentId, ...payload },
  });
}

export class OutboxReceiptEvents implements ReceiptEventsPort {
  constructor(private readonly db: Kysely<never>, private readonly outbox: OutboxWriter) {}
  async emit(ctx: EvCtx, kind: ReceiptEventKind, documentId: string, payload: Record<string, unknown>): Promise<void> {
    await this.outbox.write(this.db as never, receiptEvent(ctx, kind, documentId, payload));
  }
}

