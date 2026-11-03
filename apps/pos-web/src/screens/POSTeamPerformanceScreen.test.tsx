// POSTeamPerformanceScreen — the Team Performance rebuild (Oct 30 2026). The photo's "5% / 5%" was a 5.0 / 5 rating with a
// "%" sign: scores now read "x.x / 5" with their samples; Unrated is its own bar and filters the directory; a low sample is
// marked; a technician opens the Performance Details (score, rank, services, verified reviews; Close / Esc); 403.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { tp } = vi.hoisted(() => ({ tp: { dashboard: vi.fn(), directory: vi.fn(), technician: vi.fn(), services: vi.fn(), reviews: vi.fn(), exportCsv: vi.fn(), composite: vi.fn(), comparison: vi.fn(), snapshot: vi.fn() } }));
vi.mock('../api/posTeamScreensApi', () => ({ posTeamPerformanceScreenApi: tp }));
import { POSTeamPerformanceScreen } from './POSTeamPerformanceScreen';

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' };
const page = (items: unknown[]) => ({ period, minSample: 3, items, page: 1, pageSize: 8, totalItems: items.length, totalPages: 1 });
const VISHAL = { technicianId: 'v', name: 'Vishal verma', avatarUrl: null, branch: 'Main', active: true, services: 16, rating: 5, reviews: 1, tier: 'excellent', lowSample: true, lastServiceAt: null, lastReviewAt: null, matchedVia: null };
const CD = { ...VISHAL, technicianId: 'c', name: 'CD T6805', services: 0, rating: null, reviews: 0, tier: 'unrated', lowSample: false };
beforeEach(() => {
  for (const f of Object.values(tp)) f.mockReset();
  tp.dashboard.mockResolvedValue({ period, minSample: 3, kpis: { overallScore: 5, overallReviews: 1, avgPerformance: 5, ratedTechnicians: 1, technicians: 3, totalServices: 16, serviceContributions: 16, tickets: 15 },
    distribution: { excellent: 1, very_good: 0, good: 0, needs: 0, unrated: 2 }, topPerformers: [{ rank: 1, technicianId: 'v', name: 'Vishal verma', avatarUrl: null, branch: 'Main', score: 5, reviews: 1, services: 16, lowSample: true }] });
  tp.directory.mockImplementation(async (q: any) => page(q?.tier === 'unrated' ? [CD] : [VISHAL, CD]));
  tp.technician.mockResolvedValue({ period, minSample: 3, technicianId: 'v', name: 'Vishal verma', avatarUrl: null, role: 'Technician', branch: 'Main', active: true, qualifiedServices: ['Gel Manicure'],
    score: { rating: 5, reviews: 1, tier: 'excellent', lowSample: true, source: 'verified_reviews', scale: 5, allTimeRating: 5, allTimeReviews: 1 }, rank: { position: 1, of: 1 }, services: 16, lastServiceAt: null, lastReviewAt: null,
    previous: { from: '2026-09-01', to: '2026-09-30', services: 4, reviews: 0, rating: null }, comparable: false });
  tp.services.mockResolvedValue(page([{ id: 's1', at: '2026-10-29T15:00:00Z', service: 'Gel Manicure', minutes: 45, ticketId: 't1', ticketNumber: 'P-101', customer: null, techsOnTicket: 1, rating: 5 }]));
  tp.reviews.mockResolvedValue(page([{ id: 'r1', rating: 5, comment: 'Beautiful work', source: null, at: '2026-10-29T15:00:00Z', ticketId: null }]));
  const comps = (sat: number | null) => [{ key: 'satisfaction', value: sat, sample: 6, threshold: 5, status: sat == null ? 'INSUFFICIENT' : 'OK' }, { key: 'reliability', value: 93.8, sample: 16, threshold: 10, status: 'OK' },
    { key: 'onTime', value: null, sample: 3, threshold: 10, status: 'INSUFFICIENT' }, { key: 'correction', value: null, sample: 0, threshold: 20, status: 'UNSUPPORTED' }];
  tp.comparison.mockResolvedValue({ ...page([{ technicianId: 'v', name: 'Vishal verma', ratingRank: 1, rating: 5, reviews: 1, composite: null, available: false, missing: ['onTime', 'correction'], components: comps(90) }]), rankedBy: 'verified_rating', available: 0, model: { version: 'composite-v1', mode: 'comparison' } });
  tp.composite.mockResolvedValue({ technicianId: 'v', period, computedAt: '2026-10-30T15:00:00Z', modelVersion: 'composite-v1', mode: 'comparison', score: null, available: false, missing: ['onTime', 'correction'],
    rating: { scale: '0-5', average: 4.5, reviews: 6 }, components: comps(90).map((c, i) => ({ ...c, weight: [0.4, 0.3, 0.2, 0.1][i], excluded: 0, rule: 'rule' })), snapshots: [] });
  tp.exportCsv.mockResolvedValue('\uFEFFTechnician\r\nVishal verma');
});
const mount = () => render(<MemoryRouter><POSTeamPerformanceScreen /></MemoryRouter>);

