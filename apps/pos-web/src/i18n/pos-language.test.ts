// pos-language.test — Vietnamese POS mandate §8 / §13–§15 / §65 / §89 (WP-B): how the POS resolves, switches and saves the
// language. Order: the user's saved choice → the salon default (both answered by GET pos/me/locale) → English. No
// browser-language and no device-choice step for the POS. A switch is optimistic; a server refusal rolls it back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setLanguage, getLanguage, t, I18N_STORAGE_KEY } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { resolvePosLanguage, loadPosLanguage, switchPosLanguage, resetPosLanguage, resetPosLanguageForTests } from './pos-language';

beforeEach(async () => { await setLanguage('en'); resetPosLanguageForTests(); try { localStorage.clear(); } catch { /* */ } });
afterEach(async () => { vi.restoreAllMocks(); await setLanguage('en'); });

describe('resolution: user ?? salon default ?? English (§8)', () => {
  it('the server answer is user ?? salon default; nothing → English', () => {
    expect(resolvePosLanguage({ language: 'vi' })).toBe('vi');
    expect(resolvePosLanguage({ language: 'en' })).toBe('en');
    expect(resolvePosLanguage({ language: null })).toBe('en');
    expect(resolvePosLanguage({ language: 'fr' })).toBe('en');
    expect(resolvePosLanguage(null)).toBe('en');
  });
  it('a Vietnamese BROWSER and a device-cached "vi" never decide the POS language — the server answer does', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN');
    localStorage.setItem(I18N_STORAGE_KEY, 'vi');
    expect(await loadPosLanguage('u1', async () => ({ language: null }))).toBe('en');
    expect(getLanguage()).toBe('en');
    expect(await loadPosLanguage('u1', async () => ({ language: 'vi' }))).toBe('vi');
    expect(getLanguage()).toBe('vi');
  });
  it('salon default vi + a user who chose en → en (the server folds them; the client applies what it gets)', async () => {
    expect(await loadPosLanguage('u2', async () => ({ language: 'en', salonDefault: 'vi' } as any))).toBe('en');
  });
  it('offline at sign-in: the LAST SERVER ANSWER for this same user is used, never another user\'s, else English', async () => {
    await loadPosLanguage('u1', async () => ({ language: 'vi' }));
    await setLanguage('en');
    expect(await loadPosLanguage('u1', async () => { throw new TypeError('Failed to fetch'); })).toBe('vi');
    expect(await loadPosLanguage('u9', async () => { throw new TypeError('Failed to fetch'); })).toBe('en');
  });
  it('signed out → English', async () => {
    await setLanguage('vi');
    resetPosLanguage();
    expect(getLanguage()).toBe('en');
  });
  it('a server answer that arrives AFTER the person switched never overrides their tap', async () => {
    let answer!: (v: { language: 'en' | 'vi' }) => void;
    const pending = loadPosLanguage('u1', () => new Promise((r) => { answer = r; }));
    await switchPosLanguage('vi', { userId: 'u1', put: async () => ({}) });
    answer({ language: 'en' });
    await pending;
    expect(getLanguage()).toBe('vi');
  });
});

describe('switch + persistence (§6, §11, §13, §89)', () => {
  it('switches at once (before the save answers) and saves on the person\'s row', async () => {
    let finish!: () => void;
    const put = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const p = switchPosLanguage('vi', { userId: 'u1', put });
    await Promise.resolve();
    expect(getLanguage()).toBe('vi');                               // optimistic
    expect(put).toHaveBeenCalledWith('vi');
    finish();
    expect(await p).toEqual({ ok: true });
    expect(getLanguage()).toBe('vi');
    // the next sign-in offline on this register remembers it
    await setLanguage('en');
    expect(await loadPosLanguage('u1', async () => { throw new TypeError('offline'); })).toBe('vi');
  });
  it('the server REFUSING the save rolls back to the previous language', async () => {
    const r = await switchPosLanguage('vi', { userId: 'u1', put: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.previous).toBe('en');
    expect(getLanguage()).toBe('en');
  });
  it('a refusal that lands after a NEWER switch does not undo the newer one', async () => {
    let fail!: () => void;
    const slow = switchPosLanguage('vi', { userId: 'u1', put: () => new Promise((_, rej) => { fail = () => rej(Object.assign(new Error('x'), { status: 500 })); }) });
    await Promise.resolve();
    await switchPosLanguage('en', { userId: 'u1', put: async () => ({}) });
    await switchPosLanguage('vi', { userId: 'u1', put: async () => ({}) });
    fail();
    await slow;
    expect(getLanguage()).toBe('vi');
  });
  it('no network: the choice is kept (bundled catalogues, §89) and reported as pending', async () => {
    const r = await switchPosLanguage('vi', { userId: 'u1', put: async () => { throw new TypeError('Failed to fetch'); } });
    expect(r).toEqual({ ok: true, pending: true });
    expect(getLanguage()).toBe('vi');
  });
});

describe('document language + namespaces', () => {
  it('<html lang> follows every switch (§65)', async () => {
    await setLanguage('vi');
    expect(document.documentElement.lang).toBe('vi');
    await setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
  it('namespace catalogues (ns/*) are registered for both languages', async () => {
    expect(t('nav.language.menu', { current: 'English' })).toBe('Language: English');
    await setLanguage('vi');
    expect(t('nav.language.menu', { current: 'Tiếng Việt' })).toBe('Ngôn ngữ: Tiếng Việt');
    expect(t('nav.section.team')).toBe('NHÂN VIÊN');   // glossary Team = Nhân viên (WP-D1)
  });
});
