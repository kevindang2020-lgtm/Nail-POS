// expense-lifecycles.ts — the expense, bill and reimbursement state machines (mandate §51–55, §65, §85, §133–136).
//
// expenses.status — the business record's life. An expense is DRAFT while someone is still filling it in,
// PENDING_REVIEW while it waits for an owner / manager (§82: AI extracts, a person approves), APPROVED once it is a real
// cost (only approved expenses are counted in reports), REJECTED when the approver sends it back (it can be corrected and
// resubmitted), VOIDED when an approved record turns out to be wrong — never hard-deleted (§85). Archive is a separate
// flag (archived_at), not a state: an archived approved expense is still a real cost, just out of the inbox.
import { defineStateMachine } from '@aipowersalon/database';

export const EXPENSE = defineStateMachine({
  name: 'expense', table: 'expenses', column: 'status',
  states: ['draft', 'pending_review', 'approved', 'rejected', 'voided'],
  transitions: {
    draft: ['pending_review', 'approved', 'voided'],
    pending_review: ['approved', 'rejected', 'draft', 'voided'],
    rejected: ['draft', 'pending_review', 'voided'],
    approved: ['voided'],
  },
  initial: ['draft', 'pending_review', 'approved'],
});

/** expenses.bill_status — a bill (payable later, §53) is OPEN until paid in one or more payments. */
export const EXPENSE_BILL = defineStateMachine({
  name: 'expense_bill', table: 'expenses', column: 'bill_status',
  states: ['open', 'partially_paid', 'paid', 'voided'],
  transitions: {
    open: ['partially_paid', 'paid', 'voided'],
    partially_paid: ['partially_paid', 'paid', 'voided'],
  },
  initial: ['open'],
});

/** expenses.reimbursement_status — a manager paid with a personal card (§64–65). Not payroll (§66). */
export const EXPENSE_REIMBURSEMENT = defineStateMachine({
  name: 'expense_reimbursement', table: 'expenses', column: 'reimbursement_status',
  states: ['not_required', 'pending', 'approved', 'paid', 'rejected'],
  transitions: {
    not_required: ['pending'],
    pending: ['approved', 'rejected', 'not_required'],
    approved: ['paid', 'rejected'],
    rejected: ['pending'],
  },
  initial: ['not_required', 'pending'],
});

/** expenses.duplicate_status — a suspected duplicate waits for a person; it is never deleted by the system (§49). */
export const EXPENSE_DUPLICATE = defineStateMachine({
  name: 'expense_duplicate', table: 'expenses', column: 'duplicate_status',
  states: ['none', 'possible', 'exact', 'overridden', 'confirmed_duplicate'],
  transitions: {
    none: ['possible', 'exact'],
    possible: ['overridden', 'confirmed_duplicate', 'none'],
    exact: ['overridden', 'confirmed_duplicate'],
  },
  initial: ['none', 'possible', 'exact'],
});

/** The statuses whose money counts in every report, export and dashboard total (§108: one authoritative set). */
export const COUNTED_STATUSES = ['approved'] as const;
