import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mock = vi.hoisted(() => ({
  articles: vi.fn(), videos: vi.fn(), ticketStats: vi.fn(), listTickets: vi.fn(), createTicket: vi.fn(), status: vi.fn(), updates: vi.fn(),
  listAttachments: vi.fn(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn(), downloadAttachment: vi.fn(),
}));
vi.mock('../api/posHelpCenterApi', () => ({ posHelpCenterApi: mock }));

import { POSHelpCenterScreen } from './POSHelpCenterScreen';

const ok = () => {
  mock.articles.mockResolvedValue([
    { id: 'a1', slug: 'refunds', title: 'Processing refunds', viewCount: 42, readingMinutes: 3, categoryLabel: 'Payments' },
    { id: 'a2', slug: 'checkin', title: 'Check-in basics', viewCount: 99, readingMinutes: 2, categoryLabel: 'Front Desk' },
  ]);
  mock.videos.mockResolvedValue([{ id: 'v1', slug: 'tour', title: 'POS tour' }]);
  mock.ticketStats.mockResolvedValue({ total: 3, open: 2, unassigned: 1, awaitingFirstResponse: 1, breached: 0, byStatus: {}, byPriority: {} });
  mock.listTickets.mockResolvedValue([{ id: 't1', subject: 'Printer offline', status: 'open', priority: 'high' }]);
  mock.status.mockResolvedValue({ overall: { status: 'operational', label: 'All Systems Operational', healthy: true }, components: [{ key: 'db', name: 'Database', status: 'operational' }], incidents: [] });
  mock.listAttachments.mockResolvedValue([]);
  mock.uploadAttachment.mockResolvedValue({ ok: true });
  mock.deleteAttachment.mockResolvedValue({ ok: true });
  mock.updates.mockResolvedValue([{ id: 'u1', version: '2.4', title: 'Retail products are sellable', category: 'feature', publishedAt: '2026-07-27T00:00:00Z' }]);
};

beforeEach(() => { vi.clearAllMocks(); ok(); });

describe('POSHelpCenterScreen (live help backend)', () => {
  it('renders REAL metrics and panels from the help endpoints — nothing invented', async () => {
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2)); // Help Articles count AND Open Tickets both = 2
    expect(screen.getByText('Popular Articles')).toBeInTheDocument();
    // sorted by views: the 99-view article leads
    expect(screen.getByText('Check-in basics')).toBeInTheDocument();
    expect(screen.getByText('99 views')).toBeInTheDocument();
    expect(screen.getByText('Recent Product Updates')).toBeInTheDocument();
    expect(screen.getByText('Retail products are sellable')).toBeInTheDocument();
    expect(screen.getAllByText('All Systems Operational').length).toBeGreaterThanOrEqual(1); // KPI value + status pill
    expect(screen.getByText('Printer offline')).toBeInTheDocument();
  });

  it('sections fail INDEPENDENTLY and honestly — a dead status probe is never shown green', async () => {
    mock.status.mockRejectedValue(new Error('down'));
    mock.updates.mockRejectedValue(new Error('down'));
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Status is unavailable right now/)).toBeInTheDocument());
    expect(screen.queryByText('All Systems Operational')).not.toBeInTheDocument();
    expect(screen.getByText('The updates feed could not be loaded.')).toBeInTheDocument();
    // the articles panel still rendered from its own fetch
    expect(screen.getByText('Check-in basics')).toBeInTheDocument();
  });

  it('empty knowledge base states are honest, not fabricated', async () => {
    mock.articles.mockResolvedValue([]);
    mock.updates.mockResolvedValue([]);
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/No help articles have been published yet/)).toBeInTheDocument());
    expect(screen.getByText('No product updates have been published yet.')).toBeInTheDocument();
  });

  it('submits a real support ticket (subject required) and prepends it to the list', async () => {
    mock.createTicket.mockResolvedValue({ id: 't9', subject: 'Drawer stuck', status: 'open', priority: 'normal' });
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Printer offline')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Submit Ticket'));
    expect(screen.getByText('A subject is required.')).toBeInTheDocument();
    expect(mock.createTicket).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ticket subject'), { target: { value: 'Drawer stuck' } });
    fireEvent.click(screen.getByText('Submit Ticket'));
    await waitFor(() => expect(mock.createTicket).toHaveBeenCalledWith({ subject: 'Drawer stuck', description: undefined, priority: 'normal' }));
    await waitFor(() => expect(screen.getByText('Drawer stuck')).toBeInTheDocument());
  });

  it('functional search filters curated help topics', async () => {
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    const input = screen.getByPlaceholderText(/Search help articles/);
    fireEvent.change(input, { target: { value: 'refund' } });
    expect(screen.getByText('How to process a refund')).toBeInTheDocument();
    expect(screen.queryByText('Running payroll')).not.toBeInTheDocument();
  });

  it('ticket attachments: expander lists files and uploads the picked file as base64', async () => {
    mock.listAttachments.mockResolvedValueOnce([{ id: 'att1', fileName: 'photo.png', sizeBytes: 2048 }]);
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Attachments'));
    await screen.findByText(/photo\.png/);
    mock.listAttachments.mockResolvedValueOnce([{ id: 'att1', fileName: 'photo.png' }, { id: 'att2', fileName: 'notes.txt' }]);
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/Attach file to/), { target: { files: [file] } });
    await waitFor(() => expect(mock.uploadAttachment).toHaveBeenCalled());
    const [tid, body] = mock.uploadAttachment.mock.calls[0];
    expect(tid).toBe('t1');
    expect(body.fileName).toBe('notes.txt');
    expect(body.data.length).toBeGreaterThan(0);            // base64 payload, not empty
    await screen.findByText(/notes\.txt/);                  // list refreshed with the new file
  });

  it('ticket attachments: remove deletes and refreshes to the honest empty state', async () => {
    mock.listAttachments.mockResolvedValueOnce([{ id: 'att1', fileName: 'photo.png' }]);
    render(<MemoryRouter><POSHelpCenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Attachments'));
    await screen.findByText(/photo\.png/);
    mock.listAttachments.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(mock.deleteAttachment).toHaveBeenCalledWith('t1', 'att1'));
    await screen.findByText('No attachments yet.');
  });
});
