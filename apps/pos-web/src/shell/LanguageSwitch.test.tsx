// LanguageSwitch.test — the POS topbar's language selector (Vietnamese POS mandate §5–§7, §11, WP-B). Picking a language
// flips every t() string IN PLACE — no reload, no remount: a stateful probe mounted next to the switch keeps its state and
// re-renders in Vietnamese — and saves the choice on the person's login row (PUT pos/me/language). A server REFUSAL rolls
// the switch back and says so; an unreachable server keeps the choice (offline, §89).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { setLanguage, t, getLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import '../i18n';
import { LanguageSwitch } from './LanguageSwitch';
import { resetPosLanguageForTests } from '../i18n/pos-language';

const put = vi.fn((_p: string, _b?: Record<string, unknown>) => Promise.resolve({ language: 'vi' } as unknown));
vi.mock('../api/client', () => ({ api: { put: (p: string, b?: Record<string, unknown>) => put(p, b), get: vi.fn() } }));

beforeEach(async () => { await setLanguage('en'); put.mockClear(); resetPosLanguageForTests(); });
afterEach(async () => { await setLanguage('en'); });

const pick = (l: 'en' | 'vi') => { fireEvent.click(screen.getByTestId('language-switch')); fireEvent.click(screen.getByTestId(`language-option-${l}`)); };

let mounts = 0;
function Probe() {
  useLanguage();
  const [n, setN] = useState(0);
  const [mountId] = useState(() => ++mounts);
  return <div><button data-testid="inc" onClick={() => setN((x) => x + 1)}>{n}</button><span data-testid="mount">{mountId}</span><span data-testid="probe">{t('pos.services')}</span></div>;
}

describe('LanguageSwitch', () => {
  it('shows "English" with a globe, opens a menu of English / Tiếng Việt, switches in place and saves the choice', async () => {
    mounts = 0;
    render(<div><LanguageSwitch /><Probe /></div>);
    const btn = screen.getByTestId('language-switch');
    expect(screen.getByTestId('language-current').textContent).toBe('English');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByTestId('inc')); fireEvent.click(screen.getByTestId('inc'));
    fireEvent.click(btn);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByTestId('language-option-en').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('language-option-vi').textContent).toContain('Tiếng Việt');
    fireEvent.click(screen.getByTestId('language-option-vi'));
    await waitFor(() => expect(getLanguage()).toBe('vi'));
    expect(put).toHaveBeenCalledWith('/pos/me/language', { language: 'vi' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('language-current').textContent).toBe('Tiếng Việt');
    expect(screen.getByTestId('probe').textContent).toBe(t('pos.services'));
    expect(screen.getByTestId('probe').textContent).not.toBe('Services');
    // same component instance, same state: nothing reloaded or remounted
    expect(screen.getByTestId('inc').textContent).toBe('2');
    expect(screen.getByTestId('mount').textContent).toBe('1');
    expect(document.documentElement.lang).toBe('vi');
    pick('en');
    await waitFor(() => expect(getLanguage()).toBe('en'));
    expect(put).toHaveBeenLastCalledWith('/pos/me/language', { language: 'en' });
    expect(screen.getByTestId('probe').textContent).toBe('Services');
    expect(screen.getByTestId('inc').textContent).toBe('2');
    expect(document.documentElement.lang).toBe('en');
  });
  it('picking the language already shown does nothing (no save)', () => {
    render(<LanguageSwitch />);
    pick('en');
    expect(put).not.toHaveBeenCalled();
  });
  it('a key without a Vietnamese value falls back to English, never to a blank or the key', async () => {
    await setLanguage('vi');
    expect(t('pos.services')).toMatch(/\S/);
    expect(t('pos.services')).not.toBe('pos.services');
  });
  it('the server REFUSING the save rolls the switch back and says so (in the restored language)', async () => {
    put.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('nope'), { status: 400 })));
    render(<div><LanguageSwitch /><Probe /></div>);
    pick('vi');
    await waitFor(() => expect(screen.getByTestId('language-save-failed')).toBeTruthy());
    expect(getLanguage()).toBe('en');
    expect(screen.getByTestId('probe').textContent).toBe('Services');
    expect(screen.getByTestId('language-save-failed').textContent).toContain('English');
    expect(screen.getByTestId('language-save-failed').textContent).toContain('could not be saved');
  });
  it('an unreachable server (offline) keeps the choice and re-sends it when the connection returns', async () => {
    put.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<LanguageSwitch />);
    pick('vi');
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(getLanguage()).toBe('vi');
    expect(screen.queryByTestId('language-save-failed')).toBeNull();
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith('/pos/me/language', { language: 'vi' });
  });
  it('Escape closes the menu', () => {
    render(<LanguageSwitch />);
    fireEvent.click(screen.getByTestId('language-switch'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
