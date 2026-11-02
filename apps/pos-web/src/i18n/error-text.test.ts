// error-text.test — English + Vietnamese POS mandate §22 / §23 (build plan WP-D1). Every API error code the server can send
// (ERROR_REGISTRY) has an English and a Vietnamese text; the English IS the registry's safe message; an unknown code shows
// the server's own message; the POS client throws the cashier's-language text and keeps the code.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import { setLanguage, t } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { errorText, apiErrorMessage, hasErrorText, localizedOr, errorTextOf } from './error-text';
import { readFileSync } from 'node:fs';
import { ERRORS_EN } from './ns/errors.en';
import { ERRORS_VI } from './ns/errors.vi';
import { posHttp, api, PosHttpError } from '../api/client';

afterEach(async () => { await setLanguage('en'); vi.restoreAllMocks(); });

const codes = Object.keys(ERROR_REGISTRY) as (keyof typeof ERROR_REGISTRY)[];

describe('every registry code is localized (§22)', () => {
  it('the registry is not empty and each code has errors.<CODE> in English = the registry message', () => {
    expect(codes.length).toBeGreaterThan(150);
    const en = ERRORS_EN as Record<string, string>;
    const missing = codes.filter((c) => !(`errors.${c}` in en));
    expect(missing).toEqual([]);
    const differ = codes.filter((c) => en[`errors.${c}`] !== ERROR_REGISTRY[c].message);
    expect(differ).toEqual([]);
  });
  it('each code has a non-empty Vietnamese text, shown when the POS is in Vietnamese', async () => {
    const viCat = ERRORS_VI as Record<string, string>;
    expect(codes.filter((c) => !viCat[`errors.${c}`]?.trim())).toEqual([]);
    await setLanguage('vi');
    for (const c of codes) {
      const text = errorText(c, null, 'SERVER');
      expect(text, c).toBe(viCat[`errors.${c}`]);
      expect(text, c).not.toMatch(/^errors\./);
    }
  });
  it('no Vietnamese error text uses a forbidden glossary variant (technician = "Thợ")', () => {
    const bad = Object.entries(ERRORS_VI).filter(([, v]) => /kỹ thuật viên|\bKTV\b|hàng đợi|biên nhận/i.test(v));
    expect(bad).toEqual([]);
  });
  it('the payment-safety codes carry the mandate §35 wording in Vietnamese', async () => {
    await setLanguage('vi');
    expect(errorText('PAYMENT_STATUS_UNKNOWN')).toBe('Trạng thái thanh toán chưa xác định. Không thanh toán lại. Hãy kiểm tra giao dịch trước.');
    expect(errorText('APPOINTMENT_CONFLICT')).toBe('Giờ này không còn trống.');
    expect(errorText('PAYMENT_DECLINED')).toBe('Thanh toán bị từ chối.');
  });
});

describe('fallbacks (§23): never a raw key, never blank', () => {
  it('an unknown code shows the server message in both languages', async () => {
    expect(errorText('NOT_A_REAL_CODE', null, 'Server said no.')).toBe('Server said no.');
    expect(hasErrorText('NOT_A_REAL_CODE')).toBe(false);
    await setLanguage('vi');
    expect(errorText('NOT_A_REAL_CODE', null, 'Server said no.')).toBe('Server said no.');
    expect(apiErrorMessage('NOT_A_REAL_CODE', null, 'Server said no.')).toBe('Server said no.');
  });
  it('apiErrorMessage: English keeps the server\'s specific text; Vietnamese shows the code\'s text', async () => {
    expect(apiErrorMessage('VALIDATION_FAILED', null, 'phone is required')).toBe('phone is required');
    expect(apiErrorMessage('VALIDATION_FAILED', null, '')).toBe('Some fields are invalid.');
    await setLanguage('vi');
    expect(apiErrorMessage('VALIDATION_FAILED', null, 'phone is required')).toBe('Một số thông tin không hợp lệ.');
  });
  it('nothing at all → a generic text, not blank', async () => {
    expect(apiErrorMessage(null, null, null)).toBe(t('errors.client.requestFailed'));
    await setLanguage('vi');
    expect(apiErrorMessage(undefined, undefined, '  ')).toBe('Yêu cầu không thành công.');
  });
  it('object details never become "[object Object]" in a message', () => {
    expect(errorText('CONFLICT', { nested: { a: 1 } as unknown as string })).not.toContain('[object Object]');
  });
});

