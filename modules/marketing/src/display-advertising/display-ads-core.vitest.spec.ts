// display-ads-core.vitest.spec.ts — the pure rules of customer-display advertising (23-inch dual-screen spec §51–§66,
// §75, §78, §110–§111): what an owner may save, when an ad is ACTIVE / showing, what a display plays, who manages what.
import { describe, it, expect } from 'vitest';
import {
  BLANK_AD_FIELDS, DisplayAdError, applyAdInput, applySettingsInput, assertTargeting, authorizedBranchIds, canManageAd, canSeeAd,
  changedFields, effectiveStatus, fnv1a, isShowingNow, nextScheduleChangeMs, parseBranchOverride, parsePlatformLimits,
  parseTenantAdSettings, resolvePlaylist, transition, validateQrUrl, type AdActor, type PlaylistAd, type PlaylistContext, type ScheduledAd,
} from './display-ads-core';

const B1 = '11111111-1111-4111-8111-111111111111', B2 = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const NY = 'America/New_York';
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e as DisplayAdError; } throw new Error('expected a DisplayAdError'); };

describe('applyAdInput — what an owner may save (§51, §53, §77)', () => {
  it('an image-only ad needs nothing but a name (simple mode §53)', () => {
    const f = applyAdInput(BLANK_AD_FIELDS, { name: 'Fall promo', mediaId: M1 }, { requireName: true });
    expect(f).toMatchObject({ name: 'Fall promo', mediaId: M1, headline: null, fitMode: 'cover', allBranches: true, branchIds: [], displayDurationSeconds: null });
  });
  it('a name is required', () => {
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, {}, { requireName: true }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'name' } });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: '   ' }, { requireName: true })).code).toBe('VALIDATION_FAILED');
  });
  it('text is trimmed and single-spaced; hidden and bidi characters are removed', () => {
    const f = applyAdInput(BLANK_AD_FIELDS, { name: '  Deluxe \n\t Pedicure ', headline: 'Relax\u200b • \u202eRefresh' });
    expect(f.name).toBe('Deluxe Pedicure');
    expect(f.headline).toBe('Relax • Refresh');
  });
  it('§77: markup is refused, never stored', () => {
    for (const bad of ['<script>alert(1)</script>', 'Hi <img src=x onerror=alert(1)>', '<iframe src="https://x.com">', '</b>']) {
      expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', headline: bad })).message).toMatch(/HTML/);
    }
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', headline: '$10 < $20 deal' }).headline).toBe('$10 < $20 deal');   // a lone "<" is text
  });
  it('length limits per field', () => {
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', headline: 'h'.repeat(61) })).message).toMatch(/60 characters/);
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', headline: 'h'.repeat(60) }).headline).toHaveLength(60);
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'n'.repeat(81) })).code).toBe('VALIDATION_FAILED');
  });
  it('G4: only the named fields are read — tenant, status, version or an id in the body change nothing', () => {
    const f = applyAdInput(BLANK_AD_FIELDS, { name: 'x', tenantId: 'other', tenant_id: 'other', status: 'published', version: 99, id: 'x', createdBy: 'me' } as any);
    expect(Object.keys(f).sort()).toEqual(Object.keys(BLANK_AD_FIELDS).sort());
    expect(f).not.toHaveProperty('status');
  });
  it('dates must be real calendar dates, start ≤ end — checked on the MERGED ad', () => {
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', startDate: '2026-02-30' })).details).toEqual({ field: 'startDate' });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', startDate: '2026-11-30', endDate: '2026-10-01' })).details).toEqual({ field: 'endDate' });
    const stored = applyAdInput(BLANK_AD_FIELDS, { name: 'x', startDate: '2026-10-10' });
    expect(err(() => applyAdInput(stored, { endDate: '2026-10-01' })).message).toMatch(/end date/);   // a patch that only names endDate
    expect(applyAdInput(stored, { startDate: null }).startDate).toBeNull();
  });
  it('days of week: deduped and sorted; none or all seven = every day (null)', () => {
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', daysOfWeek: [5, 1, 1, 3] }).daysOfWeek).toEqual([1, 3, 5]);
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', daysOfWeek: [] }).daysOfWeek).toBeNull();
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }).daysOfWeek).toBeNull();
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', daysOfWeek: [7] })).code).toBe('VALIDATION_FAILED');
  });
  it('daily hours: both or neither, start before end, normalized HH:MM', () => {
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', dailyStartTime: '9:05', dailyEndTime: '17:00' })).toMatchObject({ dailyStartTime: '09:05', dailyEndTime: '17:00' });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', dailyStartTime: '10:00' })).details).toEqual({ field: 'dailyEndTime' });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', dailyStartTime: '17:00', dailyEndTime: '10:00' })).message).toMatch(/after the start/);
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', dailyStartTime: '25:00', dailyEndTime: '26:00' })).code).toBe('VALIDATION_FAILED');
  });
  it('§59: display time 5–30 s or the salon default (null); priority 0–100', () => {
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', displayDurationSeconds: 8 }).displayDurationSeconds).toBe(8);
    for (const bad of [4, 31, 7.5, '10']) expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', displayDurationSeconds: bad })).details).toEqual({ field: 'displayDurationSeconds' });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', priority: 101 })).code).toBe('VALIDATION_FAILED');
  });
  it('§61: All branches clears the list; Selected needs at least one', () => {
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', allBranches: true, branchIds: [B1] }).branchIds).toEqual([]);
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', allBranches: false, branchIds: [B2, B1, B2] }).branchIds).toEqual([B1, B2].sort());
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', allBranches: false, branchIds: [] })).details).toEqual({ field: 'branchIds' });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', allBranches: false, branchIds: ['not-a-uuid'] })).code).toBe('VALIDATION_FAILED');
  });
  it('fit and focus point', () => {
    expect(applyAdInput(BLANK_AD_FIELDS, { name: 'x', fitMode: 'contain', focalX: 0.1234, focalY: 1 })).toMatchObject({ fitMode: 'contain', focalX: 0.123, focalY: 1 });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', fitMode: 'stretch' })).code).toBe('VALIDATION_FAILED');   // §54 never distort
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', focalX: 1.2 })).code).toBe('VALIDATION_FAILED');
  });
  it('changedFields compares content (arrays too)', () => {
    const a = applyAdInput(BLANK_AD_FIELDS, { name: 'x', daysOfWeek: [1, 2] });
    expect(changedFields(a, applyAdInput(a, { daysOfWeek: [2, 1] }))).toEqual([]);
    expect(changedFields(a, applyAdInput(a, { daysOfWeek: [1], headline: 'Hi' })).sort()).toEqual(['daysOfWeek', 'headline']);
  });
});

