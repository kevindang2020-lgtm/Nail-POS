// TopSearch.test — Vietnamese POS mandate WP-E (§40–§41): the top-bar search is IME-safe. Typing "Nguyễn" with Telex never
// sends a search for a half-composed syllable; the composed word is searched once. Result group labels and status badges
// follow the language (instant switch, no module-level strings).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import '../i18n';

const global = vi.fn();
vi.mock('../api/posSearchApi', () => ({ posSearchApi: { global: (q: string) => global(q), recordOpen: () => Promise.resolve() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'OWNER' } }) }));

import { TopSearch } from './TopSearch';

const empty = { customers: [], appointments: [], queue: [], tickets: [], receipts: [], technicians: [], services: [] };
const box = () => screen.getByLabelText(/search this salon|tìm/i, { selector: 'input' }) as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  global.mockReset();
  global.mockResolvedValue({ groups: { ...empty, customers: [{ id: 'c1', type: 'customer', title: 'Nguyễn Thị Hương', badge: 'active' }], queue: [{ id: 'q1', type: 'queue_item', title: 'Đặng Minh Tuấn', badge: 'in_service' }] } });
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { vi.useRealTimers(); act(() => { setLanguage('en'); }); });

const flush = async () => { await act(async () => { vi.advanceTimersByTime(400); }); await act(async () => { await Promise.resolve(); }); };

describe('TopSearch — Vietnamese typing', () => {
  it('a Telex composition sends no search mid-composition and exactly one for the composed word', async () => {
    render(<MemoryRouter><TopSearch /></MemoryRouter>);
    const el = box();
    fireEvent.change(el, { target: { value: 'Ngu' } });
    await flush();
    global.mockClear();
    fireEvent.compositionStart(el);
    for (const s of ['Nguy', 'Nguye', 'Nguyee', 'Nguyê', 'Nguyên']) {
      fireEvent.change(el, { target: { value: s } });
      await act(async () => { vi.advanceTimersByTime(350); });   // longer than the debounce: a leak would search here
      fireEvent.keyDown(el, { key: 'Enter' });                    // the IME's own Enter must not search either
    }
    expect(global).not.toHaveBeenCalled();
    expect(el.value).toBe('Nguyên');
    fireEvent.change(el, { target: { value: 'Nguyễn' } });
    fireEvent.compositionEnd(el, { data: 'Nguyễn' });
    await flush();
    expect(global.mock.calls.map((c) => c[0])).toEqual(['Nguyễn']);
    expect(el.value).toBe('Nguyễn');
  });

  it('group labels and status badges follow the language', async () => {
    render(<MemoryRouter><TopSearch /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: 'nguyen' } });
    await flush();
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.getByText('Check-Ins & Queue')).toBeTruthy();
    act(() => { setLanguage('vi'); });
    expect(screen.getByText('Khách hàng')).toBeTruthy();
    expect(screen.getByText('Tiếp nhận & Hàng chờ')).toBeTruthy();
    expect(screen.queryByText('Customers')).toBeNull();
    expect(screen.getByText('Nguyễn Thị Hương')).toBeTruthy();   // names are never translated or folded on screen
  });
});
