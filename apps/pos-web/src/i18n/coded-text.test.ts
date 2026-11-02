// coded-text.test.ts — Vietnamese POS §21 (Oct 27 2026): server text as code + vars is worded in the cashier's language;
// "@key" vars are references worded with the same vars, "@key#p0" with the p0_* vars; an unknown code falls back to the
// server's English (never blank, never a raw key); a switch re-words without new data.
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { codedText, hasCodedText } from './coded-text';

afterEach(async () => { await setLanguage('en'); });

describe('codedText', () => {
  it('words a known code in each language with its vars', async () => {
    const ct = { code: 'TURN_HEALTH.CUSTOMER_WAITING_TECHNICIAN_IDLE', vars: { minutes: 35, ready: 2 } };
    expect(codedText(ct, 'x')).toBe('A guest has waited 35 min while 2 technician(s) are ready.');
    await setLanguage('vi');
    expect(codedText(ct, 'x')).toBe('Có khách đã chờ 35 phút trong khi 2 thợ đang sẵn sàng.');
  });
  it('resolves "@key" references (status labels, nested sentences) with the same vars', async () => {
    await setLanguage('vi');
    expect(codedText({ code: 'TURN_EVENT.SKIP', vars: { name: 'Lan', reason: '@status.turnReason.ON_BREAK' } })).toBe('Lan bị bỏ qua — Đang nghỉ; giữ nguyên vị trí');
    expect(codedText({ code: 'FAIR_WHY.RULE', vars: { turns: '1.5', rule: '@srv.TURN_BASIS.LOWEST_TURNS' } })).toBe('Quy tắc: Ít lượt nhất: hôm nay 1.5 lượt');
  });
  it('resolves "@key#p0" with the prefixed vars only', async () => {
    await setLanguage('vi');
    const ct = { code: 'SERVING_REV.UPDATED_PARTS_1', vars: { service: 'Gel', p0: '@srv.SERVING_REV.PART_TECH#p0', p0_from: 'A', p0_to: 'B' } };
    expect(codedText(ct)).toBe('Đã cập nhật Gel: thợ A→B');
  });
  it('unknown code → the server English; no fallback → the humanised code; empty → fallback', async () => {
    await setLanguage('vi');
    expect(codedText({ code: 'BRAND_NEW.CODE' }, 'Server English')).toBe('Server English');
    expect(codedText({ code: 'BRAND_NEW.SOME_CODE' })).toBe('Some code');
    expect(codedText(null, 'Server English')).toBe('Server English');
    expect(codedText(undefined)).toBe('');
    expect(hasCodedText('TURN_BASIS.ROTATION')).toBe(true);
    expect(hasCodedText('NOPE')).toBe(false);
  });
});