describe('the POS client throws the localized message and keeps the code', () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => ({ ok: false, status, statusText: 'x', headers: { get: () => null }, json: async () => body })) as unknown as typeof fetch;
  it('posHttp: 409 APPOINTMENT_CONFLICT → Vietnamese text, code + status kept', async () => {
    globalThis.fetch = answer(409, { code: 'APPOINTMENT_CONFLICT', message: 'This time is no longer available.' });
    await setLanguage('vi');
    const e: any = await posHttp('/pos/booking/appointments').catch((x: any) => x);
    expect(e).toBeInstanceOf(PosHttpError);
    expect(e.message).toBe('Giờ này không còn trống.');
    expect(e.code).toBe('APPOINTMENT_CONFLICT');
    expect(e.status).toBe(409);
  });
  it('posHttp: the standard envelope error.code is read too; English keeps the server text', async () => {
    globalThis.fetch = answer(402, { error: { code: 'FEATURE_NOT_IN_PLAN', message: 'AI Upsell is not in your plan.' } });
    const e: any = await posHttp('/pos/x').catch((x: any) => x);
    expect(e.message).toBe('AI Upsell is not in your plan.');
    expect(e.code).toBe('FEATURE_NOT_IN_PLAN');
    await setLanguage('vi');
    const e2: any = await posHttp('/pos/x').catch((x: any) => x);
    expect(e2.message).toBe('Tính năng này không có trong gói của bạn.');
  });
  it('posHttp: an unknown code keeps the server\'s English in Vietnamese', async () => {
    globalThis.fetch = answer(400, { code: 'SOMETHING_NEW', message: 'Brand new failure.' });
    await setLanguage('vi');
    const e: any = await posHttp('/pos/x').catch((x: any) => x);
    expect(e.message).toBe('Brand new failure.');
  });
  it('api.get (request): the thrown error carries the localized message, the code and the server message', async () => {
    globalThis.fetch = answer(409, { error: { code: 'TECHNICIAN_ON_BREAK', message: 'This technician is on a break.' } });
    await setLanguage('vi');
    const e: any = await api.get('/pos/x').catch((x: any) => x);
    expect(e.message).toBe('Thợ này đang nghỉ.');
    expect(e.code).toBe('TECHNICIAN_ON_BREAK');
    expect(e.serverMessage).toBe('This technician is on a break.');
  });
});

