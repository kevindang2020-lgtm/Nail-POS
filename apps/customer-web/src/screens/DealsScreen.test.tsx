import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { deals: vi.fn(), dealsNearby: vi.fn().mockResolvedValue([]), dealDetail: vi.fn(), saveDeal: vi.fn(), unsaveDeal: vi.fn(), savedDeals: vi.fn().mockResolvedValue([]) } }));
import { customerApi } from '../api/customerApi';
import { DealsScreen } from './DealsScreen';

describe('DealsScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists active deals with their code', async () => {
    (customerApi.deals as any).mockResolvedValue([{ id: 'd1', title: '20% off gel', description: 'This month only', code: 'GEL20', startsAt: null, endsAt: '2026-12-31T00:00:00Z' }]);
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    expect(await screen.findByText('20% off gel')).toBeInTheDocument();
    expect(screen.getByText('Code: GEL20')).toBeInTheDocument();
  });
  it('shows an honest empty state when there are no deals', async () => {
    (customerApi.deals as any).mockResolvedValue([]);
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    expect(await screen.findByText('No active deals right now')).toBeInTheDocument();
  });
});
