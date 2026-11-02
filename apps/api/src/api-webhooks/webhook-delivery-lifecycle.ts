// webhook-delivery-lifecycle.ts — BUILD_PLAN Phase 12 (#27): an outbound webhook delivery (tenant_webhook_deliveries.status).
// pending → delivered, or failed (retried with backoff: failed → pending / delivered / failed) until it is dead; delivered
// and dead are final — a late dispatcher pass can no longer move a delivered (or dead) delivery back to pending.
import { defineStateMachine } from '@aipowersalon/database';

export const WEBHOOK_DELIVERY = defineStateMachine({
  name: 'webhook_delivery', table: 'tenant_webhook_deliveries', column: 'status',
  states: ['pending', 'delivered', 'failed', 'dead'],
  transitions: { pending: ['pending', 'delivered', 'failed', 'dead'], failed: ['pending', 'delivered', 'failed', 'dead'] },
  initial: ['pending'],
});
