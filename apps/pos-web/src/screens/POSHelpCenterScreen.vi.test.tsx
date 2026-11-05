// POSHelpCenterScreen.vi.test — English + Vietnamese POS mandate (WP-C4): the Help Center reads in Vietnamese (no leftover
// English in what staff read), the topic search is accent-insensitive ("hoan tien" finds "Hoàn tiền"), the category filter
// works in Vietnamese (it filters by category id, not by the English label), and an instant switch re-labels in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

const mock = vi.hoisted(() => ({
  articles: vi.fn(), videos: vi.fn(), ticketStats: vi.fn(), listTickets: vi.fn(), createTicket: vi.fn(), status: vi.fn(), updates: vi.fn(),
  listAttachments: vi.fn(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn(), downloadAttachment: vi.fn(),
}));
vi.mock('../api/posHelpCenterApi', () => ({ posHelpCenterApi: mock }));

import { POSHelpCenterScreen } from './POSHelpCenterScreen';

// data the platform / salon wrote (article titles, ticket subjects, version names) stays as written
const DATA = ['Processing refunds', 'Printer offline', 'POS tour', 'Retail products are sellable', 'support@aipowersalon.com', 'Beta'];   // "Beta" is the approved catalogue Vietnamese

beforeEach(() => {
  vi.clearAllMocks();
  mock.articles.mockResolvedValue([{ id: 'a1', slug: 'refunds', title: 'Processing refunds', viewCount: 42, readingMinutes: 3, categoryLabel: null }]);
  mock.videos.mockResolvedValue([{ id: 'v1', slug: 'tour', title: 'POS tour' }]);
  mock.ticketStats.mockResolvedValue({ total: 3, open: 2, unassigned: 1, awaitingFirstResponse: 1, breached: 0, byStatus: {}, byPriority: {} });
  mock.listTickets.mockResolvedValue([{ id: 't1', subject: 'Printer offline', status: 'waiting_customer', priority: 'high' }]);
  mock.status.mockResolvedValue(null);
  mock.listAttachments.mockResolvedValue([]);
  mock.updates.mockResolvedValue([{ id: 'u1', version: '2.4', title: 'Retail products are sellable', category: null, publishedAt: '2026-07-27T00:00:00Z' }]);
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Help Center in Vietnamese', () => {
  it('reads in Vietnamese: suggested questions, popular searches, ticket status / priority — no English left', async () => {
    await setLanguage('vi');
    const { container } = render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Printer offline')).toBeInTheDocument());
    expect(screen.getByText('Làm sao để hoàn tiền?')).toBeInTheDocument();          // suggested question
    expect(screen.getByRole('button', { name: 'thẻ quà tặng' })).toBeInTheDocument(); // popular search chip
    expect(screen.getByText(/Đang chờ bạn/)).toBeInTheDocument();                    // ticket status waiting_customer
    for (const en of ['How do I process a refund?', 'gift card', 'waiting_customer', 'Unavailable']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, DATA).join(' | ')).toBe('');
  });

  it('topic search is accent-insensitive and the category filter works in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Printer offline')).toBeInTheDocument());
    const box = container.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'hoan tien' } });                          // typed without accents
    const refundTitle = (await import('@aipowersalon/mobile-sdk/i18n')).t('pos.how_to_process_a_refund');
    await waitFor(() => expect(screen.getByText(refundTitle)).toBeInTheDocument());
    fireEvent.change(box, { target: { value: '' } });
    const cat = screen.getAllByRole('combobox').find((s) => (s as HTMLSelectElement).querySelector('option[value="payments"]')) as HTMLSelectElement;
    fireEvent.change(cat, { target: { value: 'payments' } });
    await waitFor(() => expect(screen.getByText(refundTitle)).toBeInTheDocument());   // a Payments topic survives the filter
  });

  it('an instant switch re-labels the screen in place', async () => {
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('How do I process a refund?')).toBeInTheDocument());
    await act(async () => { await setLanguage('vi'); });
    expect(screen.getByText('Làm sao để hoàn tiền?')).toBeInTheDocument();
    expect(screen.queryByText('How do I process a refund?')).toBeNull();
  });
});
