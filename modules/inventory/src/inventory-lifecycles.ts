// inventory-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the inventory lifecycles as state machines (the ONE transition table
// per lifecycle; every status write in inventory.service.ts runs through transitionStatus — a conditional update, so a
// concurrent cancel / receive / reconcile cannot overwrite each other).
import { defineStateMachine } from '@aipowersalon/database';
import { PO_TRANSITIONS } from './inventory-core';

/** purchase_orders.status — the table inventory-core has always declared (PO_TRANSITIONS), now enforced on every write. */
export const PURCHASE_ORDER = defineStateMachine({
  name: 'purchase_order', table: 'purchase_orders', column: 'status',
  states: ['draft', 'approved', 'ordered', 'partial', 'received', 'cancelled', 'closed'],
  transitions: PO_TRANSITIONS,
  initial: ['draft'],
});

/** inventory_counts.status — from the service's guards: enter / submit only while in progress; reconcile from in progress
 *  or submitted; cancel from anything not reconciled or cancelled. */
export const INVENTORY_COUNT = defineStateMachine({
  name: 'inventory_count', table: 'inventory_counts', column: 'status',
  states: ['in_progress', 'submitted', 'reconciled', 'cancelled'],
  transitions: { in_progress: ['submitted', 'reconciled', 'cancelled'], submitted: ['reconciled', 'cancelled'] },
  initial: ['in_progress'],
});

/** inventory_technician_reports.status — a technician's bottle report is reviewed ONCE: pending → approved / rejected (or
 *  corrected / processed automatically). Approval moves the status BEFORE applying the stock effect, conditionally, so two
 *  managers approving at once apply it once (the second gets 409). */
export const INVENTORY_TECH_REPORT = defineStateMachine({
  name: 'inventory_technician_report', table: 'inventory_technician_reports', column: 'status',
  states: ['pending', 'approved', 'rejected', 'corrected', 'automatically_processed'],
  transitions: { pending: ['approved', 'rejected', 'corrected', 'automatically_processed'] },
  initial: ['pending', 'automatically_processed'],
});

/** product_usage_events.status (migration 716) — a product use is confirmed when recorded and becomes 'reversed' when
 *  corrections give the whole quantity back. Refused: un-reversing (a fully reversed use cannot be adjusted again —
 *  USAGE_ALREADY_REVERSED — so nothing may move it back to confirmed). */
export const PRODUCT_USAGE_EVENT = defineStateMachine({
  name: 'product_usage_event', table: 'product_usage_events', column: 'status',
  states: ['confirmed', 'reversed'],
  transitions: { confirmed: ['reversed'] },
  initial: ['confirmed'],
});