describe('§78 QR destinations are validated', () => {
  it('accepts a public https address and normalizes it', () => {
    expect(validateQrUrl('book_online', ' https://book.example.com/salon ')).toBe('https://book.example.com/salon');
  });
  it.each([
    ['http://example.com', /https/], ['javascript:alert(1)', /https/], ['https://user:pw@example.com', /user name/],
    ['https://127.0.0.1/x', /public/], ['https://localhost/x', /public/], ['https://intranet/x', /public/], ['https://printer.local', /public/],
    ['https://example.com:8443/x', /standard web port/], ['not a url', /full web address/], ['', /Enter/],
  ])('refuses %s', (url, why) => { expect(err(() => validateQrUrl('gift_cards', url)).message).toMatch(why); });
  it('an Instagram code must point at Instagram', () => {
    expect(validateQrUrl('instagram', 'https://www.instagram.com/yoursalon')).toMatch(/instagram\.com/);
    expect(err(() => validateQrUrl('instagram', 'https://evil.example.com/yoursalon')).message).toMatch(/instagram\.com/);
  });
  it('through applyAdInput: { kind, url } or null', () => {
    const f = applyAdInput(BLANK_AD_FIELDS, { name: 'x', qr: { kind: 'membership', url: 'https://salon.example.com/join' } });
    expect(f).toMatchObject({ qrKind: 'membership', qrUrl: 'https://salon.example.com/join' });
    expect(applyAdInput(f, { qr: null })).toMatchObject({ qrKind: null, qrUrl: null });
    expect(err(() => applyAdInput(BLANK_AD_FIELDS, { name: 'x', qr: { kind: 'tiktok', url: 'https://tiktok.com/x' } })).details).toEqual({ field: 'qr.kind' });
  });
});

