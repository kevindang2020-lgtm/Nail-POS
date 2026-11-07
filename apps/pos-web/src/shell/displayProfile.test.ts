// SUNMI FLEX 3 mandates (Nov 6 2026): the density modes come from the usable CSS size, never from a device name.
import { describe, expect, it } from 'vitest';
import { densityFor, keyboardOpenFor, DISPLAY_PROFILES, measureDisplay, startDisplayProfile, displayProfile } from './displayProfile';

describe('densityFor', () => {
  it('certifies the SUNMI FLEX 3 27″ (DPR 1) and Windows 1920×1080 browser profiles as COMPACT', () => {
    for (const [w, h] of [[1920, 945], [1920, 952], [1920, 1032], [1920, 1080]]) expect(densityFor(w, h)).toBe('compact');
  });
  it('2560×1440 is COMFORTABLE; 1600×900 / 1366×768 / a DPR-1.5 Android panel are TIGHT; a phone is FALLBACK', () => {
    expect(densityFor(2560, 1440)).toBe('comfortable');
    expect(densityFor(1600, 900)).toBe('tight');
    expect(densityFor(1366, 768)).toBe('tight');
    expect(densityFor(1280, 592)).toBe('tight');
    expect(densityFor(820, 1180)).toBe('fallback');
  });
  it('every certified profile has a density and the list includes the SUNMI rows', () => {
    expect(DISPLAY_PROFILES.map((p) => p.id)).toEqual(expect.arrayContaining(['sunmi-flex3-chrome', 'sunmi-flex3-kiosk', 'sunmi-flex3-full', 'windows-1080-browser']));
  });
});

describe('keyboardOpenFor', () => {
  it('a large visual-viewport loss is the soft keyboard; small browser-bar changes are not', () => {
    expect(keyboardOpenFor(1032, 640)).toBe(true);
    expect(keyboardOpenFor(1032, 990)).toBe(false);
    expect(keyboardOpenFor(600, 470)).toBe(false);   // 130 px: below the 150 px floor
  });
});

describe('startDisplayProfile', () => {
  it('writes density / keyboard attributes on <html> without touching zoom or transform', () => {
    const stop = startDisplayProfile(window);
    const root = document.documentElement;
    expect(root.getAttribute('data-density')).toBe(densityFor(window.innerWidth, window.innerHeight));
    expect(root.getAttribute('data-keyboard')).toBe('closed');
    expect(root.style.getPropertyValue('--pos-vvh')).toMatch(/px$/);
    expect(root.style.zoom || '').toBe('');
    expect(root.style.transform || '').toBe('');
    expect(displayProfile()?.innerW).toBe(window.innerWidth);
    expect(measureDisplay().density).toBe(displayProfile()?.density);
    stop();
  });
});
