import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, visMock } = vi.hoisted(() => ({ stateMock: vi.fn(), visMock: vi.fn() }));
vi.mock('../api/posReviewsApi', () => ({ posReviewsApi: { state: stateMock, setVisibility: visMock } }));
import { POSReviewsScreen } from './POSReviewsScreen';
beforeEach(() => { stateMock.mockReset(); visMock.mockReset(); });

const rv = (o: any = {}) => ({ id: 'r1', rating: 5, comment: 'Loved it', technicianId: 't1', technicianName: 'Ana', tags: [], isPublic: true, isHidden: false, hiddenReason: null, customerId: 'c1', createdAt: '2026-07-01T00:00:00Z', ...o });
const state = (reviews: any[]) => ({ kpis: { totalReviews: reviews.length, averageRating: 4.2, ratingDistribution: [{ star: 5, count: 2 }, { star: 4, count: 0 }, { star: 3, count: 1 }, { star: 2, count: 0 }, { star: 1, count: 0 }], publicCount: reviews.filter((r) => r.isPublic).length, hiddenCount: reviews.filter((r) => r.isHidden).length, withCommentCount: 2, fiveStarPercent: 66.7 }, reviews });

describe('POSReviewsScreen', () => {
  it('renders reputation KPIs + review feed', async () => {
    stateMock.mockResolvedValue(state([rv(), rv({ id: 'r2', rating: 3, comment: 'ok' })]));
    render(<POSReviewsScreen />);
    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
    expect(screen.getByText('Loved it')).toBeInTheDocument();
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
  });
  it('hides a review with a reason typed in the inline editor (no native prompt)', async () => {
    stateMock.mockResolvedValue(state([rv()]));
    visMock.mockResolvedValue({});
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<POSReviewsScreen />);
    await screen.findByText('Loved it');
    stateMock.mockResolvedValue(state([rv({ isHidden: true, hiddenReason: 'off-topic' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    fireEvent.change(screen.getByLabelText('Reason for hiding'), { target: { value: 'off-topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(visMock).toHaveBeenCalledWith('r1', true, 'off-topic'));
    expect(promptSpy).not.toHaveBeenCalled();
  });
  it('does not call the API when the inline editor is cancelled or the reason is empty', async () => {
    stateMock.mockResolvedValue(state([rv()]));
    render(<POSReviewsScreen />);
    await screen.findByText('Loved it');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));         // opens the editor
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));         // confirm with EMPTY reason → refused
    expect(await screen.findByText('A reason is required to hide a review.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));       // editor closes
    await new Promise((r) => setTimeout(r, 10));
    expect(visMock).not.toHaveBeenCalled();
  });
});
