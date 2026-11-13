// boardMode.test — the per-person "Classic board" switch, and the board's words: every key the package asks for exists in
// the POS bsb namespace in English AND Vietnamese (never the package's English fallback at the front desk).
import { describe, it, expect } from 'vitest';
import { BOARD_TEXT_EN } from '@aipowersalon/booking-schedule-board';
import { BSB_EN } from '../../i18n/ns/bsb.en';
import { BSB_VI } from '../../i18n/ns/bsb.vi';
import { boardModeKey, readBoardMode, saveBoardMode, BOOKING_BOARD_DEFAULT } from './boardMode';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('Classic board switch (per person, remembered on this device)', () => {
  it('defaults to the new board; a saved choice is per tenant + user', () => {
    const store = mem();
    expect(BOOKING_BOARD_DEFAULT).toBe('new');
    const kevin = boardModeKey('salon-1', 'u-1'); const other = boardModeKey('salon-1', 'u-2');
    expect(readBoardMode(kevin, store)).toBe('new');
    saveBoardMode(kevin, 'classic', store);
    expect(readBoardMode(kevin, store)).toBe('classic');
    expect(readBoardMode(other, store)).toBe('new');
    expect(readBoardMode(boardModeKey('salon-2', 'u-1'), store)).toBe('new');
  });
  it('blocked storage never breaks the page: the default applies, a save is a no-op', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readBoardMode('k', broken)).toBe('new');
    expect(() => saveBoardMode('k', 'classic', broken)).not.toThrow();
  });
});

describe('board words — POS bsb namespace', () => {
  it('has every package key in EN (same text) and VI (translated, same placeholders)', () => {
    for (const [k, en] of Object.entries(BOARD_TEXT_EN)) {
      const key = `bsb.${k}` as keyof typeof BSB_EN;
      expect(BSB_EN[key], key).toBe(en);
      const vi = (BSB_VI as Record<string, string>)[key];
      expect(vi, key).toBeTruthy();
      expect([...vi.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
    expect(Object.keys(BSB_VI).sort()).toEqual(Object.keys(BSB_EN).sort());
  });
});
