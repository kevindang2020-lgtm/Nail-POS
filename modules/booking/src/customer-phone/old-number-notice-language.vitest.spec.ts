// The "your number was changed" text to the OLD number. Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans.
import { describe, it, expect } from 'vitest';
import { oldNumberNotice } from './customer-phone-notify';

describe('old-number notice', () => {
  it('English for every customer — a customer marked Vietnamese too', () => {
    expect(oldNumberNotice('Luxe', '•••-1234')).toBe('Luxe: the phone number on your profile was changed to •••-1234. If you did not ask for this, contact the salon right away.');
    expect(oldNumberNotice('Luxe', '•••-1234', 'vi')).toBe(oldNumberNotice('Luxe', '•••-1234'));
    expect(oldNumberNotice('Luxe', '•••-1234', 'fr')).toBe(oldNumberNotice('Luxe', '•••-1234'));
  });
});
