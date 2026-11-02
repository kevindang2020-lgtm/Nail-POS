// v5-coded-refusals.vi.test — Vietnamese POS §2 / §21 / §58 (V-5 all modules, Oct 27 2026). A refusal the server threw with
// withCode(…) answers its registry code (as `code`, or in details.messageCode when the route keeps a legacy kind a screen
// branches on); the POS shows the Vietnamese text of that code — never the server's English — and keeps `code` for branching.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { posHttp } from '../api/client';
import { apiErrorMessage } from './error-text';
import { ERRORS_VI } from './ns/errors.vi';
import { ERRORS_EN } from './ns/errors.en';

afterEach(async () => { await setLanguage('en'); vi.restoreAllMocks(); });
const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) as any);

/** a screen-like consumer: it calls the API and shows the failure the way POS screens do (the thrown message) */
function RefusalBanner({ path }: { path: string }) {
  const [msg, setMsg] = useState('');
  useEffect(() => { posHttp(path).catch((e: Error) => setMsg(e.message)); }, [path]);
  return <div role="alert">{msg}</div>;
}

describe('V-5: a coded refusal renders in Vietnamese', () => {
  it('a converted "Ticket not found" (route answers 400 with the sentence; the filter adds the code) renders "Không tìm thấy hóa đơn này."', async () => {
    reply(400, { code: 'TICKET_NOT_FOUND', message: 'Ticket not found', error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found', details: { messageCode: 'TICKET_NOT_FOUND' } } });
    await setLanguage('vi');
    render(<RefusalBanner path="/pos/checkout/tickets/t404" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Không tìm thấy hóa đơn này.'));
    expect(screen.getByRole('alert').textContent).not.toContain('Ticket not found');
  });
  it('a legacy kind stays the code (screens branch on it) while details.messageCode words the message, with its params', async () => {
    reply(409, { ok: false, code: 'stale_record', message: 'Category has 3 active service(s). Confirm to archive.', error: { code: 'stale_record', message: 'x', details: { messageCode: 'CATEGORY_HAS_SERVICES', count: 3 } } });
    await setLanguage('vi');
    const e: any = await posHttp('/pos/services/categories/c1').catch((x) => x);
    expect(e.code).toBe('stale_record');
    expect(e.message).toBe('Danh mục này còn 3 dịch vụ đang hoạt động. Hãy xác nhận để lưu trữ.');
  });
  it('English keeps the server sentence; an unknown messageCode falls back to the answer code', async () => {
    expect(apiErrorMessage('BAD_REQUEST', { messageCode: 'TICKET_NOT_FOUND' }, 'Ticket not found')).toBe('Ticket not found');
    await setLanguage('vi');
    expect(apiErrorMessage('PAYMENT_DECLINED', { messageCode: 'NOT_A_CODE' }, 'Card segment was declined')).toBe('Thanh toán bị từ chối.');
  });
  it('every V-5 code has English (= the registry sentence) and Vietnamese with the same {placeholders}', () => {
    const en = ERRORS_EN as Record<string, string>; const vi_ = ERRORS_VI as Record<string, string>;
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const code of Object.keys(ERROR_REGISTRY)) {
      expect(en[`errors.${code}`], code).toBe((ERROR_REGISTRY as any)[code].message);
      expect(vi_[`errors.${code}`]?.trim(), code).toBeTruthy();
      expect(ph(vi_[`errors.${code}`]), code).toBe(ph(en[`errors.${code}`]));
    }
  });
});
