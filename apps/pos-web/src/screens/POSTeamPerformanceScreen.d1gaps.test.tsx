// POSTeamPerformanceScreen — D1 gaps (Nov 5 2026): Export only for reports.export; the details show helper contribution apart
// from her services; the services list can switch to "Service completed" date and to the services she helped on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { tp, perms } = vi.hoisted(() => ({ perms: { deny: [] as string[] }, tp: { dashboard: vi.fn(), directory: vi.fn(), technician: vi.fn(), services: vi.fn(), reviews: vi.fn(), exportCsv: vi.fn(), composite: vi.fn(), comparison: vi.fn(), snapshot: vi.fn() } }));
vi.mock('../api/posTeamScreensApi', () => ({ posTeamPerformanceScreenApi: tp }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSTeamPerformanceScreen } from './POSTeamPerformanceScreen';

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' };
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ period, minSample: 3, items, page: 1, pageSize: 8, totalItems: items.length, totalPages: 1, ...extra });
const KEVIN = { technicianId: 'k', name: 'Kevin Dang', avatarUrl: null, branch: 'Main', active: true, services: 2, rating: null, reviews: 0, tier: 'unrated', lowSample: false, lastServiceAt: null, lastReviewAt: null, matchedVia: null };
beforeEach(() => {
  perms.deny = [];
  for (const f of Object.values(tp)) f.mockReset();
  tp.dashboard.mockResolvedValue({ period, minSample: 3, kpis: { overallScore: null, overallReviews: 0, avgPerformance: null, ratedTechnicians: 0, technicians: 1, totalServices: 2, serviceContributions: 2, tickets: 1 }, distribution: { excellent: 0, very_good: 0, good: 0, needs: 0, unrated: 1 }, topPerformers: [] });
  tp.directory.mockResolvedValue(page([KEVIN]));
  tp.technician.mockResolvedValue({ period, minSample: 3, technicianId: 'k', name: 'Kevin Dang', avatarUrl: null, role: 'Technician', branch: 'Main', active: true, qualifiedServices: [],
    score: { rating: null, reviews: 0, tier: 'unrated', lowSample: false, source: 'verified_reviews', scale: 5, allTimeRating: null, allTimeReviews: 0 }, rank: null, services: 2, helpedTickets: 3, lastServiceAt: null, lastReviewAt: null, previous: null, comparable: false });
  tp.services.mockImplementation(async (_id: string, q: any) => page(q.role === 'helped'
    ? [{ id: 's2', at: '2026-10-28T15:00:00Z', service: 'Pedicure', minutes: 45, ticketId: 't2', ticketNumber: 'P-202', customer: null, techsOnTicket: 1, rating: null, technician: 'Anna Lee', helper: { id: 'k', name: 'Kevin Dang' } }]
    : [{ id: 's1', at: '2026-10-29T15:00:00Z', service: 'Gel Manicure', minutes: 45, ticketId: 't1', ticketNumber: 'P-101', customer: null, techsOnTicket: 1, rating: null, technician: null, helper: { id: 'b', name: 'Bao Tran' } }], { basis: q.basis ?? 'paid', role: q.role ?? 'own' }));
  tp.reviews.mockResolvedValue(page([]));
  tp.comparison.mockResolvedValue({ ...page([]), rankedBy: 'verified_rating' });
  tp.composite.mockResolvedValue(null);
  tp.exportCsv.mockResolvedValue('');
});
const open = async () => { render(<MemoryRouter><POSTeamPerformanceScreen /></MemoryRouter>); fireEvent.click(await screen.findByText('Kevin Dang')); };

describe('Team Performance D1 gaps', () => {
  it('no reports.export → no Export button', async () => {
    perms.deny = ['reports.export'];
    render(<MemoryRouter><POSTeamPerformanceScreen /></MemoryRouter>);
    await screen.findByText('Kevin Dang');
    expect(screen.queryByTestId('export')).toBeNull();
  });
  it('details: helped tickets shown apart; the list switches to helped services and the completion date', async () => {
    await open();
    expect(await screen.findByTestId('helped-tickets')).toHaveTextContent('3');
    expect(await screen.findByTestId('service-helper')).toHaveTextContent('Bao Tran');
    fireEvent.change(screen.getByTestId('service-basis'), { target: { value: 'completed' } });
    await waitFor(() => expect(tp.services).toHaveBeenLastCalledWith('k', expect.objectContaining({ basis: 'completed', role: 'own' })));
    fireEvent.change(screen.getByTestId('service-role'), { target: { value: 'helped' } });
    await waitFor(() => expect(tp.services).toHaveBeenLastCalledWith('k', expect.objectContaining({ role: 'helped' })));
    expect(await screen.findByText(/Anna Lee/)).toBeInTheDocument();
    expect(screen.queryByTestId('service-helper')).toBeNull();   // she is the helper on these rows — not repeated
  });
});
