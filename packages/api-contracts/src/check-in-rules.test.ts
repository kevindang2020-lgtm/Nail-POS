import { describe, it, expect } from 'vitest';
import { normalizeDisplayLanguages } from './check-in-rules';

describe('normalizeDisplayLanguages (Dual-Screen §118–§119)', () => {
  it('keeps the owner\'s order (the default first), drops repeats, accepts any case', () => {
    expect(normalizeDisplayLanguages(['vi', 'en'])).toEqual(['vi', 'en']);
    expect(normalizeDisplayLanguages(['EN', 'en', ' vi '])).toEqual(['en', 'vi']);
    expect(normalizeDisplayLanguages(['en'])).toEqual(['en']);
  });
  it('refuses what it cannot honour: an unknown language, an empty list, not a list', () => {
    expect(normalizeDisplayLanguages(['en', 'fr'])).toBeNull();
    expect(normalizeDisplayLanguages([])).toBeNull();
    expect(normalizeDisplayLanguages('en')).toBeNull();
    expect(normalizeDisplayLanguages(null)).toBeNull();
  });
});
