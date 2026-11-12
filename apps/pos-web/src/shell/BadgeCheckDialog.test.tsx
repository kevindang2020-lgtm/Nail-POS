// BadgeCheckDialog.test — extras Customer Notifications 02: the badge self-check compares what the shell shows with a fresh
// server read, names each badge that differs, and its recalculation only asks the shell to read again (nothing changes).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../api/client', () => ({ api: m }));
import { BadgeCheckDialog, compareBadges } from './BadgeCheckDialog';

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });

describe('Badge accuracy self-check', () => {
  it('compareBadges: a missing number is zero for matching; a key neither side has is not listed', () => {
    const rows = compareBadges({ checkout: 3, messages: 0, reviews: 2 }, { checkout: 3, messages: 4, notifications: 0 });
    expect(rows).toEqual([
      { key: 'checkout', shown: 3, server: 3, match: true },
      { key: 'messages', shown: 0, server: 4, match: false },
      { key: 'notifications', shown: null, server: 0, match: true },
      { key: 'reviews', shown: 2, server: null, match: false },
    ]);
  });
  it('shows each badge shown vs server now, flags the differing ones, and Refresh badges only asks the shell to read again', async () => {
    m.get.mockResolvedValue({ checkout: 5, messages: 2, inventoryAlerts: 1 });
    const heard = vi.fn(); window.addEventListener('aps:nav-counts-changed', heard);
    render(<BadgeCheckDialog shown={{ checkout: 4, messages: 2, inventoryAlerts: 1 }} onClose={() => undefined} />);
    expect(await screen.findByTestId('badge-check-verdict')).toHaveTextContent('1 badge(s) differ from the server');
    expect(m.get).toHaveBeenCalledWith('/tenant/navigation/badges');
    expect(screen.getByTestId('badge-row-checkout')).toHaveTextContent(/Checkout\s*4\s*5\s*Differs/);
    expect(screen.getByTestId('badge-row-messages')).toHaveTextContent(/Messages\s*2\s*2\s*Match/);
    fireEvent.click(screen.getByTestId('badge-check-recalc'));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('badge-check-asked')).toBeInTheDocument();
    expect(m.post).not.toHaveBeenCalled(); expect(m.patch).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
    window.removeEventListener('aps:nav-counts-changed', heard);
  });
  it('all matching says so; a failed server read shows the error, not a false "all match"', async () => {
    m.get.mockResolvedValueOnce({ checkout: 1 });
    const v = render(<BadgeCheckDialog shown={{ checkout: 1 }} onClose={() => undefined} />);
    expect(await screen.findByTestId('badge-check-verdict')).toHaveTextContent('All 1 badges match the server.');
    v.unmount();
    m.get.mockRejectedValueOnce(new Error('offline'));
    render(<BadgeCheckDialog shown={{ checkout: 1 }} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('offline'));
    expect(screen.queryByTestId('badge-check-verdict')).toBeNull();
  });
});
