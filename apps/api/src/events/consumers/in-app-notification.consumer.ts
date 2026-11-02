// in-app-notification.consumer.ts — developer merge (Oct 6 2026, his Sep 28 → Oct 6 delta): the in-app notification
// feeds (customer_notifications / technician_notifications / owner_alerts) written from domain events.
//
// The developer wrote these rows INLINE at every site — four copies of "Appointment cancelled" (POS booking, check-in,
// technician app, customer app), tip + "Payment received" after the ticket flipped to paid, "Customer arrived" in the
// customer app's check-in — each a best-effort insert swallowed on failure, invisible to a path that forgets it, and
// re-run on every afterPaid retry. Constitution 8 §57/§105: the fact is already in the outbox; ONE consumer writes the
// feed for every path that records it, inside the runner's transaction (the row commits with processed_events, so
// at-least-once delivery writes it once). Tenant isolation §14/§15: every row loaded here is checked against the
// event's tenant; a mismatch is a SECURITY failure, never a cross-tenant notification.
//
// What each event becomes (type values are the ones the three Notifications screens already style):
//   appointment.canceled            → customer: 'Appointment cancelled' (by you / by the salon)
//   checkin.customer_checked_in     → customer: 'Checked in successfully'; the appointment's technician: 'Customer arrived'
//   queue.customer_assigned         → technician: 'New assignment' (in-app may name the guest; a PUSH never does — §61/§95)
//   queue.service_lines_assigned    → each non-lead line technician: 'New assignment'
//   checkout.completed              → owner: 'Payment received' (every method); each tipped technician: 'Tip received'
//   payment.refunded / voided       → owner: 'Payment refunded' / 'Payment voided' (warning)
//   bill.due_soon / bill.overdue    → owner: 'Bill due soon' / 'Bill overdue' (finance; once per bill per day — the sweep's
//                                     bill_reminded_on decides, this only writes what it was told)
//   expense.duplicate_detected      → owner: 'Possible duplicate expense' (finance, warning) — never auto-deleted
// Owner rows go to owner_alerts — the owner app's ONE feed (Module 6; its bell, Notifications screen and unread count
// read it). The developer's parallel `owner_notifications` table + /owner/notifications routes are not reproduced.
import { type EventConsumer, type DomainEvent, DOMAIN_EVENTS, TenantMismatchError, ConsumerError } from '@aipowersalon/events';
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { formatHhmm12, formatYmd, utcDate } from '@aipowersalon/date-time';
import { customerNoticeText, customerNoticeTitles, type CustomerNoticeKind, type CustomerNoticeVars } from '@aipowersalon/api-contracts';

