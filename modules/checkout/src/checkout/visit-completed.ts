// visit-completed.ts — BUILD_PLAN Phase 15 (Constitution 8 §61–62): the ONE definition of the visit.completed fact.
//
// A visit is complete when its ticket is PAID — the platform's own definition of a visit (VISIT_TICKET_STATUSES in
// @aipowersalon/customers counts visits, last visit and returning customers from paid / closed tickets). The queue's
// done transition and service.completed come earlier: the guest has not paid, and the ticket can still be held,
// re-opened or voided. Every writer that moves a ticket INTO paid and records checkout.completed also writes this, in the
// same transaction, only on the transition (a ticket marked paid twice is one visit). The guard in
// apps/api/src/events/visit-completed-producer.pgtest.vitest.spec.ts fails if a writer of checkout.completed stops.
//
// Ids only (§95): the ticket, the customer, the channel — never a name, phone or amount (payment.captured carries money).
import { createDomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';

export type VisitChannel = 'pos' | 'skip_line';

export function visitCompletedEvent(input: { tenantId: string; branchId?: string | null; ticketId: string; customerId?: string | null; actorId?: string | null; channel: VisitChannel }) {
  return createDomainEvent({
    eventType: DOMAIN_EVENTS.VISIT_COMPLETED, tenantId: input.tenantId, branchId: input.branchId ?? undefined,
    aggregateType: 'ticket', aggregateId: input.ticketId, actorId: input.actorId ?? undefined, actorType: 'user',
    correlationId: `ticket:${input.ticketId}`,
    payload: { ticketId: input.ticketId, customerId: input.customerId ?? null, channel: input.channel },
  });
}
