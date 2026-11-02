// RewardsCatalogPanel.test.tsx — Decision 15: owners/managers add, edit and archive rewards (each worth an amount or a
// percent); everyone else only sees the catalog; the server's validation message is shown.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createReward = vi.fn(); const updateReward = vi.fn();
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: { createReward: (...a: any[]) => createReward(...a), updateReward: (...a: any[]) => updateReward(...a) } }));
import { RewardsCatalogPanel, rewardValueLabel } from './RewardsCatalogPanel';

const rows = [
  { id: 'r1', title: '$10 off', pointsCost: 500, active: true, rewardType: 'amount_off' as const, valueCents: 1000, percent: 0, validDays: null },
  { id: 'r2', title: 'VIP 15%', pointsCost: 900, active: false, rewardType: 'percent_off' as const, valueCents: 0, percent: 15, validDays: 30 },
  { id: 'r3', title: 'Old reward', pointsCost: 200, active: true },
];
beforeEach(() => { createReward.mockReset().mockResolvedValue({}); updateReward.mockReset().mockResolvedValue({}); });

describe('RewardsCatalogPanel', () => {
  it('shows what each reward is worth — including an old one with no value', () => {
    render(<RewardsCatalogPanel rewards={rows} canManage={false} onChanged={() => {}} />);
    expect(screen.getByText('$10.00 off')).toBeInTheDocument();
    expect(screen.getByText('15% off')).toBeInTheDocument();
    expect(screen.getByText('No value set')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });
  it('staff who cannot manage rewards get no Add / Edit / Archive', () => {
    render(<RewardsCatalogPanel rewards={rows} canManage={false} onChanged={() => {}} />);
    for (const name of ['Add reward', 'Edit', 'Archive', 'Restore']) expect(screen.queryByRole('button', { name })).toBeNull();
  });
  it('a manager adds a $10-off reward valid 60 days', async () => {
    const onChanged = vi.fn();
    render(<RewardsCatalogPanel rewards={[]} canManage onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reward' }));
    fireEvent.change(screen.getByLabelText('Reward name'), { target: { value: '$10 off any service' } });
    fireEvent.change(screen.getByLabelText('Points cost'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Dollars off'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Valid days'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reward' }));
    await waitFor(() => expect(createReward).toHaveBeenCalledWith({ title: '$10 off any service', pointsCost: 500, rewardType: 'amount_off', valueCents: 1000, percent: 0, validDays: 60 }));
    expect(onChanged).toHaveBeenCalled();
  });
  it('a percent reward sends the percent, and the server refusal is shown', async () => {
    createReward.mockRejectedValue(new Error('Enter a percent between 1 and 100.'));
    render(<RewardsCatalogPanel rewards={[]} canManage onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reward' }));
    fireEvent.change(screen.getByLabelText('Reward name'), { target: { value: 'Big' } });
    fireEvent.change(screen.getByLabelText('Points cost'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('Percent off'));
    fireEvent.change(screen.getByLabelText('Percent value'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reward' }));
    expect(await screen.findByText('Enter a percent between 1 and 100.')).toBeInTheDocument();
    expect(createReward.mock.calls[0][0]).toMatchObject({ rewardType: 'percent_off', percent: 150, valueCents: 0 });
  });
  it('edit and archive / restore go to the server', async () => {
    render(<RewardsCatalogPanel rewards={rows} canManage onChanged={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0]);
    await waitFor(() => expect(updateReward).toHaveBeenCalledWith('r1', { active: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(updateReward).toHaveBeenCalledWith('r2', { active: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect((screen.getByLabelText('Dollars off') as HTMLInputElement).value).toBe('10.00');
  });
  it('labels', () => { expect(rewardValueLabel({ rewardType: 'amount_off', valueCents: 250 })).toBe('$2.50 off'); });
});
