// status-label.test — English + Vietnamese POS mandate §20 / §62 (build plan WP-D1). A canonical code keeps its value; its
// label follows the language; an unknown code shows the humanised code — never blank, never a raw key.
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { APPOINTMENT_STATUSES } from '@aipowersalon/api-contracts';
import './index';
import { statusLabel, statusLabelOrNull, statusLabels, humanizeCode } from './status-label';
import { STATUS_EN } from './ns/status.en';
import { STATUS_VI } from './ns/status.vi';

afterEach(async () => { await setLanguage('en'); });

describe('statusLabel', () => {
  it('every status key has English and Vietnamese, and the Vietnamese is shown in Vietnamese', async () => {
    const keys = Object.keys(STATUS_EN);
    expect(keys.length).toBeGreaterThan(400);
    const vi = STATUS_VI as Record<string, string>;
    expect(keys.filter((k) => !vi[k]?.trim())).toEqual([]);
    await setLanguage('vi');
    for (const k of keys) {
      const [, domain, ...code] = k.split('.');
      expect(statusLabel(domain, code.join('.'))).toBe(vi[k]);
    }
  });
  it('the mandate examples (§20, §62)', async () => {
    expect(statusLabel('appointment', 'confirmed')).toBe('Confirmed');
    expect(statusLabel('appointment', 'in_service')).toBe('In Service');
    expect(statusLabel('checkoutTicket', 'READY_FOR_CHECKOUT')).toBe('Ready for Checkout');
    await setLanguage('vi');
    expect(statusLabel('appointment', 'confirmed')).toBe('Đã xác nhận');
    expect(statusLabel('appointment', 'in_service')).toBe('Đang phục vụ');
    expect(statusLabel('checkoutTicket', 'READY_FOR_CHECKOUT')).toBe('Sẵn sàng thanh toán');
    expect(statusLabel('payment', 'unknown')).toBe('Chưa xác định');
    expect(statusLabel('payment', 'declined')).toBe('Thanh toán bị từ chối');
  });
  it('every canonical appointment status has a label (no humanised fallback)', () => {
    for (const s of APPOINTMENT_STATUSES) expect(statusLabelOrNull('appointment', s), s).not.toBeNull();
  });
  it('the code case does not matter (the API mixes READY / ready)', () => {
    expect(statusLabel('terminal', 'online')).toBe('Online');
    expect(statusLabel('checkoutTicket', 'ready_for_checkout')).toBe('Ready for Checkout');
  });
  it('several domains: the first that knows the code wins', async () => {
    await setLanguage('vi');
    expect(statusLabel(['payment', 'paymentAttempt'], 'timed_out')).toBe('Hết thời gian');
  });
  it('unknown code → humanised, never blank or a raw key; empty → empty', async () => {
    expect(statusLabel('appointment', 'SOME_NEW_STATE')).toBe('Some new state');
    expect(statusLabel('nope', 'x_y')).toBe('X y');
    await setLanguage('vi');
    expect(statusLabel('appointment', 'SOME_NEW_STATE')).toBe('Some new state');
    expect(statusLabel('appointment', null)).toBe('');
    expect(statusLabel('appointment', '')).toBe('');
    expect(statusLabelOrNull('appointment', 'SOME_NEW_STATE')).toBeNull();
    expect(humanizeCode('READY_FOR_CHECKOUT')).toBe('Ready for checkout');
  });
  it('a list of codes', async () => {
    await setLanguage('vi');
    expect(statusLabels('stock', ['low_stock', 'damaged', null])).toBe('Sắp hết hàng, Hư hỏng');
  });
  it('a technician label uses "Thợ" (Kevin\'s ruling), never "Kỹ thuật viên"', () => {
    expect(Object.values(STATUS_VI).filter((v) => /kỹ thuật viên|\bKTV\b/i.test(v))).toEqual([]);
  });
});
