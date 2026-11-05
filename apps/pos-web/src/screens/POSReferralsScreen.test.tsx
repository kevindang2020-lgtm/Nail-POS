import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, recordMock, rewardMock, searchMock } = vi.hoisted(() => ({ stateMock: vi.fn(), recordMock: vi.fn(), rewardMock: vi.fn(), searchMock: vi.fn() }));
vi.mock('../api/posReferralsApi', () => ({ posReferralsApi: { state: stateMock, record: recordMock, reward: rewardMock } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock } }));
import { POSReferralsScreen } from './POSReferralsScreen';

const emptyState = { kpis: { codesIssued: 3, totalReferrals: 0, pendingReferrals: 0, rewardedReferrals: 0, rewardValueCents: 0 }, redemptions: [] };
const withRow = { kpis: { codesIssued: 3, totalReferrals: 1, pendingReferrals: 1, rewardedReferrals: 0, rewardValueCents: 0 }, redemptions: [{ id: 'ref_1', referrerName: 'Alice', referredName: 'Bob', code: 'ALICE10', status: 'pending', rewardCents: 0, redeemedAt: '2026-07-01T00:00:00.000Z', rewardedAt: null }] };
beforeEach(() => { stateMock.mockReset(); recordMock.mockReset(); rewardMock.mockReset(); searchMock.mockReset(); });

describe('POSReferralsScreen', () => {
  it('shows KPIs and an empty referrals state', async () => {
    stateMock.mockResolvedValue(emptyState);
    render(<POSReferralsScreen />);
    expect(await screen.findByText('Referral Program')).toBeInTheDocument();
    // Sep 2026 redesign: each KPI is a .panel whose label is followed by its value
    expect(screen.getByText('Referral Codes').nextElementSibling?.textContent).toBe('3');
    expect(screen.getByText('No referrals recorded yet.')).toBeInTheDocument();
  });
  it('records a referral: search, pick, submit', async () => {
    stateMock.mockResolvedValue(emptyState);
    searchMock.mockResolvedValue({ items: [{ customerId: 'cust_b', fullName: 'Bob New', phone: '555-2000' }] });
    recordMock.mockResolvedValue({ id: 'ref_1' });
    render(<POSReferralsScreen />);
    await screen.findByText('Referral Program');
    fireEvent.change(screen.getByPlaceholderText('e.g. ALICE10'), { target: { value: 'ALICE10' } });
    fireEvent.change(screen.getByPlaceholderText(/Search customer/), { target: { value: 'Bob' } });
    fireEvent.click(await screen.findByText(/Bob New/));
    fireEvent.click(screen.getByRole('button', { name: 'Record referral' }));
    await waitFor(() => expect(recordMock).toHaveBeenCalledWith('ALICE10', 'cust_b'));
  });
  it('rewards a pending referral in cents', async () => {
    stateMock.mockResolvedValue(withRow);
    rewardMock.mockResolvedValue({});
    render(<POSReferralsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reward' }));
    fireEvent.change(screen.getByLabelText('Reward amount'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(rewardMock).toHaveBeenCalledWith('ref_1', 1500));
  });
});
