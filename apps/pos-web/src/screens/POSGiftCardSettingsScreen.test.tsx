import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { getMock, updateMock } = vi.hoisted(() => ({ getMock: vi.fn(), updateMock: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: getMock, updateCategory: updateMock } }));
import { POSGiftCardSettingsScreen } from './POSGiftCardSettingsScreen';

const GC = {
  enabled: true, posSalesEnabled: true, customerAppSalesEnabled: true, sendToFriendEnabled: true,
  presetAmountsCents: [2500, 5000, 7500, 10000, 15000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000,
  crossBranchRedemption: true, expirationPolicy: 'none', partialRedemption: true, multiplePerCheckout: true,
  refundToCardDefault: true, transferable: true, scheduledDeliveryEnabled: true,
  deliveryChannels: { sms: true, email: true, inApp: true }, barcodeFormat: 'qr', presentationTokenTtlSeconds: 90,
  managerApprovalOverCents: 50000, dailyPurchaseLimitCents: 200000, networkGiftCardsEnabled: false,
  sellNetworkGiftCards: false, redeemNetworkGiftCards: false, termsVersion: 'v1',
};

beforeEach(() => {
  getMock.mockReset(); updateMock.mockReset();
  getMock.mockResolvedValue({ ...GC });
  updateMock.mockImplementation((_c: string, patch: any) => Promise.resolve({ ...GC, ...patch }));
});

describe('POSGiftCardSettingsScreen', () => {
  it('loads settings and shows the honest network-pending notice', async () => {
    render(<POSGiftCardSettingsScreen />);
    expect(await screen.findByText('Sell at the POS')).toBeInTheDocument();
    expect(screen.getByText(/Pending program approval/)).toBeInTheDocument();
  });

  it('saves a toggle as a patch to the gift-card-settings block', async () => {
    render(<POSGiftCardSettingsScreen />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sell at the POS' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('gift-card-settings', { posSalesEnabled: false }));
  });

  it('saves a money field as integer cents on blur', async () => {
    render(<POSGiftCardSettingsScreen />);
    const min = await screen.findByLabelText('Minimum amount');
    fireEvent.change(min, { target: { value: '20.00' } });
    fireEvent.blur(min);
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('gift-card-settings', { minAmountCents: 2000 }));
  });

  it('gates the network sell/redeem toggles until the program is enabled', async () => {
    render(<POSGiftCardSettingsScreen />);
    expect(await screen.findByRole('checkbox', { name: 'Sell network gift cards (once approved)' })).toBeDisabled();
  });
});
