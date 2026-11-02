// CommunityFeedScreen.vi.test — English + Vietnamese POS mandate (WP-C3): the Safety Community feed reads in Vietnamese
// (section tabs, categories, severities, statuses); advisory titles are what salons wrote (data). Same fake API as
// CommunityFeedScreen.test.tsx.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from '../viScan.testkit';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { B, err, installFetch, page, post, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
import { CommunityFeedScreen } from './CommunityFeedScreen';

let routes: Record<string, R>;
const defaults = (): Record<string, R> => ({
  [`GET ${B}/feed`]: (c) => ({ body: page([post(), post({ id: 'p2', title: 'Fake gift card balance call', severity: 'critical', following: true })], { page: Number(c.query.get('page') || 1), total: 45, hasMore: true }) }),
  [`GET ${B}/search`]: (c) => (c.query.get('q') === '555-123-4567' ? err(400, 'search_identifier_rejected') : { body: page([post({ id: 'p3', title: 'Gift card trick' })]) }),
});
const renderFeed = () => render(<MemoryRouter initialEntries={['/community']}><Routes><Route path="/community" element={<CommunityFeedScreen />} /><Route path="/community/posts/:id" element={<div data-testid="detail-route" />} /><Route path="/community/new" element={<div data-testid="new-route" />} /></Routes></MemoryRouter>);
beforeEach(() => { perms.deny = new Set(); routes = defaults(); installFetch(routes); });

afterEach(async () => { await setLanguage('en'); });

describe('Safety Community feed in Vietnamese', () => {
  it('tabs, filters, severity and status labels are Vietnamese; no English left', async () => {
    await setLanguage('vi');
    const { container } = renderFeed();
    await screen.findAllByTestId('community-post-row');
    expect(screen.getAllByText('Bảng tin').length).toBeGreaterThan(0);                 // section tab "Feed"
    expect(screen.getAllByText('Nghiêm trọng').length).toBeGreaterThan(0);             // severity critical
    for (const en of ['Feed', 'New advisory', 'Critical', 'Phone scam']) expect(screen.queryByText(en), en).toBeNull();
    const titles = Array.from(container.querySelectorAll('[data-testid="community-post-row"] a')).map((a) => a.textContent ?? '');
    expect(leftoverEnglish(container, [...titles, 'AI PowerSalon', 'PowerSalon']).join(' | ')).toBe('');
  });
});
