import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { duplicatesMock, mergePreviewMock, mergeMock } = vi.hoisted(() => ({
  duplicatesMock: vi.fn(), mergePreviewMock: vi.fn(), mergeMock: vi.fn(),
}));
const { decideMock } = vi.hoisted(() => ({ decideMock: vi.fn() }));
vi.mock('../api/posCustomersApi', async (orig) => ({ ...(await (orig as any)()), posCustomersApi: { ...((await (orig as any)()).posCustomersApi || {}), decideDuplicate: decideMock } }));
vi.mock('../api/posAiCustomerProfileApi', () => ({
  posAiCustomerProfileApi: { duplicates: duplicatesMock, mergePreview: mergePreviewMock, merge: mergeMock },
}));
import { POSAICustomerDuplicateReviewScreen } from './POSAICustomerDuplicateReviewScreen';

beforeEach(() => { duplicatesMock.mockReset(); mergePreviewMock.mockReset(); mergeMock.mockReset(); });

const groups = {
  freshness: { generatedAt: '2026-07-07T12:00:00Z', source: 'live' },
  groups: [{
    duplicateGroupId: 'g1', reason: 'same phone', confidence: 'strong',
    members: [
      { customerId: 'c1', displayName: 'Jen Lee', phone: '5551234', email: 'a@a.com', visitCount: 5 },
      { customerId: 'c2', displayName: 'Jenn Lee', phone: '5551234', email: 'b@b.com', visitCount: 1 },
    ],
  }],
};

describe('POSAICustomerDuplicateReviewScreen', () => {
  it('lists duplicate groups and runs preview → confirmed merge', async () => {
    duplicatesMock.mockResolvedValue(groups);
    mergePreviewMock.mockResolvedValue({
      groupId: 'g1', survivingRecord: { customerId: 'c1', displayName: 'Jen Lee', phone: '5551234' },
      mergingRecords: [{ customerId: 'c2', displayName: 'Jenn Lee' }],
      willMove: ['appointment & service history', 'loyalty points'], confirmationRequired: true,
    });
    mergeMock.mockResolvedValue({ merged: { customerId: 'c1' }, invalidatedCache: true });

    render(<POSAICustomerDuplicateReviewScreen />);
    expect(await screen.findByText('Jen Lee')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Merge into this')[0]);        // pick c1 as survivor
    expect(await screen.findByRole('dialog', { name: 'Confirm merge' })).toBeInTheDocument();
    expect(mergePreviewMock).toHaveBeenCalledWith('g1', 'c1');

    fireEvent.click(screen.getByText('Merge records'));                 // confirm
    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith('g1', 'c1'));
    expect(await screen.findByText(/Records merged/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no duplicates', async () => {
    duplicatesMock.mockResolvedValue({ groups: [], freshness: {} });
    render(<POSAICustomerDuplicateReviewScreen />);
    expect(await screen.findByText(/look clean/)).toBeInTheDocument();
  });

  it('Functional Decision 29: Keep separate / Not sure are sent to the server, and a Not-sure group shows its flag', async () => {
    decideMock.mockReset(); decideMock.mockResolvedValue({ ok: true });
    duplicatesMock.mockResolvedValue(groups);
    const { unmount } = render(<POSAICustomerDuplicateReviewScreen />);
    fireEvent.click(await screen.findByText('Keep separate'));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith('g1', 'keep_separate'));
    expect(mergeMock).not.toHaveBeenCalled();                       // a decision never merges anything
    unmount();
    duplicatesMock.mockResolvedValue({ ...groups, groups: [{ ...groups.groups[0], notSure: true }] });
    render(<POSAICustomerDuplicateReviewScreen />);
    expect(await screen.findByText('Marked not sure')).toBeInTheDocument();
    expect(screen.queryByText('Not sure')).toBeNull();               // already marked — only Keep separate / Merge remain
  });
});

