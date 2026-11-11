import { describe, it, expect } from 'vitest';
import { readSpacing, saveSpacing, applySpacing } from './spacingPref';

describe('Compact spacing (per device)', () => {
  it('defaults to the certified Standard spacing; blocked storage never breaks the screen', () => {
    expect(readSpacing({ getItem: () => null })).toBe('standard');
    expect(readSpacing({ getItem: () => { throw new Error('blocked'); } })).toBe('standard');
  });
  it('a saved Compact choice is read back and applied to <html data-spacing>', () => {
    const m = new Map<string, string>();
    saveSpacing('compact', { setItem: (k, v) => void m.set(k, v) });
    expect(readSpacing({ getItem: (k) => m.get(k) ?? null })).toBe('compact');
    expect(document.documentElement.getAttribute('data-spacing')).toBe('compact');
    applySpacing('standard');
    expect(document.documentElement.getAttribute('data-spacing')).toBe('standard');
  });
});
