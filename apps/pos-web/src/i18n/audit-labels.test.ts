// audit-labels.test.ts — the audit-log action / module names (ns/audit.*, Vietnamese POS mandate Part 1c, Oct 27 2026):
// EN and VI carry the same keys, every VI label is Vietnamese (not the English copied over), auditActionLabel /
// auditModuleLabel read them in both languages, and an action with no label still shows humanised (never blank / raw).
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { AUDIT_EN } from './ns/audit.en';
import { AUDIT_VI } from './ns/audit.vi';
import { auditActionLabel, auditModuleLabel } from '../components/codeLabel';

afterEach(async () => { await setLanguage('en'); });

// actions a full pilot day writes (vi_pilot1, Oct 27 2026) — each must have a label in both languages
const PILOT_DAY_ACTIONS = ['CUSTOMER_GLOBAL_CREATED', 'adjustment.approved', 'cash.handed_off', 'check.issued', 'checkout_payment_claimed',
  'expense_created', 'mobile_payment_completed', 'period.paid', 'pos_booking_appointment_created', 'tap_to_pay_session_minted', 'password_changed'];

describe('audit labels', () => {
  it('EN and VI have the same keys; no VI label is the English copied over (except names kept as-is)', () => {
    expect(Object.keys(AUDIT_VI).sort()).toEqual(Object.keys(AUDIT_EN).sort());
    const same = Object.keys(AUDIT_EN).filter((k) => AUDIT_EN[k] === AUDIT_VI[k]);
    expect(same).toEqual(['admin.audit.module.ai']);
    expect(Object.keys(AUDIT_EN).length).toBeGreaterThanOrEqual(190);
  });

  it('labels the actions a pilot day writes, in both languages', async () => {
    for (const a of PILOT_DAY_ACTIONS) expect(AUDIT_EN[`admin.audit.action.${a}`], a).toBeTruthy();
    expect(auditActionLabel('period.paid')).toBe('Payroll period paid');
    expect(auditModuleLabel('payroll')).toBe('Payroll');
    await setLanguage('vi');
    expect(auditActionLabel('period.paid')).toBe('Đã trả kỳ lương');
    expect(auditActionLabel('pos_booking_appointment_created')).toBe('Đã đặt lịch hẹn tại POS');
    expect(auditModuleLabel('payroll')).toBe('Bảng lương');
  });

  it('an unlabelled action is humanised, an empty one is "Event"', async () => {
    expect(auditActionLabel('some_new.thing_happened')).toBe('Some New Thing Happened');
    await setLanguage('vi');
    expect(auditActionLabel('')).not.toBe('');
  });
});
