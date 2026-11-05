// customer-notification-text.ts — the words a CUSTOMER receives about her own appointment or bill (the app push, the in-app
// feed row): one table, so the push consumer, the in-app feed consumer and the booking service cannot drift.
//
// Kevin's ruling (Oct 28 2026): the salons' customers are English-speaking Americans, so every customer message is ENGLISH —
// customerMessageLanguage() always answers 'en'. The Vietnamese column below is kept, unused, so the choice can be reversed in
// one place (language.ts) without rewriting the table. Staff screens (the POS) stay English + Vietnamese.
import { customerMessageLanguage, type AppLanguage } from './language';

export type CustomerNoticeKind =
  | 'appointment_booked' | 'appointment_booked_detail' | 'appointment_rescheduled' | 'appointment_cancelled'
  | 'appointment_booked_push' | 'appointment_rescheduled_push' | 'appointment_cancelled_push'
  | 'checked_in' | 'bill_ready' | 'payment_completed';

export interface CustomerNoticeVars {
  /** the appointment day (YYYY-MM-DD) and start (HH:MM, 24h); formatted here in the customer's language
   *  ("Oct 30, 2026 at 2:00 PM" / "14:00 ngày 30/10/2026"). Either may be absent. */
  ymd?: string | null; hhmm?: string | null;
  serviceName?: string; extraServices?: number;
  /** the salon cancelled (not the customer) */
  bySalon?: boolean;
  ticketNumber?: string | number | null;
  /** formatted money ("$45.00") */
  amount?: string;
}
export interface CustomerNoticeText { title: string; body: string; language: AppLanguage }

const ymdParts = (ymd: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? '')); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const hmParts = (hhmm: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '')); return m ? { h: +m[1], mi: m[2] } : null; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateEn = (v: CustomerNoticeVars) => { const p = ymdParts(v.ymd); return p ? `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}` : ''; };
const timeEn = (v: CustomerNoticeVars) => { const t = hmParts(v.hhmm); return t ? `${((t.h + 11) % 12) + 1}:${t.mi} ${t.h < 12 ? 'AM' : 'PM'}` : ''; };
const dateVi = (v: CustomerNoticeVars) => { const p = ymdParts(v.ymd); return p ? `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y}` : ''; };
const timeVi = (v: CustomerNoticeVars) => { const t = hmParts(v.hhmm); return t ? `${String(t.h).padStart(2, '0')}:${t.mi}` : ''; };
const whenEn = (v: CustomerNoticeVars) => `${dateEn(v)}${timeEn(v) ? ` at ${timeEn(v)}` : ''}`.trim();
const whenVi = (v: CustomerNoticeVars) => `${timeVi(v)}${dateVi(v) ? ` ngày ${dateVi(v)}` : ''}`.trim();

const EN: Record<CustomerNoticeKind, (v: CustomerNoticeVars) => [string, string]> = {
  appointment_booked: (v) => ['Appointment booked', whenEn(v) ? `Your appointment is confirmed for ${whenEn(v)}.` : 'Your appointment is confirmed.'],
  appointment_booked_detail: (v) => ['Appointment booked', `${v.serviceName ?? ''}${(v.extraServices ?? 0) > 0 ? ` + ${v.extraServices} more` : ''} on ${whenEn(v)}`],
  appointment_rescheduled: (v) => ['Appointment rescheduled', `Your appointment has been rescheduled to ${whenEn(v)}.`],
  appointment_cancelled: (v) => ['Appointment cancelled', `Your appointment on ${whenEn(v)} was cancelled${v.bySalon ? ' by the salon' : ''}.`],
  appointment_booked_push: () => ['Appointment booked', 'Your appointment is confirmed. Open the app for details.'],
  appointment_rescheduled_push: () => ['Appointment rescheduled', 'Your appointment has been rescheduled. Open the app for details.'],
  appointment_cancelled_push: () => ['Appointment cancelled', 'Your appointment was cancelled. Open the app for details.'],
  checked_in: () => ['Checked in successfully', 'Please take a seat — your technician will be with you shortly.'],
  bill_ready: (v) => ['Your bill is ready — skip the line', `Your bill is ready for ${v.ticketNumber ? `#${v.ticketNumber}` : 'your service'}. Pay from your phone to skip the line.`],
  payment_completed: (v) => ['Payment completed', `Your payment of ${v.amount ?? ''} was processed on ${v.ticketNumber ? `ticket #${v.ticketNumber}` : 'a ticket'}.`],
};
const VI: Record<CustomerNoticeKind, (v: CustomerNoticeVars) => [string, string]> = {
  appointment_booked: (v) => ['Đã đặt lịch hẹn', whenVi(v) ? `Lịch hẹn của quý khách đã được xác nhận vào ${whenVi(v)}.` : 'Lịch hẹn của quý khách đã được xác nhận.'],
  appointment_booked_detail: (v) => ['Đã đặt lịch hẹn', `${v.serviceName ?? ''}${(v.extraServices ?? 0) > 0 ? ` + ${v.extraServices} dịch vụ khác` : ''} vào ${whenVi(v)}`],
  appointment_rescheduled: (v) => ['Lịch hẹn đã được dời', `Lịch hẹn của quý khách đã được dời sang ${whenVi(v)}.`],
  appointment_cancelled: (v) => ['Lịch hẹn đã bị hủy', `Lịch hẹn của quý khách vào ${whenVi(v)} đã bị ${v.bySalon ? 'tiệm ' : ''}hủy.`],
  appointment_booked_push: () => ['Đã đặt lịch hẹn', 'Lịch hẹn của quý khách đã được xác nhận. Mở ứng dụng để xem chi tiết.'],
  appointment_rescheduled_push: () => ['Lịch hẹn đã được dời', 'Lịch hẹn của quý khách đã được dời. Mở ứng dụng để xem chi tiết.'],
  appointment_cancelled_push: () => ['Lịch hẹn đã bị hủy', 'Lịch hẹn của quý khách đã bị hủy. Mở ứng dụng để xem chi tiết.'],
  checked_in: () => ['Đã check-in thành công', 'Mời quý khách ngồi chờ — thợ sẽ phục vụ quý khách trong giây lát.'],
  bill_ready: (v) => ['Hóa đơn đã sẵn sàng — không cần xếp hàng', `Hóa đơn ${v.ticketNumber ? `#${v.ticketNumber}` : 'dịch vụ của quý khách'} đã sẵn sàng. Thanh toán trên điện thoại để không phải xếp hàng.`],
  payment_completed: (v) => ['Thanh toán hoàn tất', `Khoản thanh toán ${v.amount ?? ''} cho hóa đơn ${v.ticketNumber ? `#${v.ticketNumber}` : 'của quý khách'} đã được xử lý.`],
};

/** The customer's notice in her language. `customerLanguage` is customers.preferred_language (null / unknown → English). */
export function customerNoticeText(kind: CustomerNoticeKind, customerLanguage: unknown, vars: CustomerNoticeVars = {}): CustomerNoticeText {
  const language = customerMessageLanguage(customerLanguage);
  const [title, body] = (language === 'vi' ? VI : EN)[kind](vars);
  return { title, body, language };
}
/** Both languages' titles of a kind — a "was this row already written?" check must match either. */
export const customerNoticeTitles = (kind: CustomerNoticeKind): string[] => [EN[kind]({})[0], VI[kind]({})[0]];