describe('§64 statuses and §65 "backend resolves whether it should currently display" — in the salon\'s time zone', () => {
  const ad = (o: Partial<ScheduledAd> = {}): ScheduledAd => ({ status: 'published', mediaId: M1, startDate: null, endDate: null, daysOfWeek: null, dailyStartTime: null, dailyEndTime: null, ...o });
  // Thu 2026-10-01 03:30Z = Wed Sep 30 23:30 in New York
  const lateWedNY = new Date('2026-10-01T03:30:00Z');
  it('DRAFT / ARCHIVED / PAUSED / EXPIRED / SCHEDULED / ACTIVE', () => {
    expect(effectiveStatus(ad({ status: 'draft' }), NY, lateWedNY)).toBe('DRAFT');
    expect(effectiveStatus(ad({ status: 'archived' }), NY, lateWedNY)).toBe('ARCHIVED');
    expect(effectiveStatus(ad({ status: 'paused' }), NY, lateWedNY)).toBe('PAUSED');
    expect(effectiveStatus(ad({ status: 'paused', endDate: '2026-09-29' }), NY, lateWedNY)).toBe('EXPIRED');
    expect(effectiveStatus(ad({ endDate: '2026-09-29' }), NY, lateWedNY)).toBe('EXPIRED');
    expect(effectiveStatus(ad({ startDate: '2026-10-01' }), NY, lateWedNY)).toBe('SCHEDULED');
    expect(effectiveStatus(ad({ startDate: '2026-09-30', endDate: '2026-09-30' }), NY, lateWedNY)).toBe('ACTIVE');
  });
  it('the SALON\'s calendar decides, not the server\'s: Oct 1 has begun in UTC but not in New York', () => {
    expect(effectiveStatus(ad({ startDate: '2026-10-01' }), 'UTC', lateWedNY)).toBe('ACTIVE');
    expect(effectiveStatus(ad({ startDate: '2026-10-01' }), NY, lateWedNY)).toBe('SCHEDULED');
    expect(isShowingNow(ad({ daysOfWeek: [3] }), NY, lateWedNY)).toBe(true);    // still Wednesday in NY
    expect(isShowingNow(ad({ daysOfWeek: [3] }), 'UTC', lateWedNY)).toBe(false); // already Thursday in UTC
  });
  it('daily hours are [start, end) wall-clock', () => {
    const at = (iso: string) => new Date(iso);   // October: New York is UTC-4
    const a = ad({ dailyStartTime: '10:00', dailyEndTime: '17:00' });
    expect(isShowingNow(a, NY, at('2026-10-05T13:59:59Z'))).toBe(false);   // 09:59:59
    expect(isShowingNow(a, NY, at('2026-10-05T14:00:00Z'))).toBe(true);    // 10:00
    expect(isShowingNow(a, NY, at('2026-10-05T20:59:00Z'))).toBe(true);    // 16:59
    expect(isShowingNow(a, NY, at('2026-10-05T21:00:00Z'))).toBe(false);   // 17:00 — the end is exclusive
  });
  it('only a published ad with its image shows', () => {
    expect(isShowingNow(ad({ status: 'paused' }), NY, lateWedNY)).toBe(false);
    expect(isShowingNow(ad({ mediaId: null }), NY, lateWedNY)).toBe(false);
  });
  it('the next moment anything could change: today\'s start/end still ahead, else the salon\'s next midnight', () => {
    const now = new Date('2026-10-05T13:00:00Z');   // 09:00 New York
    expect(new Date(nextScheduleChangeMs([ad({ dailyStartTime: '10:00', dailyEndTime: '17:00' })], NY, now)!).toISOString()).toBe('2026-10-05T14:00:00.000Z');
    expect(new Date(nextScheduleChangeMs([ad({ endDate: '2026-10-31' })], NY, now)!).toISOString()).toBe('2026-10-06T04:00:00.000Z');   // NY midnight
    expect(nextScheduleChangeMs([ad()], NY, now)).toBeNull();                          // an always-on ad never changes by itself
    expect(nextScheduleChangeMs([ad({ status: 'paused', dailyStartTime: '10:00', dailyEndTime: '17:00' })], NY, now)).toBeNull();
  });
  it('across the autumn DST change the next midnight is still local midnight', () => {
    const now = new Date('2026-11-01T12:00:00Z');   // Nov 1 2026 (clocks went back at 2 am) — 07:00 EST
    expect(new Date(nextScheduleChangeMs([ad({ daysOfWeek: [1] })], NY, now)!).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('§110–§111 settings and platform limits', () => {
  it('salon settings: defaults, clamping, junk ignored', () => {
    expect(parseTenantAdSettings(null)).toEqual({ enabled: true, defaultDurationSeconds: 10, fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: 60 });
    expect(parseTenantAdSettings({ enabled: false, defaultDurationSeconds: 99, fullScreenIdleAfterSeconds: 5, fullScreenIdleAdsEnabled: 'yes' }))
      .toEqual({ enabled: false, defaultDurationSeconds: 30, fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: 30 });
    expect(parseTenantAdSettings('{"defaultDurationSeconds":12}').defaultDurationSeconds).toBe(12);
  });
  it('a branch can only switch OFF (layers are AND-ed)', () => {
    expect(parseBranchOverride({ enabled: true, fullScreenIdleAdsEnabled: false })).toEqual({ enabled: null, fullScreenIdleAdsEnabled: false });
    expect(applySettingsInput('branch', { enabled: false }, { enabled: true })).toEqual({});
    expect(applySettingsInput('branch', {}, { enabled: false })).toEqual({ enabled: false });
    expect(err(() => applySettingsInput('branch', {}, { defaultDurationSeconds: 12 })).message).toMatch(/salon-wide/);
    expect(err(() => applySettingsInput('branch', {}, { enabled: 'off' })).code).toBe('VALIDATION_FAILED');
  });
  it('tenant settings validate their ranges', () => {
    expect(applySettingsInput('tenant', { enabled: true }, { defaultDurationSeconds: 15, fullScreenIdleAdsEnabled: true, fullScreenIdleAfterSeconds: 45 }))
      .toEqual({ enabled: true, defaultDurationSeconds: 15, fullScreenIdleAdsEnabled: true, fullScreenIdleAfterSeconds: 45 });
    expect(err(() => applySettingsInput('tenant', {}, { defaultDurationSeconds: 3 })).code).toBe('VALIDATION_FAILED');
    expect(err(() => applySettingsInput('tenant', {}, { fullScreenIdleAfterSeconds: 600 })).code).toBe('VALIDATION_FAILED');
  });
  it('platform limits: code defaults, Super Admin values clamped, file types filtered to what is supported', () => {
    expect(parsePlatformLimits({})).toEqual({ maxAds: 50, maxFileBytes: 8 * 1024 * 1024, storageLimitBytes: 500 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], fullScreenIdleAllowed: true });
    const l = parsePlatformLimits({ 'display_ads.max_ads_per_tenant': 9999, 'display_ads.max_file_size_mb': 0, 'display_ads.allowed_mime_types': 'image/JPG, image/gif, text/html', 'display_ads.fullscreen_idle_allowed': false });
    expect(l).toMatchObject({ maxAds: 500, maxFileBytes: 1024 * 1024, allowedMimeTypes: ['image/jpeg'], fullScreenIdleAllowed: false });
    expect(parsePlatformLimits({ 'display_ads.allowed_mime_types': '' }).allowedMimeTypes).toEqual([]);   // Super Admin turned uploads off
    expect(parsePlatformLimits({ 'display_ads.allowed_mime_types': ['image/webp'] }).allowedMimeTypes).toEqual(['image/webp']);
  });
});

describe('§62–§63 who may manage what', () => {
  const owner: AdActor = { role: 'OWNER', branchId: B1, userId: 'u', tenantWide: true };
  const mgr: AdActor = { role: 'MANAGER', branchId: B1, userId: 'm', tenantWide: false };
  const all = { allBranches: true, branchIds: [] as string[] };
  const mine = { allBranches: false, branchIds: [B1] };
  const theirs = { allBranches: false, branchIds: [B2] };
  const both = { allBranches: false, branchIds: [B1, B2] };
  it('owners see and manage everything', () => {
    for (const t of [all, mine, theirs, both]) { expect(canSeeAd(t, owner)).toBe(true); expect(canManageAd(t, owner)).toBe(true); }
    expect(authorizedBranchIds(owner, [B1, B2])).toEqual([B1, B2]);
  });
  it('a branch manager sees what plays at their branch, manages only what plays ONLY there', () => {
    expect([all, mine, theirs, both].map((t) => canSeeAd(t, mgr))).toEqual([true, true, false, true]);
    expect([all, mine, theirs, both].map((t) => canManageAd(t, mgr))).toEqual([false, true, false, false]);
    expect(authorizedBranchIds(mgr, [B1, B2])).toEqual([B1]);
    expect(canManageAd(mine, { ...mgr, branchId: '' })).toBe(false);
  });
  it('targeting: the salon\'s own branches only; a manager cannot target all or another branch', () => {
    const own = new Set([B1, B2]);
    expect(() => assertTargeting(mine, mgr, own)).not.toThrow();
    expect(err(() => assertTargeting(all, mgr, own)).code).toBe('BRANCH_ACCESS_DENIED');
    expect(err(() => assertTargeting(both, mgr, own)).code).toBe('BRANCH_ACCESS_DENIED');
    expect(err(() => assertTargeting({ allBranches: false, branchIds: ['44444444-4444-4444-8444-444444444444'] }, owner, own)).code).toBe('VALIDATION_FAILED');
  });
});

describe('§64 transitions', () => {
  it.each([
    ['draft', 'publish', 'published'], ['paused', 'publish', 'published'], ['published', 'publish', null],
    ['published', 'pause', 'paused'], ['draft', 'pause', null],
    ['draft', 'archive', 'archived'], ['published', 'archive', 'archived'], ['archived', 'archive', null],
    ['archived', 'restore', 'draft'], ['published', 'restore', null],
  ] as const)('%s + %s → %s', (from, action, to) => { expect(transition(from, action)).toBe(to); });
});

describe('§58–§60, §79, §111 the playlist a display plays', () => {
  const now = new Date('2026-10-05T15:00:00Z');   // Mon 11:00 New York
  const media = (fx = 0.3, fy = 0.7) => ({ large: { url: '/media/l.webp', width: 1280, height: 1920 }, medium: { url: '/media/m.webp', width: 720, height: 1080 }, suggestedFocalX: fx, suggestedFocalY: fy });
  const pAd = (id: string, o: Partial<PlaylistAd> = {}): PlaylistAd => ({
    id, version: 1, status: 'published', mediaId: M1, startDate: null, endDate: null, daysOfWeek: null, dailyStartTime: null, dailyEndTime: null,
    fitMode: 'cover', focalX: 0.5, focalY: 0.5, headline: null, subheadline: null, description: null, ctaText: null, qrKind: null, qrUrl: null,
    displayDurationSeconds: null, priority: 0, publishedAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-30T00:00:00Z', media: media(), fullscreenMedia: null, ...o,
  });
  const ctx = (o: Partial<PlaylistContext> = {}): PlaylistContext => ({
    available: true, tenant: parseTenantAdSettings({}), branch: null, deviceAdsEnabled: true, fullScreenIdleAllowed: true, tz: NY, now, ...o,
  });

  it('the layers in order: platform/plan → salon → branch → display', () => {
    expect(resolvePlaylist([pAd('a')], ctx({ available: false, tenant: parseTenantAdSettings({ enabled: false }) })).offReason).toBe('not_available');
    expect(resolvePlaylist([pAd('a')], ctx({ tenant: parseTenantAdSettings({ enabled: false }), branch: { enabled: false, fullScreenIdleAdsEnabled: null } })).offReason).toBe('disabled_by_salon');
    expect(resolvePlaylist([pAd('a')], ctx({ branch: { enabled: false, fullScreenIdleAdsEnabled: null }, deviceAdsEnabled: false })).offReason).toBe('disabled_for_branch');
    const off = resolvePlaylist([pAd('a')], ctx({ deviceAdsEnabled: false }));
    expect(off).toMatchObject({ enabled: false, offReason: 'disabled_for_display', ads: [] });
    expect(resolvePlaylist([pAd('a')], ctx({ deviceAdsEnabled: null })).enabled).toBe(true);   // the POS preview has no device layer
  });
  it('plays only what is showing now, highest priority first, then oldest published', () => {
    const p = resolvePlaylist([
      pAd('late', { publishedAt: '2026-10-03T00:00:00Z' }), pAd('early', { publishedAt: '2026-10-02T00:00:00Z' }), pAd('vip', { priority: 5, publishedAt: '2026-10-04T00:00:00Z' }),
      pAd('evening', { dailyStartTime: '18:00', dailyEndTime: '21:00' }), pAd('paused', { status: 'paused' }), pAd('noimage', { media: null }),
    ], ctx());
    expect(p.ads.map((a) => a.id)).toEqual(['vip', 'early', 'late']);
  });
  it('the display gets only what it renders, with resolved durations and focus', () => {
    const p = resolvePlaylist([
      pAd('a', { displayDurationSeconds: 8, qrKind: 'gift_cards', qrUrl: 'https://salon.example.com/gift', headline: 'Gift cards' }),
      pAd('b', { fitMode: 'smart_crop', focalX: 0.1, focalY: 0.1 }),
    ], ctx({ tenant: parseTenantAdSettings({ defaultDurationSeconds: 12 }) }));
    expect(p.ads[0]).toEqual({
      id: 'a', version: 1, image: { url: '/media/m.webp', width: 720, height: 1080 }, imageLarge: { url: '/media/l.webp', width: 1280, height: 1920 }, fullscreenImage: null,
      fit: 'cover', focalX: 0.5, focalY: 0.5, headline: 'Gift cards', subheadline: null, description: null, ctaText: null,
      qr: { label: 'Gift cards', url: 'https://salon.example.com/gift' }, durationSeconds: 8,
    });
    expect(p.ads[1]).toMatchObject({ fit: 'smart_crop', focalX: 0.3, focalY: 0.7, durationSeconds: 12 });   // smart crop uses the IMAGE's point of interest
    expect(Object.keys(p.ads[0])).not.toContain('name');
  });
  it('§7 full-screen idle needs the platform, the salon AND the branch', () => {
    const on = parseTenantAdSettings({ fullScreenIdleAdsEnabled: true, fullScreenIdleAfterSeconds: 45 });
    expect(resolvePlaylist([pAd('a')], ctx({ tenant: on })).fullScreenIdle).toEqual({ enabled: true, afterSeconds: 45 });
    expect(resolvePlaylist([pAd('a')], ctx({ tenant: on, fullScreenIdleAllowed: false })).fullScreenIdle.enabled).toBe(false);
    expect(resolvePlaylist([pAd('a')], ctx({ tenant: on, branch: { enabled: null, fullScreenIdleAdsEnabled: false } })).fullScreenIdle.enabled).toBe(false);
    expect(resolvePlaylist([pAd('a')], ctx()).fullScreenIdle.enabled).toBe(false);   // default OFF
  });
  it('refreshAfterSeconds: when the next schedule boundary is, within 5 s … 15 min', () => {
    expect(resolvePlaylist([pAd('a', { dailyStartTime: '11:00', dailyEndTime: '11:10' })], ctx()).refreshAfterSeconds).toBe(601);
    expect(resolvePlaylist([pAd('a', { dailyStartTime: '11:00', dailyEndTime: '11:30' })], ctx()).refreshAfterSeconds).toBe(900);   // capped at 15 min
    expect(resolvePlaylist([pAd('a')], ctx()).refreshAfterSeconds).toBe(900);
    expect(resolvePlaylist([pAd('a', { dailyStartTime: '09:00', dailyEndTime: '11:00' })], ctx({ now: new Date('2026-10-05T14:59:58Z') })).refreshAfterSeconds).toBe(5);
  });
  it('§72/§114 validUntil: an offline display trusts its saved list only until the next schedule boundary (uncapped)', () => {
    // 11:00 New York: the 11:00–11:30 window ends at 11:30 (15:30Z) — the refresh is capped at 15 min, validity is not
    expect(resolvePlaylist([pAd('a', { dailyStartTime: '11:00', dailyEndTime: '11:30' })], ctx()).validUntil).toBe('2026-10-05T15:30:00.000Z');
    // a dated ad changes at the salon's midnight (04:00Z the next day in New York, EDT)
    expect(resolvePlaylist([pAd('a', { endDate: '2026-10-31' })], ctx()).validUntil).toBe('2026-10-06T04:00:00.000Z');
    // nothing scheduled: the list changes only when the salon edits it
    expect(resolvePlaylist([pAd('a')], ctx()).validUntil).toBeNull();
    // ads switched off: nothing to keep playing
    expect(resolvePlaylist([pAd('a', { dailyStartTime: '11:00', dailyEndTime: '11:30' })], ctx({ deviceAdsEnabled: false })).validUntil).toBeNull();
  });
  it('playlistVersion changes when anything rendered changes, not otherwise', () => {
    const v = (ads: PlaylistAd[], c = ctx()) => resolvePlaylist(ads, c).playlistVersion;
    const base = v([pAd('a'), pAd('b')]);
    expect(v([pAd('a'), pAd('b')])).toBe(base);
    expect(v([pAd('a', { version: 2 }), pAd('b')])).not.toBe(base);
    expect(v([pAd('a'), pAd('b')], ctx({ tenant: parseTenantAdSettings({ defaultDurationSeconds: 11 }) }))).not.toBe(base);
    expect(v([pAd('a'), pAd('b', { priority: 9 })])).not.toBe(base);   // rotation order changed
    expect(v([pAd('a', { priority: 9 }), pAd('b')])).toBe(base);        // same order, same render → same version
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
  });
});
