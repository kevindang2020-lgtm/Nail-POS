// deal-reason-text.test — Vietnamese POS §58 V-5 (Oct 27 2026): the deals engine's refusal reasons and the V-5 registry codes
// (checkout "This ticket is already paid.", booking / queue refusals) read in Vietnamese on a Vietnamese POS; English keeps
// the server's own sentence.
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { dealReasonText, dealReasonsLine } from './deal-reason-text';
import { apiErrorMessage } from './error-text';
import { ERRORS_EN } from './ns/errors.en';
import { ERRORS_VI } from './ns/errors.vi';

afterEach(async () => { await setLanguage('en'); });

describe('V-5 deal refusal reasons', () => {
  it('English keeps the server\'s sentence (it can be more specific)', () => {
    expect(dealReasonText({ code: 'min_spend', message: 'Spend at least $40.00.', params: { cents: 4000 } })).toBe('Spend at least $40.00.');
  });
  it('Vietnamese words each reason from its code + params', async () => {
    await setLanguage('vi');
    expect(dealReasonText({ code: 'members_only', message: 'For members only.' })).toBe('Chỉ dành cho hội viên.');
    expect(dealReasonText({ code: 'min_spend', message: 'Spend at least $40.00.', params: { cents: 4000 } })).toMatch(/^Chi tiêu tối thiểu .*40/);
    expect(dealReasonText({ code: 'rule_min_visits', message: 'x', params: { count: 3 } })).toBe('Dành cho khách đã ghé ít nhất 3 lần.');
    const day = dealReasonText({ code: 'wrong_day', message: 'Valid on Monday.', params: { days: [1] } });
    expect(day.startsWith('Chỉ áp dụng vào ')).toBe(true);
    expect(day).not.toContain('Monday');
    expect(dealReasonText({ code: 'wrong_time', message: 'Valid 9:00 AM–5:00 PM.', params: { fromMinute: 540, toMinute: 1020 } })).toMatch(/^Chỉ áp dụng từ .+ đến .+\.$/);
  });
  it('an unknown code, or a reason missing the params its text needs, falls back to the server sentence', async () => {
    await setLanguage('vi');
    expect(dealReasonText({ code: 'withdrawn', message: 'The salon withdrew this deal.' })).toBe('The salon withdrew this deal.');
    expect(dealReasonText({ code: 'min_spend', message: 'Spend at least $40.00.' })).toBe('Spend at least $40.00.');
    expect(dealReasonsLine([], 'Không áp dụng được.')).toBe('Không áp dụng được.');
    expect(dealReasonsLine([{ code: 'code_used', message: 'Already used.' }, { code: 'ended', message: 'Expired.' }], 'x')).toBe('Mã này đã được dùng. Ưu đãi này đã kết thúc.');
  });
  it('every errors.dealReason key has a Vietnamese text with the same placeholders', () => {
    const keys = Object.keys(ERRORS_EN).filter((k) => k.startsWith('errors.dealReason.'));
    expect(keys.length).toBeGreaterThan(40);
    const ph = (s: string) => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort().join();
    for (const k of keys) { const vi = (ERRORS_VI as Record<string, string>)[k]; expect(vi?.trim(), k).toBeTruthy(); expect(ph(vi), k).toBe(ph((ERRORS_EN as Record<string, string>)[k])); }
  });
});

describe('V-5 registry codes on a Vietnamese POS', () => {
  it('"This ticket is already paid." and the booking / queue refusals show in Vietnamese; English keeps the server text', async () => {
    expect(apiErrorMessage('TICKET_ALREADY_PAID', null, 'This ticket is already paid in full')).toBe('This ticket is already paid in full');
    await setLanguage('vi');
    expect(apiErrorMessage('TICKET_ALREADY_PAID', null, 'This ticket is already paid in full')).toBe('Hóa đơn này đã được thanh toán.');
    expect(apiErrorMessage('OUTSIDE_STORE_HOURS', null, 'Booking is outside store hours — manager override required')).toBe('Giờ này nằm ngoài giờ mở cửa — cần quản lý cho phép.');
    expect(apiErrorMessage('GUEST_NOT_IN_QUEUE', { status: 'serving' }, 'This guest is no longer awaiting assignment (status: serving).')).toBe('Khách này không còn trong hàng chờ.');
    expect(apiErrorMessage('REFUND_EXCEEDS_REFUNDABLE', { remainingCents: 500 }, 'Refund exceeds the refundable balance (500 cents remain)')).toBe('Số tiền hoàn nhiều hơn số hóa đơn này còn có thể hoàn.');
  });
});
