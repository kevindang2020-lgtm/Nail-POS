import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { tipsMock } = vi.hoisted(() => ({ tipsMock: vi.fn() }));
vi.mock('../api/posReportsApi', () => ({ posReportsApi: { tips: tipsMock } }));
import { POSTeamTipsScreen } from './POSTeamTipsScreen';
beforeEach(() => tipsMock.mockReset());
const tips = { totalCents: 12000, cardTipsCents: 9000, cashTipsCents: 3000, tipPercentAvg: 18, noTipCount: 1, managerApprovalCount: 0, byTechnician: [ { technicianId: 'A', name: 'Ana', tipsCents: 8000 }, { technicianId: 'B', name: 'Ben', tipsCents: 4000 } ] };
describe('POSTeamTipsScreen', () => {
  it('renders tip KPIs + per-technician tips (sorted)', async () => {
    tipsMock.mockResolvedValue(tips);
    render(<POSTeamTipsScreen />);
    expect(await screen.findByRole('heading', { name: 'Team Tips' })).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
  });
  it('empty state when no tips', async () => {
    tipsMock.mockResolvedValue({ ...tips, byTechnician: [] });
    render(<POSTeamTipsScreen />);
    expect(await screen.findByText(/No tips recorded/)).toBeInTheDocument();
  });
});
