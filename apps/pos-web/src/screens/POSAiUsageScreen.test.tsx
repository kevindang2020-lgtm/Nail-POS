import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { pkgMock, trialMock, cancelMock } = vi.hoisted(() => ({ pkgMock: vi.fn(), trialMock: vi.fn(), cancelMock: vi.fn() }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageApi: { packages: pkgMock, startTrial: trialMock, cancel: cancelMock } }));
import { POSAiUsageScreen } from './POSAiUsageScreen';
beforeEach(() => { [pkgMock, trialMock, cancelMock].forEach((m) => m.mockReset()); });

const pkg = (o: any = {}) => ({ code: 'ai_booking_assistant', name: 'AI Booking', description: 'Books appts', category: 'Booking', posArea: null, monthlyPriceCents: 4900, includedUsageLimit: 1000, usageUnit: 'calls', trialDays: 14, subscription: null, used: 0, remainingUsage: 1000, accessible: false, lockReason: null, lockLabel: null, upgradeRequired: false, trialAvailable: true, ...o });

describe('POSAiUsageScreen', () => {
  it('shows packages with subscription status + usage', async () => {
    pkgMock.mockResolvedValue({ packages: [
      pkg({ subscription: { status: 'active', usageLimit: 1000, overageEnabled: false, trialEndsAt: null }, used: 300, trialAvailable: false, accessible: true }),
      pkg({ code: 'ai_fraud', name: 'AI Fraud Shield', subscription: null, trialAvailable: true }),
    ] });
    render(<POSAiUsageScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Usage' })).toBeInTheDocument();
    expect(screen.getByText('AI Booking')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Not subscribed')).toBeInTheDocument();
    expect(screen.getAllByText('$49.00/mo').length).toBeGreaterThan(0);
  });
  it('starts a trial for an available package', async () => {
    pkgMock.mockResolvedValue({ packages: [pkg()] }); trialMock.mockResolvedValue({});
    render(<POSAiUsageScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Start 14-day trial/ }));
    await waitFor(() => expect(trialMock).toHaveBeenCalledWith('ai_booking_assistant'));
  });
  it('cancels an active subscription', async () => {
    pkgMock.mockResolvedValue({ packages: [pkg({ subscription: { status: 'active', usageLimit: 1000, overageEnabled: false, trialEndsAt: null }, trialAvailable: false, accessible: true })] });
    cancelMock.mockResolvedValue({});
    render(<POSAiUsageScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('ai_booking_assistant'));
  });

  it('Functional Decision 30: warns at 80% and 90%, and at the limit says AI is paused while the POS keeps working', async () => {
    const sub = { status: 'active', usageLimit: 1000, overageEnabled: false, trialEndsAt: null };
    for (const [used, text] of [[700, null], [800, /80% of this month's limit used — 200/], [900, /90% of this month's limit used — 100/], [1000, /paused until next period.*POS, booking, checkout and queue keep working/]] as const) {
      pkgMock.mockResolvedValue({ packages: [pkg({ subscription: sub, used, trialAvailable: false, accessible: used < 1000 })] });
      const { unmount } = render(<POSAiUsageScreen />);
      await screen.findByText('AI Booking');
      if (text) expect(await screen.findByText(text)).toBeInTheDocument();
      else expect(screen.queryByText(/of this month's limit used|paused until next period/)).toBeNull();
      unmount();
    }
  });
});