// Vietnamese POS §2 / §21 / §58 (Oct 27 2026): a validation answer that names its field + rule is worded by the POS
describe('field + rule validation answers (§58)', () => {
  const v = (field: string, rule: string, params?: Record<string, unknown>) => ({ field, rule, ...(params ? { params } : {}), fields: [{ path: field, message: 'x', rule, ...(params ? { params } : {}) }] });
  it('"Phone is required" / "Bắt buộc nhập số điện thoại" — in both languages, the server English only as the fallback', async () => {
    expect(apiErrorMessage('VALIDATION_FAILED', v('phone', 'REQUIRED'), 'phone is required')).toBe('Phone is required.');
    await setLanguage('vi');
    expect(apiErrorMessage('VALIDATION_FAILED', v('phone', 'REQUIRED'), 'phone is required')).toBe('Bắt buộc nhập số điện thoại.');
    expect(apiErrorMessage('VALIDATION_FAILED', v('note', 'MAX_LENGTH', { max: 200 }), 'note must be at most 200 characters')).toBe('Ghi chú chỉ được tối đa 200 ký tự.');
    expect(apiErrorMessage('VALIDATION_FAILED', v('lines[0].priceCents', 'MIN', { min: 0 }), 'x')).toBe('Giá phải từ 0 trở lên.');
    expect(apiErrorMessage('VALIDATION_FAILED', { field: 'firstName', rule: 'REQUIRED_ONE_OF', params: { other: 'phone' } }, 'First name or phone is required')).toBe('Hãy nhập tên hoặc số điện thoại.');
    expect(apiErrorMessage('VALIDATION_FAILED', { field: 'language', rule: 'ENUM', params: { allowed: 'English, Tiếng Việt' } }, 'Choose English or Vietnamese.')).toBe('Ngôn ngữ phải là một trong: English, Tiếng Việt.');
  });
  it('a field the POS has no label for keeps today\'s wording (server English in English, the code\'s text in Vietnamese)', async () => {
    expect(apiErrorMessage('VALIDATION_FAILED', v('zzzUnknown', 'REQUIRED'), 'zzzUnknown is required')).toBe('zzzUnknown is required');
    await setLanguage('vi');
    expect(apiErrorMessage('VALIDATION_FAILED', v('zzzUnknown', 'REQUIRED'), 'zzzUnknown is required')).toBe(t('errors.VALIDATION_FAILED'));
  });
  it('the customer duplicate refusal by code (English keeps the server sentence with the name)', async () => {
    expect(apiErrorMessage('CUSTOMER_POSSIBLE_DUPLICATE', { name: 'Nguyễn Thị Hương' }, 'Possible duplicate of "Nguyễn Thị Hương"')).toBe('Possible duplicate of "Nguyễn Thị Hương"');
    await setLanguage('vi');
    expect(apiErrorMessage('CUSTOMER_POSSIBLE_DUPLICATE', { name: 'Nguyễn Thị Hương' }, 'Possible duplicate of "Nguyễn Thị Hương"')).toBe('Có thể trùng với một khách hàng đã có (cùng số điện thoại hoặc email). Hãy xem danh sách trùng hoặc gộp hồ sơ.');
  });
  it('end to end through posHttp: the standard envelope from ValidatedBody → the Vietnamese sentence, the code kept', async () => {
    await setLanguage('vi');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'VALIDATION_FAILED', message: 'phone is required', error: { code: 'VALIDATION_FAILED', message: 'phone is required', details: v('phone', 'REQUIRED') } }), { status: 400, headers: { 'content-type': 'application/json' } }) as any);
    const err: any = await posHttp('/pos/customers', { method: 'POST', body: '{}' }).catch((e) => e);
    expect(err).toBeInstanceOf(PosHttpError);
    expect(err.message).toBe('Bắt buộc nhập số điện thoại.');
    expect(err.code).toBe('VALIDATION_FAILED');
  });
});

// VietnamesePOS §22 / §58 (Oct 28 2026 audit): four API wrappers and seven errText helpers put the server's English body.message
// first, so a booking conflict or a refund refusal read in English on a Vietnamese screen.
describe('the server\'s English never replaces the screen\'s Vietnamese (§22 / §58)', () => {
  afterEach(() => setLanguage('en'));
  const body = { message: 'That time conflicts with another appointment.', code: 'SOME_UNKNOWN_CODE' };
  it('Vietnamese: an untranslated server sentence gives way to the screen\'s own Vietnamese', () => {
    setLanguage('vi');
    expect(localizedOr(body.message, body, 'Lịch bị trùng')).toBe('Lịch bị trùng');
    expect(errorTextOf(new PosHttpError(body.message, 409, body), 'Không lưu được')).toBe('Không lưu được');
  });
  it('Vietnamese: a message posHttp already translated (a known code) is kept', () => {
    setLanguage('vi');
    expect(localizedOr('Chưa thể hoàn tiền tại đây', body, 'x')).toBe('Chưa thể hoàn tiền tại đây');
  });
  it('English keeps the server\'s specific sentence; nothing at all falls back', () => {
    expect(localizedOr(body.message, body, 'Scheduling conflict')).toBe(body.message);
    expect(errorTextOf(null, 'Could not save')).toBe('Could not save');
    expect(errorTextOf({ message: '' }, 'Could not save')).toBe('Could not save');
  });
  it('no POS error path reads body.message ahead of the translated message', () => {
    const files = ['api/posBookingApi.ts', 'api/posTechAppointmentsApi.ts', 'api/posCheckInApi.ts', 'api/posLiveTechnicianScheduleApi.ts',
      'components/TicketRefundPanel.tsx', 'components/AuthSecurityPanels.tsx', 'components/RewardsCatalogPanel.tsx',
      'screens/POSSecurityScreen.tsx', 'screens/OAuthConsentScreen.tsx', 'screens/SecurityNotMeScreen.tsx'];
    const bad = files.filter((f) => /body\??\.message\s*(\|\||\?\?)/.test(readFileSync(new URL('../' + f, import.meta.url), 'utf8')));
    expect(bad).toEqual([]);
  });
});
