// VietnamesePOS §54 / §119 (Oct 28 2026 audit): a customer's appointment / bill notices in HER language.
import { describe, it, expect } from 'vitest';
import { customerNoticeText, customerNoticeTitles, type CustomerNoticeKind } from './customer-notification-text';

const KINDS: CustomerNoticeKind[] = ['appointment_booked', 'appointment_booked_detail', 'appointment_rescheduled', 'appointment_cancelled',
  'appointment_booked_push', 'appointment_rescheduled_push', 'appointment_cancelled_push', 'checked_in', 'bill_ready', 'payment_completed'];
const V = { ymd: '2026-10-20', hhmm: '14:30', serviceName: 'Gel Manicure', extraServices: 1, ticketNumber: 'T-1045', amount: '$60.00', bySalon: true };

describe('customerNoticeText', () => {
  it('English keeps the wording the feeds always had (the date the way formatYmd / formatHhmm12 wrote it)', () => {
    expect(customerNoticeText('appointment_cancelled', null, V).body).toBe('Your appointment on Oct 20, 2026 at 2:30 PM was cancelled by the salon.');
    expect(customerNoticeText('appointment_rescheduled', 'en', V).body).toBe('Your appointment has been rescheduled to Oct 20, 2026 at 2:30 PM.');
    expect(customerNoticeText('checked_in', undefined).title).toBe('Checked in successfully');
    expect(customerNoticeText('appointment_booked_detail', 'en', V).body).toBe('Gel Manicure + 1 more on Oct 20, 2026 at 2:30 PM');
    expect(customerNoticeText('payment_completed', 'en', V).body).toBe('Your payment of $60.00 was processed on ticket #T-1045.');
  });
  it("a customer marked Vietnamese gets the same ENGLISH notice (Kevin's ruling, Oct 28 2026: every customer message is English)", () => {
    for (const k of KINDS) expect(customerNoticeText(k, 'vi', V), k).toEqual(customerNoticeText(k, 'en', V));
    expect(customerNoticeText('appointment_cancelled', 'vi', { ...V, bySalon: false }).body).toBe('Your appointment on Oct 20, 2026 at 2:30 PM was cancelled.');
  });
  it('every kind has an English title and body, never blank; the "already written" check still knows both titles', () => {
    for (const k of KINDS) {
      const en = customerNoticeText(k, 'en', V);
      expect(en.title && en.body, k).toBeTruthy();
      expect(`${en.title} ${en.body}`, k).not.toMatch(/undefined|null/);
      expect(customerNoticeTitles(k)[0], k).toBe(en.title);
    }
  });
  it('an unknown language is English, never throws', () => {
    expect(customerNoticeText('checked_in', 'fr').language).toBe('en');
    expect(customerNoticeText('appointment_booked', 'vi', {}).body).toBe('Your appointment is confirmed.');
  });
});