type Trx = Transaction<DB>;
const UUID = /^[0-9a-f-]{36}$/i;
const money = (cents: number) => `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
/** appt_date is a DATE column: a string in production (pg type parser), a Date under pglite — one YYYY-MM-DD either way. */
export function apptDay(d: unknown): string {
  if (d instanceof Date) return formatYmd(utcDate(d));   // a DATE has no zone: its UTC day IS the calendar day
  const s = String(d ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? formatYmd(s.slice(0, 10)) : s;
}
const when = (a: { appt_date: unknown; start_time: string | null }) => `${apptDay(a.appt_date)}${a.start_time ? ` at ${formatHhmm12(String(a.start_time).slice(0, 5))}` : ''}`;
/** VietnamesePOS §54: the appointment's day and start as the template wants them (YYYY-MM-DD, HH:MM) */
const apptVars = (a: { appt_date: unknown; start_time: string | null }): CustomerNoticeVars => ({ ymd: a.appt_date instanceof Date ? utcDate(a.appt_date) : String(a.appt_date ?? '').slice(0, 10), hhmm: a.start_time ? String(a.start_time).slice(0, 5) : null });
const METHOD_LABEL: Record<string, string> = { cash: 'cash', card: 'card', gift_card: 'gift card', wallet: 'wallet', split: 'split payment' };

export class InAppNotificationConsumer implements EventConsumer {
  readonly name = 'notifications.in_app';
  readonly eventTypes = [
    DOMAIN_EVENTS.APPOINTMENT_CREATED,
    DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED,
    DOMAIN_EVENTS.APPOINTMENT_CANCELED, DOMAIN_EVENTS.CUSTOMER_CHECKED_IN,
    DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED, DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED,
    DOMAIN_EVENTS.SERVICE_COMPLETED, DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT,
    DOMAIN_EVENTS.CHECKOUT_COMPLETED, DOMAIN_EVENTS.PAYMENT_REFUNDED, DOMAIN_EVENTS.PAYMENT_VOIDED,
    DOMAIN_EVENTS.BILL_DUE_SOON, DOMAIN_EVENTS.BILL_OVERDUE, DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED,
    // Receipt / Expense mandate §113 / §121 / §177–§179 (Oct 27 2026): a receipt ready for review, a receipt that could not be
    // read, a reimbursement awaiting approval, and the weekly / monthly owner summaries — each honouring the owner's
    // expense notification preferences (expense_settings.notify_*)
    DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED, DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED, DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED, DOMAIN_EVENTS.EXPENSE_SUMMARY_READY,
  ] as const;
  readonly critical = false;
  // §43: a replay would append a second "Payment received" / "Tip received" for a sale that is hours old.
  readonly replay = 'NOT_REPLAYABLE' as const;
  readonly timeoutMs = 10_000;

  async handle(e: DomainEvent<any>, trx: Trx): Promise<void> {
    if (!e.tenantId) return;
    switch (e.eventType) {
      case DOMAIN_EVENTS.APPOINTMENT_CREATED: return this.appointmentCreated(e, trx);
      case DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED: return this.appointmentRescheduled(e, trx);
      case DOMAIN_EVENTS.APPOINTMENT_CANCELED: return this.appointmentCancelled(e, trx);
      case DOMAIN_EVENTS.CUSTOMER_CHECKED_IN: return this.customerCheckedIn(e, trx);
      case DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED: return this.queueAssigned(e, trx);
      case DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED: return this.queueLinesAssigned(e, trx);
      case DOMAIN_EVENTS.SERVICE_COMPLETED:
      case DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT: return this.ticketReadyForCheckout(e, trx);
      case DOMAIN_EVENTS.CHECKOUT_COMPLETED: return this.ticketPaid(e, trx);
      case DOMAIN_EVENTS.PAYMENT_REFUNDED: return this.paymentRefunded(e, trx);
      case DOMAIN_EVENTS.PAYMENT_VOIDED: return this.paymentVoided(e, trx);
      case DOMAIN_EVENTS.BILL_DUE_SOON:
      case DOMAIN_EVENTS.BILL_OVERDUE: return this.billReminder(e, trx);
      case DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED: return this.expenseDuplicate(e, trx);
      case DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED: return this.receiptReviewRequired(e, trx);
      case DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED: return this.receiptProcessingFailed(e, trx);
      case DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED: return this.reimbursementChanged(e, trx);
      case DOMAIN_EVENTS.EXPENSE_SUMMARY_READY: return this.expenseSummary(e, trx);
    }
  }

  /** §177: the owner's expense notification preferences (a salon with no settings row gets the defaults: everything on) */
  private async expensePrefs(tenantId: string, trx: Trx) {
    const r: any = await trx.selectFrom('expense_settings').select(['notify_needs_review', 'notify_bill_due', 'notify_duplicate', 'notify_weekly_summary', 'notify_monthly_summary']).where('tenant_id', '=', tenantId).executeTakeFirst();
    return { needsReview: r?.notify_needs_review ?? true, billDue: r?.notify_bill_due ?? true, duplicate: r?.notify_duplicate ?? true, weekly: r?.notify_weekly_summary ?? true, monthly: r?.notify_monthly_summary ?? true };
  }
  /** the OCR document the event names, checked against the event's tenant */
  private async ocrDocument(e: DomainEvent<any>, trx: Trx) {
    const id = String(e.payload?.documentId ?? e.aggregateId ?? '');
    if (!UUID.test(id)) return null;
    const r: any = await trx.selectFrom('ocr_documents').select(['id', 'tenant_id', 'branch_id', 'vendor', 'total_cents', 'pipeline_status']).where('id', '=', id).executeTakeFirst();
    if (!r) return null;
    if (String(r.tenant_id) !== String(e.tenantId)) throw new TenantMismatchError(`ocr document ${id} does not belong to the event's tenant`);
    return r as { id: string; branch_id: string | null; vendor: string | null; total_cents: number | null; pipeline_status: string };
  }
  private async receiptReviewRequired(e: DomainEvent<any>, trx: Trx) {
    if (!(await this.expensePrefs(e.tenantId!, trx)).needsReview) return;
    const d = await this.ocrDocument(e, trx);
    if (!d) return;
    const dup = e.payload?.duplicate && e.payload.duplicate !== 'none';
    await this.financeRow(trx, e.tenantId!, d.branch_id ? String(d.branch_id) : null, {
      severity: dup ? 'warning' : 'info', title: dup ? 'Receipt needs review (possible duplicate)' : 'Receipt ready to review',
      body: `${d.vendor ? String(d.vendor) : 'A receipt'}${d.total_cents != null ? ` for ${money(Number(d.total_cents))}` : ''} was read and is waiting for your review.`,
      metadata: { kind: 'receipt_review_required', documentId: d.id, duplicate: e.payload?.duplicate ?? null, validation: e.payload?.validation ?? null, link: `/finance/receipts/${d.id}` },
    });
  }
  private async receiptProcessingFailed(e: DomainEvent<any>, trx: Trx) {
    const d = await this.ocrDocument(e, trx);
    if (!d) return;
    const malware = e.payload?.reason === 'malware_detected';
    await this.financeRow(trx, e.tenantId!, d.branch_id ? String(d.branch_id) : null, {
      severity: 'warning', title: malware ? 'Receipt rejected' : 'Receipt could not be read',
      body: malware ? 'The uploaded file failed the malware scan and was rejected.' : e.payload?.manualEntry ? 'The receipt is saved. Enter its details by hand, or retry reading it later.' : 'Reading the receipt failed after several tries. The receipt is saved — retry, or enter it by hand.',
      metadata: { kind: 'receipt_processing_failed', documentId: d.id, reason: e.payload?.reason ?? null, pipelineState: e.payload?.pipelineState ?? d.pipeline_status, link: `/finance/receipts/${d.id}` },
    });
  }
  private async reimbursementChanged(e: DomainEvent<any>, trx: Trx) {
    if (e.payload?.reimbursementStatus !== 'pending') return;                       // only "awaiting approval" is the owner's to act on
    if (!(await this.expensePrefs(e.tenantId!, trx)).needsReview) return;
    const x = await this.expense(e, trx);
    if (!x) return;
    await this.financeRow(trx, e.tenantId!, x.branch_id ? String(x.branch_id) : null, {
      severity: 'info', title: 'Reimbursement awaiting approval',
      body: `${x.vendor ? String(x.vendor) : 'An expense'} for ${money(Number(e.payload?.amountCents ?? x.amount_cents ?? 0))} was paid personally and waits for reimbursement approval.`,
      metadata: { kind: 'reimbursement_pending', expenseId: x.id, link: `/finance/expenses/${x.id}` },
    });
  }
  private async expenseSummary(e: DomainEvent<any>, trx: Trx) {
    const prefs = await this.expensePrefs(e.tenantId!, trx);
    const period = e.payload?.period === 'month' ? 'month' : 'week';
    if (period === 'week' ? !prefs.weekly : !prefs.monthly) return;
    const title = String(e.payload?.title ?? (period === 'week' ? 'Weekly expense summary' : 'Monthly expense summary')).slice(0, 120);
    const body = String(e.payload?.body ?? '').slice(0, 1000);
    if (!body) return;
    await this.financeRow(trx, e.tenantId!, null, { severity: 'info', title, body, metadata: { kind: period === 'week' ? 'expense_weekly_summary' : 'expense_monthly_summary', from: e.payload?.from ?? null, to: e.payload?.to ?? null, totalCents: e.payload?.totalCents ?? null, link: `/finance/reports?period=${period === 'week' ? 'week' : 'last_month'}` } });
  }

  // ── loaders (tenant-checked) ─────────────────────────────────────────────────────────────────────────────────
  private async appointment(e: DomainEvent<any>, trx: Trx) {
    const id = String(e.payload?.appointmentId ?? (e.aggregateType === 'appointment' ? e.aggregateId : ''));
    if (!UUID.test(id)) return null;
    const a: any = await trx.selectFrom('pos_tech_appointments').select(['id', 'tenant_id', 'branch_id', 'customer_id', 'customer_name', 'technician_id', 'appt_date', 'start_time']).where('id', '=', id).executeTakeFirst();
    if (!a) return null;
    if (String(a.tenant_id) !== String(e.tenantId)) throw new TenantMismatchError(`appointment ${id}`);
    return a as { id: string; branch_id?: string | null; customer_id: string | null; customer_name: string | null; technician_id: string | null; appt_date: unknown; start_time: string | null };
  }
  private async queueItem(e: DomainEvent<any>, trx: Trx) {
    const id = String(e.payload?.queueItemId ?? e.aggregateId ?? '');
    if (!UUID.test(id)) return null;
    const q: any = await trx.selectFrom('pos_queue_items').select(['id', 'tenant_id', 'customer_name']).where('id', '=', id).executeTakeFirst();
    if (!q) return null;
    if (String(q.tenant_id) !== String(e.tenantId)) throw new TenantMismatchError(`queue item ${id}`);
    return q as { id: string; customer_name: string | null };
  }
  private async ticket(tenantId: string, ticketId: string, trx: Trx) {
    if (!UUID.test(ticketId)) return null;
    const t: any = await trx.selectFrom('tickets').select(['id', 'tenant_id', 'branch_id', 'customer_id', 'primary_technician_id', 'ticket_number', 'tip_cents']).where('id', '=', ticketId).executeTakeFirst();
    if (!t) return null;
    if (String(t.tenant_id) !== tenantId) throw new TenantMismatchError(`ticket ${ticketId}`);
    return t as { id: string; branch_id: string | null; customer_id: string | null; primary_technician_id: string | null; ticket_number: string | null; tip_cents: number };
  }

  /** A technician notification's `reference` is what the Technician app opens on tap: ITS ticket (pos_tech_queue_tickets.id),
   *  never a queue item / sale / appointment id (those 404 there). Resolved for the technician; null when none exists yet. */
  private async techTicketRef(trx: Trx, tenantId: string, technicianId: string, by: { queueItemId?: string | null; ticketId?: string | null; appointmentId?: string | null }): Promise<string | null> {
    let q: any = trx.selectFrom('pos_tech_queue_tickets').select(['id']).where('tenant_id', '=', tenantId).where('assigned_technician_id', '=', technicianId);
    if (by.queueItemId) q = q.where('queue_item_id', '=', by.queueItemId);
    else if (by.ticketId) q = q.where('ticket_id', '=', by.ticketId);
    else if (by.appointmentId) q = q.where('appointment_id', '=', by.appointmentId);
    else return null;
    const r: any = await q.orderBy('assigned_at', 'desc').executeTakeFirst();
    return r?.id ? String(r.id) : null;
  }

  // ── writers ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** VietnamesePOS §54 / §119 (Oct 28 2026 audit): a customer's row in HER language (customers.preferred_language). */
  private async customerNotice(trx: Trx, tenantId: string, customerId: string, type: string, kind: CustomerNoticeKind, vars: CustomerNoticeVars, reference: string) {
    const c: any = await trx.selectFrom('customers').select(['preferred_language']).where('id', '=', customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
    const n = customerNoticeText(kind, c?.preferred_language ?? null, vars);
    return this.customerRow(trx, tenantId, customerId, { type, title: n.title, body: n.body, reference });
  }
  private customerRow(trx: Trx, tenantId: string, customerId: string, n: { type: string; title: string; body: string; reference: string }) {
    return trx.insertInto('customer_notifications').values({ tenant_id: tenantId, customer_id: customerId, type: n.type, title: n.title, body: n.body, reference: n.reference }).execute();
  }
  private technicianRow(trx: Trx, tenantId: string, technicianId: string, n: { type: string; title: string; body: string; reference: string | null }) {
    return trx.insertInto('technician_notifications').values({ tenant_id: tenantId, technician_id: technicianId, type: n.type, title: n.title, body: n.body, reference: n.reference }).execute();
  }
  private ownerRow(trx: Trx, tenantId: string, branchId: string | null, n: { category?: string; severity: 'info' | 'warning'; title: string; body: string; metadata: Record<string, unknown> }) {
    return trx.insertInto('owner_alerts').values({ tenant_id: tenantId, branch_id: branchId, category: n.category ?? 'payment', severity: n.severity, status: 'new', title: n.title, body: n.body, metadata: JSON.stringify(n.metadata) }).execute();
  }

  private financeRow(trx: Trx, tenantId: string, branchId: string | null, n: { severity: 'info' | 'warning'; title: string; body: string; metadata: Record<string, unknown> }) {
    return trx.insertInto('owner_alerts').values({ tenant_id: tenantId, branch_id: branchId, category: 'finance', severity: n.severity, status: 'new', title: n.title, body: n.body, metadata: JSON.stringify(n.metadata) } as never).execute();
  }
  /** the expense the event names, checked against the event's tenant (§14/§15: a mismatch is a security failure) */
  private async expense(e: DomainEvent<any>, trx: Trx) {
    if (!UUID.test(String(e.aggregateId))) return null;
    const r = await trx.selectFrom('expenses').select(['id', 'tenant_id', 'branch_id', 'vendor', 'invoice_number', 'due_date', 'amount_cents']).where('id', '=', e.aggregateId).executeTakeFirst();
    if (!r) return null;
    if (String(r.tenant_id) !== e.tenantId) throw new TenantMismatchError(`expense ${e.aggregateId} does not belong to the event's tenant`);
    return r;
  }

  // ── handlers ─────────────────────────────────────────────────────────────────────────────────────────────────
  private async billReminder(e: DomainEvent<any>, trx: Trx) {
    if (!(await this.expensePrefs(e.tenantId!, trx)).billDue) return;
    const x = await this.expense(e, trx);
    if (!x) return;
    const overdue = e.eventType === DOMAIN_EVENTS.BILL_OVERDUE;
    const who = x.vendor ? String(x.vendor) : 'A bill';
    const due = e.payload?.dueDate ? apptDay(e.payload.dueDate) : x.due_date ? apptDay(x.due_date) : null;
    const open = money(Number(e.payload?.openCents ?? x.amount_cents ?? 0));
    await this.financeRow(trx, e.tenantId!, x.branch_id ? String(x.branch_id) : null, {
      severity: overdue ? 'warning' : 'info', title: overdue ? 'Bill overdue' : 'Bill due soon',
      body: overdue ? `${who}: ${open} was due${due ? ` ${due}` : ''}.` : `${who}: ${open} is due${due ? ` ${due}` : ' soon'}.`,
      metadata: { kind: overdue ? 'bill_overdue' : 'bill_due_soon', expenseId: x.id, dueState: e.payload?.dueState ?? null, link: `/finance/expenses/${x.id}` },
    });
  }
  private async expenseDuplicate(e: DomainEvent<any>, trx: Trx) {
    if (!(await this.expensePrefs(e.tenantId!, trx)).duplicate) return;
    const x = await this.expense(e, trx);
    if (!x) return;
    await this.financeRow(trx, e.tenantId!, x.branch_id ? String(x.branch_id) : null, {
      severity: 'warning', title: 'Possible duplicate expense',
      body: `${x.vendor ? String(x.vendor) : 'An expense'} for ${money(Number(x.amount_cents ?? 0))} looks like one already recorded. Review it before it counts.`,
      metadata: { kind: 'expense_duplicate', expenseId: x.id, duplicateStatus: e.payload?.duplicateStatus ?? e.payload?.status ?? null, link: `/finance/expenses/${x.id}` },
    });
  }
  // ── merged from the developer tree (Oct 23 2026): booking created / rescheduled reach the in-app feeds ──
  private async appointmentCreated(e: DomainEvent<any>, trx: Trx) {
    const a = await this.appointment(e, trx);
    if (!a) return;
    if (a.customer_id) {
      const existing: any = await trx.selectFrom('customer_notifications')
        .select(['id'])
        .where('tenant_id', '=', e.tenantId!)
        .where('customer_id', '=', a.customer_id)
        .where('reference', '=', a.id)
        .executeTakeFirst();
      if (!existing) {
        await this.customerNotice(trx, e.tenantId!, a.customer_id, 'appointment', 'appointment_booked', apptVars(a), a.id);
      }
    }
    if (a.technician_id) {
      await this.technicianRow(trx, e.tenantId!, a.technician_id, {
        type: 'booking',
        title: 'New appointment booked',
        body: `${a.customer_name || 'A customer'} booked an appointment for ${when(a)}.`,
        reference: a.id,
      });
    }
    await this.ownerRow(trx, e.tenantId!, a.branch_id ?? e.branchId ?? null, {
      category: 'booking',
      severity: 'info',
      title: 'New appointment booked',
      body: `${a.customer_name || 'A customer'} booked an appointment for ${when(a)}.`,
      metadata: { appointmentId: a.id },
    });
  }
  private async appointmentRescheduled(e: DomainEvent<any>, trx: Trx) {
    const a = await this.appointment(e, trx);
    if (!a) return;
    if (a.customer_id) {
      const existing: any = await trx.selectFrom('customer_notifications')
        .select(['id'])
        .where('tenant_id', '=', e.tenantId!)
        .where('customer_id', '=', a.customer_id)
        .where('reference', '=', a.id)
        .where('title', 'in', customerNoticeTitles('appointment_rescheduled'))
        .executeTakeFirst();
      if (!existing) {
        await this.customerNotice(trx, e.tenantId!, a.customer_id, 'booking', 'appointment_rescheduled', apptVars(a), a.id);
      }
    }
    if (a.technician_id) {
      await this.technicianRow(trx, e.tenantId!, a.technician_id, {
        type: 'booking',
        title: 'Appointment rescheduled',
        body: `${a.customer_name || 'A customer'}'s appointment was rescheduled to ${when(a)}.`,
        reference: a.id,
      });
    }
    await this.ownerRow(trx, e.tenantId!, a.branch_id ?? e.branchId ?? null, {
      category: 'booking',
      severity: 'info',
      title: 'Appointment rescheduled',
      body: `${a.customer_name || 'A customer'}'s appointment was rescheduled to ${when(a)}.`,
      metadata: { appointmentId: a.id },
    });
  }
  private async appointmentCancelled(e: DomainEvent<any>, trx: Trx) {
    const a = await this.appointment(e, trx);
    if (!a) return;
    const byCustomer = e.payload?.source === 'customer_app';
    if (a.customer_id) {
      await this.customerNotice(trx, e.tenantId!, a.customer_id, 'warning', 'appointment_cancelled', { ...apptVars(a), bySalon: !byCustomer }, a.id);
    }
    if (a.technician_id) {
      await this.technicianRow(trx, e.tenantId!, a.technician_id, {
        type: 'warning',
        title: 'Appointment cancelled',
        body: `${a.customer_name || 'A customer'}'s appointment for ${when(a)} was cancelled.`,
        reference: a.id,
      });
    }
    await this.ownerRow(trx, e.tenantId!, a.branch_id ?? e.branchId ?? null, {
      category: 'booking',
      severity: 'info',
      title: 'Appointment cancelled',
      body: `${a.customer_name || 'A customer'}'s appointment for ${when(a)} was cancelled.`,
      metadata: { appointmentId: a.id },
    });
  }
  private async customerCheckedIn(e: DomainEvent<any>, trx: Trx) {
    const a = await this.appointment(e, trx);
    if (!a) return;
    if (a.customer_id) await this.customerNotice(trx, e.tenantId!, a.customer_id, 'arrival', 'checked_in', {}, a.id);
    if (a.technician_id) await this.technicianRow(trx, e.tenantId!, a.technician_id, { type: 'arrival', title: 'Customer arrived', body: `${a.customer_name || 'A customer'} checked in for their ${when(a)} appointment.`, reference: await this.techTicketRef(trx, e.tenantId!, a.technician_id, { appointmentId: a.id }) });
  }
  private async queueAssigned(e: DomainEvent<any>, trx: Trx) {
    const technicianId = String(e.payload?.technicianId ?? '');
    if (!UUID.test(technicianId)) return;
    const q = await this.queueItem(e, trx);
    if (!q) return;
    await this.technicianRow(trx, e.tenantId!, technicianId, { type: 'assignment', title: 'New assignment', body: `${q.customer_name || 'A guest'} is waiting for you.`, reference: await this.techTicketRef(trx, e.tenantId!, technicianId, { queueItemId: q.id }) });
  }
  private async queueLinesAssigned(e: DomainEvent<any>, trx: Trx) {
    const lead = String(e.payload?.leadTechnicianId ?? '');
    const lines: any[] = Array.isArray(e.payload?.lines) ? e.payload.lines : [];
    const techs = [...new Set(lines.map((l) => String(l?.technicianId ?? '')).filter((t) => UUID.test(t) && t !== lead))];
    if (!techs.length) return;
    const q = await this.queueItem(e, trx);
    if (!q) return;
    for (const technicianId of techs) await this.technicianRow(trx, e.tenantId!, technicianId, { type: 'assignment', title: 'New assignment', body: `${q.customer_name || 'A guest'} has a service with you.`, reference: await this.techTicketRef(trx, e.tenantId!, technicianId, { queueItemId: q.id }) });
  }
  private async ticketReadyForCheckout(e: DomainEvent<any>, trx: Trx) {
    const tenantId = e.tenantId!;
    const ticketId = String(e.payload?.ticketId ?? (e.aggregateType === 'ticket' ? e.aggregateId : ''));
    if (!UUID.test(ticketId)) return;
    const t = await this.ticket(tenantId, ticketId, trx);
    if (!t || !t.customer_id) return;
    const existing: any = await trx.selectFrom('customer_notifications')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', t.customer_id)
      .where('reference', '=', t.id)
      .where('type', '=', 'bill_ready')
      .executeTakeFirst();
    if (!existing) {
      await this.customerNotice(trx, tenantId, t.customer_id, 'bill_ready', 'bill_ready', { ticketNumber: t.ticket_number ?? null }, t.id);
    }
  }
  private async ticketPaid(e: DomainEvent<any>, trx: Trx) {
    const tenantId = e.tenantId!;
    const t = await this.ticket(tenantId, String(e.payload?.ticketId ?? e.aggregateId ?? ''), trx);
    if (!t) return;
    // what was paid: the approved payments on the ticket (every method — cash, card, gift card, wallet, split)
    const pays: any[] = await trx.selectFrom('payments').select(['method', 'amount_cents', 'tip_cents']).where('tenant_id', '=', tenantId).where('ticket_id', '=', t.id).where('status', '=', 'approved').execute();
    const paidCents = pays.reduce((s, p) => s + (Number(p.amount_cents) || 0), 0);
    const methods = [...new Set(pays.map((p) => String(p.method || '')).filter(Boolean))];
    const via = methods.length > 1 ? 'split payment' : (METHOD_LABEL[methods[0]] ?? methods[0] ?? 'payment');
    const c: any = t.customer_id ? await trx.selectFrom('customers').select(['full_name']).where('id', '=', t.customer_id).where('tenant_id', '=', tenantId).executeTakeFirst() : null;
    const who = c?.full_name || 'Walk-in';
    const label = t.ticket_number ? `ticket #${t.ticket_number}` : 'a ticket';
    await this.ownerRow(trx, tenantId, t.branch_id ?? null, { severity: 'info', title: 'Payment received', body: `${who} paid ${money(paidCents)} via ${via} on ${label}.`, metadata: { ticketId: t.id, amountCents: paidCents, methods } });
    if (t.customer_id) {
      const existingReceipt: any = await trx.selectFrom('customer_notifications')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', t.customer_id)
        .where('reference', '=', t.id)
        .where('type', '=', 'receipt')
        .executeTakeFirst();
      if (!existingReceipt) {
        await this.customerNotice(trx, tenantId, t.customer_id, 'receipt', 'payment_completed', { amount: money(paidCents), ticketNumber: t.ticket_number ?? null }, t.id);
      }
    }
    // tips: ticket_tip_allocations is the ONE tip store (written by the compensation snapshot in afterPaid). ONE-PAY
    // (Oct 13 2026): no fallback split — a tipped ticket with technician lines whose allocation has not landed yet is
    // RETRIED (TRANSIENT; the recovery worker writes the snapshot), never "the whole tip to the primary technician".
    // No tip, or no technician lines (nothing the split could allocate to) → no tip notification.
    const allocs: { technician_id: string; tip_cents: number }[] = await trx.selectFrom('ticket_tip_allocations').select(['technician_id', 'tip_cents']).where('tenant_id', '=', tenantId).where('ticket_id', '=', t.id).execute();
    const tipTotal = pays.reduce((s, p) => s + (Number(p.tip_cents) || 0), 0) || Number(t.tip_cents) || 0;
    if (!allocs.length && tipTotal > 0) {
      const worked: any = await trx.selectFrom('ticket_service_lines').select(['id']).where('tenant_id', '=', tenantId).where('ticket_id', '=', t.id)
        .where('technician_id', 'is not', null).where('removed_at', 'is', null).executeTakeFirst();
      if (worked) throw new ConsumerError('TRANSIENT', 'tip_allocation_pending', `ticket ${t.id}: the tip split has not been written yet`);
    }
    const perTech = new Map<string, number>();
    for (const a of allocs) if (UUID.test(String(a.technician_id)) && Number(a.tip_cents) > 0) perTech.set(String(a.technician_id), (perTech.get(String(a.technician_id)) ?? 0) + Number(a.tip_cents));
    for (const [technicianId, cents] of perTech) await this.technicianRow(trx, tenantId, technicianId, { type: 'tip', title: 'Tip received', body: `You received a ${money(cents)} tip on ${label}.`, reference: await this.techTicketRef(trx, tenantId, technicianId, { ticketId: t.id }) });
  }
  private async paymentRefunded(e: DomainEvent<any>, trx: Trx) {
    const tenantId = e.tenantId!;
    const amount = Number(e.payload?.amountCents) || 0;
    const paymentId = String(e.payload?.paymentId ?? '');
    const p: any = UUID.test(paymentId) ? await trx.selectFrom('payments').select(['tenant_id', 'ticket_id', 'branch_id']).where('id', '=', paymentId).executeTakeFirst() : null;
    if (p && String(p.tenant_id) !== tenantId) throw new TenantMismatchError(`payment ${paymentId}`);
    const t = p?.ticket_id ? await this.ticket(tenantId, String(p.ticket_id), trx) : null;
    const label = t?.ticket_number ? `ticket #${t.ticket_number}` : 'a ticket';
    await this.ownerRow(trx, tenantId, (p?.branch_id as string) ?? e.branchId ?? null, { severity: 'warning', title: 'Payment refunded', body: `A refund of ${money(amount)} was issued on ${label}.`, metadata: { ticketId: t?.id ?? null, paymentId: paymentId || null, refundId: e.payload?.refundId ?? e.aggregateId, amountCents: amount } });
  }
  private async paymentVoided(e: DomainEvent<any>, trx: Trx) {
    const tenantId = e.tenantId!;
    const amount = Number(e.payload?.amountCents) || 0;
    const ticketId = String(e.payload?.ticketId ?? '');
    const t = ticketId ? await this.ticket(tenantId, ticketId, trx) : null;
    const label = t?.ticket_number ? `ticket #${t.ticket_number}` : 'a ticket';
    await this.ownerRow(trx, tenantId, t?.branch_id ?? e.branchId ?? null, { severity: 'warning', title: 'Payment voided', body: `A ${money(amount)}${e.payload?.method ? ` ${METHOD_LABEL[String(e.payload.method)] ?? e.payload.method}` : ''} payment was voided on ${label}.`, metadata: { ticketId: t?.id ?? null, paymentId: e.payload?.paymentId ?? e.aggregateId, amountCents: amount } });
  }
}
