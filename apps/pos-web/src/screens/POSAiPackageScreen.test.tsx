import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { pkgMock, trialMock, cancelMock } = vi.hoisted(() => ({ pkgMock: vi.fn(), trialMock: vi.fn(), cancelMock: vi.fn() }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageApi: { packages: pkgMock, startTrial: trialMock, cancel: cancelMock } }));
import { POSAiPackageScreen } from './POSAiPackageScreen';
beforeEach(() => { [pkgMock, trialMock, cancelMock].forEach((m) => m.mockReset()); });

const pkg = (o: any = {}) => ({ code: 'ai_fraud_money_protection', name: 'AI Fraud / Money Protection', description: 'Flags risky transactions.', category: 'Protection', posArea: 'Checkout / cash drawer', monthlyPriceCents: 5900, includedUsageLimit: 500, usageUnit: 'checks', trialDays: 14, subscription: null, used: 0, remainingUsage: 500, accessible: false, lockLabel: null, upgradeRequired: false, trialAvailable: true, ...o });

describe('POSAiPackageScreen', () => {
  it('renders the specific package by code with description + price', async () => {
    pkgMock.mockResolvedValue({ packages: [pkg({ code: 'other', name: 'Other' }), pkg()] });
    render(<POSAiPackageScreen code="ai_fraud_money_protection" title="AI Fraud Protection" />);
    expect(await screen.findByRole('heading', { name: 'AI Fraud / Money Protection' })).toBeInTheDocument();
    expect(screen.getByText('Flags risky transactions.')).toBeInTheDocument();
    expect(screen.getByText('$59.00/mo')).toBeInTheDocument();
    expect(screen.getByText(/Works in: Checkout/)).toBeInTheDocument();
  });
  it('starts a trial when available', async () => {
    pkgMock.mockResolvedValue({ packages: [pkg()] }); trialMock.mockResolvedValue({});
    render(<POSAiPackageScreen code="ai_fraud_money_protection" title="AI Fraud Protection" />);
    fireEvent.click(await screen.findByRole('button', { name: /Start 14-day free trial/ }));
    await waitFor(() => expect(trialMock).toHaveBeenCalledWith('ai_fraud_money_protection'));
  });
  it('cancels an active subscription and shows usage', async () => {
    pkgMock.mockResolvedValue({ packages: [pkg({ subscription: { status: 'active', usageLimit: 500, trialEndsAt: null }, used: 120, accessible: true, trialAvailable: false })] });
    cancelMock.mockResolvedValue({});
    render(<POSAiPackageScreen code="ai_fraud_money_protection" title="AI Fraud Protection" />);
    expect((await screen.findAllByText('Active')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel add-on' }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('ai_fraud_money_protection'));
  });
  it('handles a package that is not on the account', async () => {
    pkgMock.mockResolvedValue({ packages: [] });
    render(<POSAiPackageScreen code="ai_fraud_money_protection" title="AI Fraud Protection" />);
    expect(await screen.findByText(/isn't available on your account/)).toBeInTheDocument();
  });
});
