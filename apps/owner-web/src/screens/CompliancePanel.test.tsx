import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompliancePanel } from './CompliancePanel';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { classifications: vi.fn(), setClassification: vi.fn(), wageConfig: vi.fn(), setWageConfig: vi.fn(), compliancePreview: vi.fn(), compliancePeriodReview: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.classifications as any).mockResolvedValue([{ technicianId: 'tech1', classification: 'contractor', updatedAt: '2026-01-01' }]);
  (ownerCompensationApi.setClassification as any).mockResolvedValue({ technicianId: 'tech9', classification: 'employee', updatedAt: '2026-01-01' });
  (ownerCompensationApi.wageConfig as any).mockResolvedValue({ minHourlyWageCents: 1500, overtimeThresholdHours: 40 });
  (ownerCompensationApi.setWageConfig as any).mockResolvedValue({ minHourlyWageCents: 1500, overtimeThresholdHours: 40 });
  (ownerCompensationApi.compliancePreview as any).mockResolvedValue({ technicianId: 'tech1', classification: 'employee', classificationSet: true, wageConfig: { minHourlyWageCents: 1500, overtimeThresholdHours: 40 }, flags: [{ code: 'below_minimum_wage', message: 'Effective hourly $7.50 is below the configured minimum wage $15.00.' }] });
});

describe('CompliancePanel', () => {
  it('loads classifications and the wage config', async () => {
    render(<CompliancePanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    expect(screen.getAllByText(/Contractor/).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Minimum wage') as HTMLInputElement).value).toBe('15.00');
  });

  it('sets a technician classification', async () => {
    render(<CompliancePanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Classification technician'), { target: { value: 'tech9' } });
    fireEvent.click(screen.getByText('Set'));
    await waitFor(() => expect(ownerCompensationApi.setClassification).toHaveBeenCalledWith('tech9', 'employee'));
  });

  it('saves wage thresholds in cents', async () => {
    render(<CompliancePanel />);
    await waitFor(() => expect(screen.getByLabelText('Minimum wage')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Minimum wage'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Overtime threshold'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Save thresholds'));
    await waitFor(() => expect(ownerCompensationApi.setWageConfig).toHaveBeenCalledWith({ minHourlyWageCents: 1500, overtimeThresholdHours: 40 }));
  });

  it('reviews a technician and shows the compliance flag', async () => {
    render(<CompliancePanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Review technician'), { target: { value: 'tech1' } });
    fireEvent.change(screen.getByLabelText('Review pay'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Review hours'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(ownerCompensationApi.compliancePreview).toHaveBeenCalledWith({ technicianId: 'tech1', periodPayCents: 30000, hoursWorked: 40 }));
    expect(screen.getAllByText(/minimum wage/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Effective hourly/)).toBeInTheDocument();
  });

  it('reviews a built payroll period and lists flagged technicians', async () => {
    (ownerCompensationApi.compliancePeriodReview as any).mockResolvedValue([
      { technicianId: 'tech1', technicianName: 'Alex', classification: 'employee', payableCents: 30000, hoursWorked: 40, flags: [{ code: 'below_minimum_wage', message: 'below the configured minimum wage' }] },
      { technicianId: 'tech2', technicianName: 'Sam', classification: 'contractor', payableCents: 100000, hoursWorked: 40, flags: [] },
    ]);
    render(<CompliancePanel />);
    await waitFor(() => expect(screen.getByText(/Tech tech1/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Period review id'), { target: { value: 'period-1' } });
    fireEvent.click(screen.getByText('Review period'));
    await waitFor(() => expect(ownerCompensationApi.compliancePeriodReview).toHaveBeenCalledWith('period-1'));
    expect(screen.getByText(/1 of 2 technicians flagged/)).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
  });
});
