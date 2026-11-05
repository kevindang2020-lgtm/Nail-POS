import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/superAdminNailShowcaseApi', () => ({
  superAdminNailShowcaseApi: {
    reports: vi.fn(), removePost: vi.fn(), removeComment: vi.fn(), resolveReport: vi.fn(),
    reportedProfiles: vi.fn(), suspendProfile: vi.fn(), unsuspendProfile: vi.fn(),
  },
}));
import { superAdminNailShowcaseApi } from '../api/superAdminNailShowcaseApi';
import { SuperAdminNailShowcaseModerationScreen } from './SuperAdminNailShowcaseModerationScreen';

const reportedCreator = (over: Partial<any> = {}) => ({
  customerId: 'c1', displayName: 'Sophia N.', avatarUrl: null, reportCount: 3, lastReportedAt: '2026-06-11T00:00:00Z',
  isSuspended: false, isPublic: true, rank: 8, score: 1284, ...over,
});

describe('SuperAdminNailShowcaseModerationScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the platform report queue with hard-takedown + resolve actions', async () => {
    (superAdminNailShowcaseApi.reports as any).mockResolvedValue([
      { id: 'r1', postId: 'post12345678', commentId: null, reason: 'inappropriate', details: null, status: 'open', createdAt: '2026-06-11T00:00:00Z' },
    ]);
    (superAdminNailShowcaseApi.reportedProfiles as any).mockResolvedValue([]);
    render(<SuperAdminNailShowcaseModerationScreen />);
    expect(await screen.findByText('NailShowcase Moderation')).toBeInTheDocument();
    expect(await screen.findByText(/Post reported/)).toBeInTheDocument();
    expect(screen.getByText('inappropriate')).toBeInTheDocument();
    expect(screen.getByText('Remove post')).toBeInTheDocument();
    expect(screen.getByText('Action taken')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('shows an honest empty state when nothing is reported', async () => {
    (superAdminNailShowcaseApi.reports as any).mockResolvedValue([]);
    (superAdminNailShowcaseApi.reportedProfiles as any).mockResolvedValue([]);
    render(<SuperAdminNailShowcaseModerationScreen />);
    expect(await screen.findByText(/No open reports across the platform/)).toBeInTheDocument();
    expect(screen.getByText(/No reported creators/)).toBeInTheDocument();
  });

  it('suspends a reported creator from the rankings', async () => {
    (superAdminNailShowcaseApi.reports as any).mockResolvedValue([]);
    (superAdminNailShowcaseApi.reportedProfiles as any).mockResolvedValue([reportedCreator()]);
    (superAdminNailShowcaseApi.suspendProfile as any).mockResolvedValue({ customerId: 'c1', suspended: true, rank: null, displayName: 'Sophia N.' });
    render(<SuperAdminNailShowcaseModerationScreen />);
    expect(await screen.findByText('Sophia N.')).toBeInTheDocument();
    expect(screen.getByText(/3 reports/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Suspend from rankings'));
    await waitFor(() => expect(superAdminNailShowcaseApi.suspendProfile).toHaveBeenCalledWith('c1'));
  });

  it('offers Unsuspend for an already-suspended creator', async () => {
    (superAdminNailShowcaseApi.reports as any).mockResolvedValue([]);
    (superAdminNailShowcaseApi.reportedProfiles as any).mockResolvedValue([reportedCreator({ isSuspended: true })]);
    render(<SuperAdminNailShowcaseModerationScreen />);
    expect(await screen.findByText('Unsuspend')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });
});
