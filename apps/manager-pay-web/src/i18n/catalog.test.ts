// catalog.test — POSLanguage.pdf §1 / §20 / §29–§30 (Oct 28 2026): the Tap to Pay app is ENGLISH ONLY, enforced at bootstrap
// (src/language-policy.ts), not by a hidden toggle. Only the Front Desk POS is bilingual. These tests FAIL if Vietnamese
// text can appear in this app through the catalogue, a switch call, a server answer, a saved device choice or a vi-VN device.
import { describe, it, expect, afterEach } from 'vitest';
import '../language-policy';
import * as catalog from './catalog';
import { PAY_EN } from './catalog';
import { t, setLanguage, getLanguage, initLanguage, languagePolicy, catalogFor, I18N_STORAGE_KEY } from '@aipowersalon/mobile-sdk/i18n';

afterEach(() => { try { localStorage.removeItem(I18N_STORAGE_KEY); } catch { /* none */ } });

describe('Tap to Pay app: English only', () => {
  it('the app policy is English only and no Vietnamese catalogue is mounted or exported', () => {
    expect(languagePolicy()).toEqual(['en']);
    expect(Object.keys(catalogFor('vi'))).toEqual([]);
    expect(Object.keys(catalog).filter((k) => /_VI$/.test(k))).toEqual([]);
  });
  it('a switch to Vietnamese is refused — the text stays English', async () => {
    const [k, en] = Object.entries(PAY_EN)[0];
    await setLanguage('vi');
    expect(getLanguage()).toBe('en');
    expect(t(k)).toBe(en);
  });
  it('a server answer of Vietnamese, a saved device choice and a vi-VN device all leave it English', async () => {
    try { localStorage.setItem(I18N_STORAGE_KEY, 'vi'); } catch { /* no storage */ }
    expect(await initLanguage({ device: 'vi-VN', load: async () => ({ language: 'vi' as const }) })).toBe('en');
    expect(await initLanguage({ device: 'vi-VN' })).toBe('en');
    expect(getLanguage()).toBe('en');
    if (typeof document !== 'undefined') expect(document.documentElement.lang).toBe('en');
  });
});
