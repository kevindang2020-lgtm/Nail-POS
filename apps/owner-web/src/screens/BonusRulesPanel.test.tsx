import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BonusRulesPanel } from './BonusRulesPanel';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { bonusRules: vi.fn(), createBonusRule: vi.fn(), archiveBonusRule: vi.fn(), previewBonuses: vi.fn(), approveBonus: vi.fn(), bonusPeriodReview: vi.fn() } }));

const rule = () => ({ id: 'br1', technicianId: null, branchId: null, metric: 'service_production' as const, target: 500000, amountCents: 20000, label: 'Prod', status: 'active', effectiveStart: '2026-01-01', createdAt: '2026-01-01' });

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.bonusRules as any).mockResolvedValue([rule()]);
  (ownerCompensationApi.createBonusRule as any).mockResolvedValue(rule());
  (ownerCompensationApi.archiveBonusRule as any).mockResolvedValue({ ok: true });
  (ownerCompensationApi.previewBonuses as any).mockResolvedValue({ technicianId: 'tech1', facts: { serviceProductionCents: 520000 }, bonuses: [{ label: 'Prod', metric: 'service_production', qualified: true, earnedCents: 20000, metricValue: 520000, target: 500000 }], totalEarnedCents: 20000 });
  (ownerCompensationApi.approveBonus as any).mockResolvedValue({ ok: true, status: 'approved', amountCents: 20000 });
});

describe('BonusRulesPanel', () => {
  it('lists existing rules', async () => {
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
  });

  it('creates a production-target rule with dollars converted to cents', async () => {
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Bonus target'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Bonus amount'), { target: { value: '200' } });
    fireEvent.click(screen.getByText('Add rule'));
    await waitFor(() => expect(ownerCompensationApi.createBonusRule).toHaveBeenCalled());
    expect((ownerCompensationApi.createBonusRule as any).mock.calls[0][0]).toMatchObject({ metric: 'service_production', target: 500000, amountCents: 20000 });
  });

  it('previews earned bonuses for a technician', async () => {
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Preview technician'), { target: { value: 'tech1' } });
    fireEvent.change(screen.getByLabelText('Preview from'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Preview to'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(ownerCompensationApi.previewBonuses).toHaveBeenCalled());
    expect(screen.getByText(/Total earned/)).toBeInTheDocument();
    expect(screen.getAllByText(/200\.00/).length).toBeGreaterThan(0);
  });

  it('approves a qualified bonus into a payroll period', async () => {
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Preview technician'), { target: { value: 'tech1' } });
    fireEvent.change(screen.getByLabelText('Preview from'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Preview to'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByLabelText('Approve period')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Approve period'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(ownerCompensationApi.approveBonus).toHaveBeenCalledWith({ technicianId: 'tech1', periodId: 'p1', amountCents: 20000, label: 'Prod' }));
  });

  it('archives a rule', async () => {
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Archive'));
    await waitFor(() => expect(ownerCompensationApi.archiveBonusRule).toHaveBeenCalledWith('br1'));
  });

  it('reviews qualified bonuses across a period and can approve one', async () => {
    (ownerCompensationApi.bonusPeriodReview as any).mockResolvedValue({ periodId: 'p1', grandTotalCents: 20000, technicians: [{ technicianId: 'tech1', totalEarnedCents: 20000, bonuses: [{ label: 'Prod', metric: 'service_production', qualified: true, earnedCents: 20000, metricValue: 520000, target: 500000 }] }] });
    render(<BonusRulesPanel />);
    await waitFor(() => expect(screen.getByText(/Prod/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Bonus period review id'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('Review period bonuses'));
    await waitFor(() => expect(ownerCompensationApi.bonusPeriodReview).toHaveBeenCalledWith('p1'));
    expect(screen.getByText(/Tech tech1/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Approve')[screen.getAllByText('Approve').length - 1]);
    await waitFor(() => expect(ownerCompensationApi.approveBonus).toHaveBeenCalledWith({ technicianId: 'tech1', periodId: 'p1', amountCents: 20000, label: 'Prod' }));
  });
});
