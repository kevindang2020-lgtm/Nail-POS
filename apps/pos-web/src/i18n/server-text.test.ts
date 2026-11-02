import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import '.';
import { serverText } from './server-text';

afterEach(async () => { await setLanguage('en'); });
describe('serverText', () => {
  it('translates a server label the POS already knows, and passes anything else through', async () => {
    expect(serverText('All Systems Operational')).toBe('All Systems Operational');
    await setLanguage('vi');
    expect(serverText('All Systems Operational')).toBe('Mọi hệ thống hoạt động bình thường');
    expect(serverText('Palace Nails')).toBe('Palace Nails');
    expect(serverText('')).toBe('');
    expect(serverText(null)).toBe('');
  });
});
