import { describe, expect, it } from 'vitest';
import {
  nextAverage, profileCompletionPercent, reviewerDisplayName, sanitizeProfileLinks, sanitizeRatingTags,
  sanitizeText, slugify, sniffImageType, techRankingScore, validateExternalUrl, validateImageUpload,
  sanitizeLinkVisibility, visibleLinksFor,
  sanitizePortfolioTaxonomy,
  sanitizeConsentUses, consentAllowsPublic,
} from './tech-profile-core';

describe('tech-profile-core', () => {
  it('external links: http/https only — javascript:, data:, bare strings all rejected', () => {
    expect(validateExternalUrl('https://linkme.bio/mia')).toBe('https://linkme.bio/mia');
    expect(validateExternalUrl('http://instagram.com/mia.nails')).toContain('instagram.com');
    expect(validateExternalUrl('javascript:alert(1)')).toBeNull();
    expect(validateExternalUrl('data:text/html,hi')).toBeNull();
    expect(validateExternalUrl('ftp://x.com/a')).toBeNull();
    expect(validateExternalUrl('linkme.bio/mia')).toBeNull();
    expect(validateExternalUrl('https://localhost')).toBeNull();
    const links = sanitizeProfileLinks({ linkme: 'https://linkme.bio/mia', tiktok: 'javascript:bad()', evil: 'https://x.com', instagram: 'https://instagram.com/mia' });
    expect(Object.keys(links).sort()).toEqual(['instagram', 'linkme']);
  });

  it('link host policy: labeled platforms must point to their real domain; aggregators/websites accept any https', () => {
    const ok = sanitizeProfileLinks({
      instagram: 'https://www.instagram.com/mia', tiktok: 'https://tiktok.com/@mia',
      facebook: 'https://facebook.com/mia', youtube: 'https://youtu.be/abc', pinterest: 'https://pin.it/xyz',
      website: 'https://mia-nails.example.com', linktree: 'https://anything.example',
    });
    expect(Object.keys(ok).sort()).toEqual(['facebook', 'instagram', 'linktree', 'pinterest', 'tiktok', 'website', 'youtube']);
    // Mislabeled: an "instagram" link pointing at a lookalike host is dropped, not shown under the Instagram icon.
    expect(sanitizeProfileLinks({ instagram: 'https://evil-instagram.com/mia' })).toEqual({});
    expect(sanitizeProfileLinks({ youtube: 'https://instagram.com/mia' })).toEqual({});
  });

  it('link visibility: only public/booked_only/hidden on allowed keys; bad values & unknown keys dropped', () => {
    const vis = sanitizeLinkVisibility({ instagram: 'public', linkme: 'booked_only', tiktok: 'hidden', website: 'sometimes', evil: 'public' });
    expect(vis).toEqual({ instagram: 'public', linkme: 'booked_only', tiktok: 'hidden' });
    expect(sanitizeLinkVisibility(null)).toEqual({});
  });

  it('visibleLinksFor: owner sees all; booked sees public+booked_only; public sees public; default=public', () => {
    const links = { instagram: 'https://instagram.com/mia', linkme: 'https://linkme.bio/mia', tiktok: 'https://tiktok.com/@mia', website: 'https://mia.example.com' };
    const vis = { linkme: 'booked_only', tiktok: 'hidden' } as Record<string, 'public' | 'booked_only' | 'hidden'>; // instagram & website unset ⇒ public
    expect(visibleLinksFor(links, vis, 'owner')).toEqual(links);
    expect(Object.keys(visibleLinksFor(links, vis, 'public')).sort()).toEqual(['instagram', 'website']);
    expect(Object.keys(visibleLinksFor(links, vis, 'booked')).sort()).toEqual(['instagram', 'linkme', 'website']);
    expect(visibleLinksFor(links, vis, 'booked').tiktok).toBeUndefined(); // hidden never shows to non-owner
  });

  it('portfolio taxonomy: enum dims validated, free-text dims sanitized & clamped, junk dropped', () => {
    const t = sanitizePortfolioTaxonomy({ nailShape: 'Almond', nailLength: 'Long', complexity: 'Detailed', designStyle: 'Chrome <b>ombré</b>', brand: 'Apres Gel-X', colorName: 'Nude' });
    expect(t).toEqual({ nailShape: 'Almond', nailLength: 'Long', complexity: 'Detailed', designStyle: 'Chrome ombré', brand: 'Apres Gel-X', colorName: 'Nude' });
    const bad = sanitizePortfolioTaxonomy({ nailShape: 'Triangle', nailLength: 'Huge', complexity: 'Wild', designStyle: '', brand: null, colorName: 123 });
    expect(bad).toEqual({ nailShape: null, nailLength: null, complexity: null, designStyle: null, brand: null, colorName: null });
  });

  it('photo consent: only known uses kept; public allowed only when not revoked & a public use granted', () => {
    expect(sanitizeConsentUses(['portfolio', 'social_marketing', 'hack', 42, 'portfolio'])).toEqual(['portfolio', 'social_marketing']);
    expect(consentAllowsPublic(['portfolio'], false)).toBe(true);
    expect(consentAllowsPublic(['all'], false)).toBe(true);
    expect(consentAllowsPublic(['portfolio'], true)).toBe(false);      // withdrawn ⇒ never public
    expect(consentAllowsPublic(['private_only'], false)).toBe(false);  // private-only ⇒ not public
    expect(consentAllowsPublic([], false)).toBe(false);
  });

  it('slugify: diacritics flattened, safe charset, suffix appended', () => {
    expect(slugify('Mia Trần — Nail Artist!', 'a1b2')).toBe('mia-tran-nail-artist-a1b2');
    expect(slugify('   ')).toBe('tech');
  });

  it('sanitizeText strips tags and clamps', () => {
    expect(sanitizeText('<script>x</script>Great   work!')).toBe('Great work!');
    expect(sanitizeText(12 as any)).toBeNull();
  });

  it('profile completion uses the exact documented weights', () => {
    expect(profileCompletionPercent({ avatarUrl: 'a.jpg', bio: 'I love nail art and design', portfolioPhotoCount: 3, servicesCount: 4, specialtiesCount: 2, linksCount: 1 })).toBe(100);
    expect(profileCompletionPercent({ avatarUrl: null, bio: null, portfolioPhotoCount: 2, servicesCount: 0, specialtiesCount: 0, linksCount: 0 })).toBe(0);
    expect(profileCompletionPercent({ avatarUrl: 'a.jpg', bio: 'Experienced gel specialist', portfolioPhotoCount: 5, servicesCount: 3, specialtiesCount: 0, linksCount: 0 })).toBe(85);
  });

  it('reviewer privacy: first name + last initial, or anonymous', () => {
    expect(reviewerDisplayName('Jessica Lopez')).toBe('Jessica L.');
    expect(reviewerDisplayName('Sophia')).toBe('Sophia');
    expect(reviewerDisplayName('Jessica Lopez', true)).toBe('Anonymous Customer');
    expect(reviewerDisplayName('')).toBe('Anonymous Customer');
  });

  it('rating math + tag whitelist', () => {
    expect(nextAverage(null, 0, 5)).toEqual({ avg: 5, count: 1 });
    expect(nextAverage(4.8, 300, 1).avg).toBe(4.79);
    expect(sanitizeRatingTags(['Friendly', 'HACK', 'Fast', 7 as any])).toEqual(['Friendly', 'Fast']);
  });

  it('balanced ranking: one 5★ review does NOT outrank 300 reviews at 4.8', () => {
    const newbie = techRankingScore({ ratingAverage: 5, ratingCount: 1, verifiedCompletedServices: 1, portfolioPhotoCount: 1, hasAvatar: true, hasBio: false, distanceMiles: 1, nextAvailableMinutes: 60 });
    const veteran = techRankingScore({ ratingAverage: 4.8, ratingCount: 300, verifiedCompletedServices: 400, portfolioPhotoCount: 12, hasAvatar: true, hasBio: true, distanceMiles: 3, nextAvailableMinutes: 60 });
    expect(veteran).toBeGreaterThan(newbie);
    const far = techRankingScore({ ratingAverage: 4.8, ratingCount: 300, verifiedCompletedServices: 400, portfolioPhotoCount: 12, hasAvatar: true, hasBio: true, distanceMiles: 30, nextAvailableMinutes: 60 });
    expect(veteran).toBeGreaterThan(far); // distance matters but cannot zero out a strong profile
    expect(far).toBeGreaterThan(newbie);
  });

  it('image sniffing: real magic bytes only, executables refused', () => {
    expect(sniffImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]))).toBe('jpg');
    expect(sniffImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]))).toBe('png');
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]))).toBe('webp');
    expect(sniffImageType(Buffer.from('MZ\x90\x00 totally an exe padded to length'))).toBeNull();
    const big = validateImageUpload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(10 * 1024 * 1024 + 10)]), 'avatar');   // cap is 10MB since the Sep 2026 merge
    expect(big.ok).toBe(false);
    const fine = validateImageUpload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]), 'avatar');
    expect(fine).toEqual({ ok: true, ext: 'png' });
  });
});
