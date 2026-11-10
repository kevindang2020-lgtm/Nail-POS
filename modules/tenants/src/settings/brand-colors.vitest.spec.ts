// batch 8 decision 5 (Nov 9 2026): brand colours must read on white (WCAG 3:1)
import { describe, it, expect } from 'vitest';
import { contrastWithWhite } from './settings.service';
import { SETTINGS_RECEIPTS_BODY } from '../request-schemas';
import { validateBody } from '@aipowersalon/permissions';

describe('brand colours', () => {
  it('measures contrast against white', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#FFFFFF')).toBeCloseTo(1, 1);
    expect(contrastWithWhite('#A96F22')).toBeGreaterThan(3);    // the POS gold reads on white
    expect(contrastWithWhite('#F3E7D2')).toBeLessThan(3);       // cream does not
  });
  it('the request schema accepts #RRGGBB or null and refuses anything else', () => {
    expect(validateBody(SETTINGS_RECEIPTS_BODY, { brandPrimary: '#A96F22', brandAccent: null }, { strict: true }).ok).toBe(true);
    expect(validateBody(SETTINGS_RECEIPTS_BODY, { brandPrimary: 'gold' }, { strict: true }).ok).toBe(false);
  });
});
