import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, createMock, statusMock } = vi.hoisted(() => ({ stateMock: vi.fn(), createMock: vi.fn(), statusMock: vi.fn() }));
vi.mock('../api/posSocialApi', () => ({ posSocialApi: { state: stateMock, create: createMock, setStatus: statusMock } }));
import { POSSocialScreen } from './POSSocialScreen';
beforeEach(() => { stateMock.mockReset(); createMock.mockReset(); statusMock.mockReset(); });

const empty = { kpis: { drafts: 0, scheduled: 0, posted: 0, total: 0 }, posts: [] };
const withPost = { kpis: { drafts: 1, scheduled: 0, posted: 0, total: 1 }, posts: [{ id: 's1', platform: 'instagram', caption: 'Spring looks', scheduledAt: null, status: 'draft', postedAt: null, createdAt: '2026-07-01T00:00:00.000Z' }] };

describe('POSSocialScreen', () => {
  it('shows KPIs and an empty planner', async () => {
    stateMock.mockResolvedValue(empty);
    render(<POSSocialScreen />);
    expect(await screen.findByText('Social Planner')).toBeInTheDocument();
    expect(screen.getByText('No posts planned yet.')).toBeInTheDocument();
  });
  it('adds a post', async () => {
    stateMock.mockResolvedValue(empty);
    createMock.mockResolvedValue({ id: 's1' });
    render(<POSSocialScreen />);
    await screen.findByText('Social Planner');
    fireEvent.change(screen.getByPlaceholderText(/What's the post about/), { target: { value: 'Grand reopening!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to planner' }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toMatchObject({ platform: 'instagram', caption: 'Grand reopening!' });
  });
  it('moves a draft post to posted', async () => {
    stateMock.mockResolvedValue(withPost);
    statusMock.mockResolvedValue({});
    render(<POSSocialScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark posted' }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith('s1', 'posted'));
  });
});
