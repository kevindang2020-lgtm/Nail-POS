// display-receipt-lifecycle.ts — BUILD_PLAN Phase 12 (#27): the receipt step on the customer display
// (customer_display_sessions.receipt_status). The customer's choice claims the step ONCE (NULL → sending | skipped — the
// row's first receipt state, like an insert: claimReceiptChoice's `receipt_choice is null` guard); a sending receipt
// finishes sent / unavailable / failed, exactly once.
import { defineStateMachine } from '@aipowersalon/database';

export const DISPLAY_RECEIPT = defineStateMachine({
  name: 'display_receipt', table: 'customer_display_sessions', column: 'receipt_status',
  states: ['sending', 'skipped', 'sent', 'unavailable', 'failed'],
  transitions: { sending: ['sent', 'unavailable', 'failed'] },
  initial: ['sending', 'skipped'],
});
