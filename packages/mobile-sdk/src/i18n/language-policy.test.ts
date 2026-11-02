// language-policy.test — POSLanguage.pdf §20 (Oct 28 2026): the shared translation layer enforces each application's
// language policy at bootstrap. The Front Desk POS keeps English + Vietnamese; an English-only app can never show Vietnamese
// — not by a switch, a server answer, a saved device choice, a vi-VN device, or a catalogue registered after start.
import { describe, it, expect, beforeEach } from 'vitest';
import { APPLICATION_LOCALE_POLICY, resolveApplicationLocale, resolveFrontDeskPosLocale } from '@aipowersalon/api-contracts';
import { registerCatalog, setLanguagePolicy, languagePolicy, setLanguage, getLanguage, initLanguage, t, catalogFor, resetI18nForTests } from './i18n';

beforeEach(() => { resetI18nForTests(); });

describe('application language policy', () => {
  it('the matrix: only the Front Desk POS is bilingual', () => {
    expect(APPLICATION_LOCALE_POLICY.FRONT_DESK_POS).toEqual(['en', 'vi']);
    for (const [app, langs] of Object.entries(APPLICATION_LOCALE_POLICY)) if (app !== 'FRONT_DESK_POS') expect(langs, app).toEqual(['en']);
  });
  it('POS resolution: the person\'s POS choice → the salon default → English; every other app → English', () => {
    expect(resolveFrontDeskPosLocale({ userPosLocale: 'vi', tenantDefaultPosLocale: 'en' })).toBe('vi');
    expect(resolveFrontDeskPosLocale({ userPosLocale: null, tenantDefaultPosLocale: 'vi' })).toBe('vi');
    expect(resolveFrontDeskPosLocale({})).toBe('en');
    expect(resolveFrontDeskPosLocale({ userPosLocale: 'fr', tenantDefaultPosLocale: 'xx' })).toBe('en');
    for (const app of ['CUSTOMER_APP', 'TECHNICIAN_APP', 'OWNER_APP', 'TAP_TO_PAY_APP', 'SUPER_ADMIN', 'ONLINE_BOOKING', 'CUSTOMER_DISPLAY', 'CHECK_IN_KIOSK'] as const) expect(resolveApplicationLocale(app, 'vi'), app).toBe('en');
    expect(resolveApplicationLocale('FRONT_DESK_POS', 'vi')).toBe('vi');
  });
  it('the POS (both languages) still switches in place', async () => {
    setLanguagePolicy(APPLICATION_LOCALE_POLICY.FRONT_DESK_POS);
    registerCatalog('en', { 'x.hello': 'Hello' }); registerCatalog('vi', { 'x.hello': 'Xin chào' });
    await setLanguage('vi');
    expect(getLanguage()).toBe('vi'); expect(t('x.hello')).toBe('Xin chào');
  });
  it('an English-only app: a Vietnamese catalogue is never mounted and no path leaves English', async () => {
    registerCatalog('vi', { 'x.hello': 'Xin chào' });   // registered BEFORE the policy (an import-order slip) — dropped by it
    await setLanguage('vi');
    setLanguagePolicy(APPLICATION_LOCALE_POLICY.CUSTOMER_APP);
    expect(getLanguage()).toBe('en');                   // a Vietnamese language already applied is undone
    expect(Object.keys(catalogFor('vi'))).toEqual([]);
    registerCatalog('en', { 'x.hello': 'Hello' }); registerCatalog('vi', { 'x.hello': 'Xin chào' });
    expect(Object.keys(catalogFor('vi'))).toEqual([]);
    await setLanguage('vi');
    expect(getLanguage()).toBe('en'); expect(t('x.hello')).toBe('Hello');
    expect(await initLanguage({ device: 'vi-VN', load: async () => ({ language: 'vi' }) })).toBe('en');
    expect(languagePolicy()).toEqual(['en']);
  });
});