describe('POSTeamPerformanceScreen', () => {
  it('scores read "5.0 / 5" with their sample — never "5%"; services are the unique paid lines', async () => {
    mount();
    expect(await screen.findByTestId('kpi-overall')).toHaveTextContent('5.0 / 5');
    expect(screen.getByTestId('kpi-avg')).toHaveTextContent('5.0 / 5');
    expect(screen.getByTestId('kpi-overall')).not.toHaveTextContent('%');
    expect(screen.getByTestId('kpi-overall')).toHaveTextContent('1 review');
    expect(screen.getByTestId('kpi-services')).toHaveTextContent('16');
    expect(screen.getByTestId('tier-unrated')).toHaveTextContent('2');
    expect((await screen.findAllByTestId('top-row'))[0]).toHaveTextContent('low sample');
  });
  it('a tier bar filters the directory; search goes to the server', async () => {
    mount(); await screen.findAllByTestId('dir-row');
    fireEvent.click(screen.getByTestId('tier-unrated'));
    await waitFor(() => expect(tp.directory).toHaveBeenLastCalledWith(expect.objectContaining({ tier: 'unrated', page: 1 })));
    expect(await screen.findByText('Not rated')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-7001' } });
    await waitFor(() => expect(tp.directory).toHaveBeenLastCalledWith(expect.objectContaining({ q: '(856) 555-7001' })));
  });
  it('a technician opens Performance Details: score, sample, rank, no comparison with too few reviews; reviews tab; Esc closes', async () => {
    mount(); fireEvent.click((await screen.findAllByTestId('top-row'))[0]);
    const sum = await screen.findByTestId('performance-summary');
    expect(sum).toHaveTextContent('5.0 / 5'); expect(sum).toHaveTextContent('1 review'); expect(sum).toHaveTextContent('#1 of 1');
    expect(screen.getByTestId('comparison')).toHaveTextContent(/Not enough reviews/);
    expect(await screen.findByTestId('service-row')).toHaveTextContent('P-101');
    fireEvent.click(screen.getByTestId('ptab-reviews'));
    expect(await screen.findByTestId('review-row')).toHaveTextContent('Beautiful work');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dlg-performance')).toBeNull());
  });
  it('403 is a permission state', async () => {
    tp.dashboard.mockRejectedValue({ status: 403 }); tp.directory.mockRejectedValue({ status: 403 }); mount();
    expect(await screen.findByText(/cannot see this information/i)).toBeInTheDocument();
  });
  it('F5: the composite is a separate 0–100 panel — insufficient evidence says so, never 0; Top Performers names its metric', async () => {
    mount();
    expect(await screen.findByTestId('ranked-by')).toHaveTextContent('verified rating (0–5)');
    expect(await screen.findByTestId('composite-na')).toHaveTextContent('Insufficient data');
    fireEvent.click(screen.getByTestId('composite-open'));
    expect(await screen.findByTestId('composite-value')).toHaveTextContent('Insufficient Data – Composite Score Not Available');
    const rows = screen.getAllByTestId('component-row'); expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('90.0 pts'); expect(rows[0]).toHaveTextContent('40%'); expect(rows[3]).toHaveTextContent('Not supported yet');
    expect(screen.getByTestId('dlg-composite')).toHaveTextContent('4.5 / 5');   // the rating stays its own field
  });
  it('F3: Export asks the server (audited) for the same filters', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    mount(); await screen.findAllByTestId('dir-row');
    fireEvent.click(screen.getByTestId('export'));
    await waitFor(() => expect(tp.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', tier: 'all', sort: 'score', lang: 'en', requestId: expect.any(String) })));
  });
});
