import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  registerCatalog, t, setLanguage, getLanguage, detectLanguage, initLanguage, resetI18nForTests, useT, currentLocale,
  catalogCoverage, I18N_STORAGE_KEY, onLanguageChange, setMissingKeyWarnings,
} from './i18n';
import { vi, afterEach } from 'vitest';

beforeEach(() => { resetI18nForTests(); try { localStorage.clear(); } catch { /* */ } });

describe('i18n — t()', () => {
  it('English is the default and returns TODAY\'s string for each key', () => {
    registerCatalog('en', { 'tab.home': 'Home', 'greet': 'Hi, {name}' });
    registerCatalog('vi', { 'tab.home': 'Trang chủ' });
    expect(getLanguage()).toBe('en');
    expect(t('tab.home')).toBe('Home');
    expect(t('greet', { name: 'Ana' })).toBe('Hi, Ana');
  });
  it('Vietnamese when chosen; a missing VI key falls back to the English text, never to the key', () => {
    registerCatalog('en', { 'tab.home': 'Home', 'tab.more': 'More' });
    registerCatalog('vi', { 'tab.home': 'Trang chủ' });
    setLanguage('vi');
    expect(t('tab.home')).toBe('Trang chủ');
    expect(t('tab.more')).toBe('More');
    expect(currentLocale()).toBe('vi-VN');
  });
  it('an unknown key returns the key (visible in QA, never a blank)', () => {
    expect(t('nope.missing')).toBe('nope.missing');
  });
  it('an unsupported language is ignored', () => {
    setLanguage('fr' as any);
    expect(getLanguage()).toBe('en');
  });
});

describe('i18n — choosing the language', () => {
  it('device language: vi-* → vi, anything else → en', () => {
    expect(detectLanguage('vi-VN')).toBe('vi');
    expect(detectLanguage('vi')).toBe('vi');
    expect(detectLanguage('en-US')).toBe('en');
    expect(detectLanguage('fr-FR')).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });
  it('order: the user\'s saved (server) choice > this device\'s last choice > device language > English', async () => {
    expect(await initLanguage({ device: 'vi-VN' })).toBe('vi');
    resetI18nForTests();
    localStorage.setItem(I18N_STORAGE_KEY, 'en');
    expect(await initLanguage({ device: 'vi-VN' })).toBe('en');
    resetI18nForTests();
    expect(await initLanguage({ device: 'en-US', load: async () => ({ language: 'vi' }) })).toBe('vi');
    resetI18nForTests();
    expect(await initLanguage({ device: 'vi-VN', load: async () => { throw new Error('offline'); } })).toBe('vi');
  });
  it('setLanguage persists on the device and to the server (persist injected)', async () => {
    const saved: string[] = [];
    await setLanguage('vi', { persist: async (l) => { saved.push(l); } });
    expect(localStorage.getItem(I18N_STORAGE_KEY)).toBe('vi');
    expect(saved).toEqual(['vi']);
  });
});

describe('i18n — React', () => {
  it('useT re-renders the screen when the language changes', () => {
    registerCatalog('en', { 'tab.home': 'Home' });
    registerCatalog('vi', { 'tab.home': 'Trang chủ' });
    function Tab() { const tr = useT(); return <span>{tr('tab.home')}</span>; }
    render(<Tab />);
    expect(screen.getByText('Home')).toBeTruthy();
    act(() => { void setLanguage('vi'); });
    expect(screen.getByText('Trang chủ')).toBeTruthy();
  });
});

describe('catalogue coverage', () => {
  it('reports VI keys / EN keys honestly', () => {
    registerCatalog('en', { a: 'A', b: 'B', c: 'C', d: 'D' });
    registerCatalog('vi', { a: 'Á', b: 'B́' });
    expect(catalogCoverage()).toEqual({ en: 4, vi: 2, missingVi: ['c', 'd'] });
  });
});

describe('shared catalogue', () => {
  it('every common key has a Vietnamese translation, and English is today\'s text', async () => {
    const { COMMON_EN, COMMON_VI } = await import('./common');
    expect(Object.keys(COMMON_EN).filter((k) => !(k in COMMON_VI))).toEqual([]);
    expect(COMMON_EN['common.welcomeBack']).toBe('Welcome Back');
    expect(COMMON_EN['nav.home']).toBe('Home');
  });
});

describe('missing-key warning (Vietnamese POS mandate §100)', () => {
  afterEach(() => { setMissingKeyWarnings(undefined); vi.restoreAllMocks(); });
  it('dev build: warns ONCE per language+key (missing everywhere / missing in Vietnamese); the fallback is unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMissingKeyWarnings(true);
    registerCatalog('en', { 'a.only.en': 'Only English' });
    expect(t('nope.missing')).toBe('nope.missing');
    expect(t('nope.missing')).toBe('nope.missing');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('nope.missing');
    await setLanguage('vi');
    expect(t('a.only.en')).toBe('Only English');
    expect(t('a.only.en')).toBe('Only English');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('vi');
  });
  it('production build: silent, same fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMissingKeyWarnings(false);
    expect(t('nope.missing2')).toBe('nope.missing2');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('onLanguageChange (non-React listeners)', () => {
  it('is called with the new language on each change and stops after unsubscribe', async () => {
    const seen: string[] = [];
    const off = onLanguageChange((l) => seen.push(l));
    await setLanguage('vi');
    await setLanguage('vi');   // no change → no call
    await setLanguage('en');
    off();
    await setLanguage('vi');
    expect(seen).toEqual(['vi', 'en']);
  });
});
