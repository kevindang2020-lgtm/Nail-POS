// POSMessagesScreen.vi.test — English + Vietnamese POS mandate (WP-C3): Messages (compose, recent log, opt-outs) reads in
// Vietnamese. Same fetch mock as POSMessagesScreen.test.tsx.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render } from '@testing-library/react';
import { POSMessagesScreen } from './POSMessagesScreen';

const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

afterEach(async () => { await setLanguage('en'); });

describe('POSMessagesScreen in Vietnamese', () => {
  it('compose and the recent log read in Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = mockFetch({ items: [{ id: 'm1', channel: 'sms', to: '(555) 111-2222', body: 'See you soon', status: 'failed', failureReason: null, createdAt: '2026-10-20T15:00:00Z' }], optOuts: [] }) as any;
    const { container } = render(<POSMessagesScreen />);
    await new Promise((r) => setTimeout(r, 50));
    expect(leftoverEnglish(container, ['See you soon', 'example']).join(' | ')).toBe('');
  });
});
