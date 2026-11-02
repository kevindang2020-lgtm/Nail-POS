// ipad-modules.tsx — registers each module's iPad full-view content renderer with the global
// IPadViewProvider. Importing this file once (at app root) wires the registry. New modules add a
// single registerIPadModule(...) call here + a convenience request builder — no per-module popup.
import { registerIPadModule, type IPadOpenRequest } from './IPadViewProvider';
import { TechnicianScheduleInner, technicianScheduleMeta, type TechScheduleData } from './TechnicianSchedulePreview';
import { AppointmentDetailInner, type AppointmentRow } from './AppointmentDetailInner';
import { CustomerDetailInner, type CustomerRow } from './CustomerDetailInner';
import { CheckoutTicketInner, type CheckoutTicketRow } from './CheckoutTicketInner';
import { QueueItemInner, type QueueItemRow } from './QueueItemInner';
import { ReportSummaryInner, type ReportSummaryData } from './ReportSummaryInner';
import { resolveAvatarUrl } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { serverText } from '../i18n/server-text';
import { fmtMoney } from '../i18n/format';

// a report's period code → its label (same keys as screens/reportsCommon reportPeriods); a server's date-range text as sent
const PERIOD_KEY: Record<string, string> = { today: 'pos.today_2', week: 'pos.this_week_2', month: 'pos.this_month_3', year: 'admin.reports.period.year' };
const periodText = (p: string) => (PERIOD_KEY[p] ? tx(PERIOD_KEY[p]) : serverText(p));
// report (any Reports screen → open a summary/table in the iPad full view)
registerIPadModule('report', (req) => (
  <ReportSummaryInner data={(req.selectedRecord as ReportSummaryData) || {}} />
));

/** Open request for a report. The report screen passes its already-loaded, real KPIs + rows. */
export function reportRequest(title: string, data: ReportSummaryData, subtitle?: string): IPadOpenRequest {
  return {
    moduleType: 'report', selectedRecord: data, title,
    subtitle: subtitle ?? (data.periodLabel ? periodText(data.periodLabel) : undefined), icon: '\u{1F4C8}', ariaLabel: title,
    content: <ReportSummaryInner data={data} />,
  };
}

// queue-item (Customer Queue → open a waiting guest)
registerIPadModule('queue-item', (req) => (
  <QueueItemInner queueItemId={String(req.selectedRecord)} />
));

/** Open request for a queue item from a real POSQueueItemRow (list) or detail. */
export function queueItemRequest(row: QueueItemRow, onChanged?: () => void): IPadOpenRequest {
  const svc = (row.requestedServices || []).map((s) => s.serviceName).join(', ');
  return {
    moduleType: 'queue-item', selectedRecord: row.queueItemId,
    title: row.customerName, subtitle: `${svc || tx('glossary.queue.waiting')}${row.quotedWaitMinutes != null ? tx('pos.quotedwaitminutes_min_2', { quotedWaitMinutes: String(row.quotedWaitMinutes) }) : ''}`,
    initials: inits(row.customerName),
    status: row.isVip ? { label: tx('pos.vip'), bg: 'var(--gold-soft)', fg: 'var(--gold)' } : { label: statusLabel('queueItem', row.status || 'waiting'), bg: 'var(--warn-bg)', fg: 'var(--warn)' },
    ariaLabel: tx('pos.customername_queue_item', { customerName: String(row.customerName) }),
    content: <QueueItemInner queueItemId={row.queueItemId} initial={row} onChanged={onChanged} />,
  };
}

// checkout-ticket (Checkout → open a ticket)
registerIPadModule('checkout-ticket', (req) => (
  <CheckoutTicketInner ticketId={String(req.selectedRecord)} />
));

/** Open request for a checkout ticket from a real CheckoutTicketDetail (or a lighter list row). */
export function checkoutTicketRequest(row: CheckoutTicketRow): IPadOpenRequest {
  const total = row.totals?.totalDueCents;
  return {
    moduleType: 'checkout-ticket', selectedRecord: row.ticketId,
    title: row.customer?.fullName || (row.ticketNumber ? tx('pos.ticket_ticketnumber_2', { ticketNumber: String(row.ticketNumber) }) : tx('admin.ipad.ticket')),
    subtitle: `${row.ticketNumber ? tx('pos.ticket_ticketnumber_2', { ticketNumber: String(row.ticketNumber) }) : tx('glossary.nav.checkout')}${total != null ? ` · ${fmtMoney(total)}` : ''}`,
    icon: '\u{1F9FE}', ariaLabel: `${row.customer?.fullName || 'ticket'} checkout`,
    content: <CheckoutTicketInner ticketId={row.ticketId} initial={row} />,
  };
}

// customer (Customers / Check-In / Booking → open a customer profile)
const inits = (name: string) => (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
registerIPadModule('customer', (req) => (
  <CustomerDetailInner customerId={String(req.selectedRecord)} />
));

/** Open request for a customer profile from a real POSCustomerRow. */
export function customerRequest(row: CustomerRow): IPadOpenRequest {
  const sub = row.phone || row.email || (row.loyaltyTier ? tx('pos.loyaltytier_member', { loyaltyTier: String(row.loyaltyTier) }) : tx('glossary.people.customer'));
  return {
    moduleType: 'customer', selectedRecord: row.customerId,
    title: row.displayName, subtitle: sub, 
    initials: row.avatarUrl ? undefined : inits(row.displayName),
    icon: row.avatarUrl ? <img src={resolveAvatarUrl(row.avatarUrl) || undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : undefined,
    status: row.isVip ? { label: tx('pos.vip'), bg: 'var(--gold-soft)', fg: 'var(--gold)' } : (row.loyaltyTier ? { label: row.loyaltyTier, bg: 'var(--ok-bg)', fg: 'var(--ok)' } : null),
    ariaLabel: `${row.displayName} profile`,
    content: <CustomerDetailInner customerId={row.customerId} initial={row} />,
  };
}

// appointment (Booking / Check-In / Queue → open an appointment)
const to12 = (t: string) => { const hm = (t || '').includes('T') ? (t.split('T')[1] || '').slice(0, 5) : t; const [h, m] = (hm || '').split(':').map((x) => parseInt(x, 10)); if (Number.isNaN(h)) return t || ''; const ap = h < 12 ? 'AM' : 'PM'; const hr = h % 12 === 0 ? 12 : h % 12; return hr + ':' + (m < 10 ? '0' : '') + m + ' ' + ap; };
const APPT_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  confirmed: { get label() { return tx('pos.confirmed'); }, bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  arriving_soon: { get label() { return tx('pos.arriving_soon'); }, bg: '#EEF6FF', fg: 'var(--info)' },
  arriving: { get label() { return tx('pos.arriving_soon'); }, bg: '#EEF6FF', fg: 'var(--info)' },
  in_service: { get label() { return tx('pos.in_service_3'); }, bg: '#EEF6FF', fg: 'var(--info)' },
  checked_in: { get label() { return tx('pos.checked_in_2'); }, bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  waiting: { get label() { return tx('pos.waiting_2'); }, bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  completed: { get label() { return tx('pos.completed_2'); }, bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  cancelled: { get label() { return tx('pos.cancelled'); }, bg: '#F1ECE4', fg: 'var(--muted)' },
  no_show: { get label() { return tx('pos.no_show_4'); }, bg: '#FFF0ED', fg: 'var(--danger)' },
};
const apptStatus = (k: string) => APPT_STATUS[k] || { label: k ? statusLabel('appointment', k) : tx('glossary.booking.appointment'), bg: '#F1ECE4', fg: 'var(--muted)' };

registerIPadModule('appointment', (req) => (
  <AppointmentDetailInner appointmentId={String(req.selectedRecord)} />
));

/** Open request for an appointment. Passes the real row for instant paint (then refetches) + an
 *  onChanged refresh so the Booking/Queue page updates after a lifecycle action. */
export function appointmentRequest(row: AppointmentRow, onChanged?: () => void): IPadOpenRequest {
  return {
    moduleType: 'appointment', selectedRecord: row.appointmentId,
    title: row.customerName,
    subtitle: `${row.services?.[0]?.serviceName || tx('glossary.booking.appointment')} · ${to12(row.startTime)}`,
    icon: '\u{1F4C5}', status: apptStatus(row.status), ariaLabel: `${row.customerName} appointment`,
    content: <AppointmentDetailInner appointmentId={row.appointmentId} initial={row} onChanged={onChanged} />,
  };
}

// technician-schedule (Booking, Live Operations, Tech Queue → click a technician)
registerIPadModule('technician-schedule', (req) => (
  <TechnicianScheduleInner tech={req.selectedRecord as TechScheduleData} />
));

/** Build an open request for a technician's full-day schedule from a real Col/Detail record. */
export function techScheduleRequest(tech: TechScheduleData, date: string): IPadOpenRequest {
  const m = technicianScheduleMeta(tech, date);
  return {
    moduleType: 'technician-schedule', selectedRecord: tech,
    title: m.title, subtitle: m.subtitle, initials: m.initials, status: m.status,
    ariaLabel: m.ariaLabel, footer: m.footer,
  };
}
