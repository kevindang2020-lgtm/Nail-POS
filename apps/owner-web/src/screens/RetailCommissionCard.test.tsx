import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetailCommissionCard } from './RetailCommissionCard';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { retailPolicy: vi.fn(), setRetailPolicy: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.retailPolicy as any).mockResolvedValue({ method: 'none', value: 0 });
  (ownerCompensationApi.setRetailPolicy as any).mockResolvedValue({ method: 'percent', value: 10 });
});

describe('RetailCommissionCard', () => {
  it('loads the current policy (none by default)', async () => {
    render(<RetailCommissionCard />);
    await waitFor(() => expect((screen.getByLabelText('Retail method') as HTMLSelectElement).value).toBe('none'));
  });

  it('saves a percent rate', async () => {
    render(<RetailCommissionCard />);
    await waitFor(() => expect(screen.getByLabelText('Retail method')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Retail method'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Retail value'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(ownerCompensationApi.setRetailPolicy).toHaveBeenCalledWith({ method: 'percent', value: 10 }));
  });

  it('sends fixed amounts in cents', async () => {
    (ownerCompensationApi.setRetailPolicy as any).mockResolvedValue({ method: 'fixed', value: 500 });
    render(<RetailCommissionCard />);
    await waitFor(() => expect(screen.getByLabelText('Retail method')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Retail method'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Retail value'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(ownerCompensationApi.setRetailPolicy).toHaveBeenCalledWith({ method: 'fixed', value: 500 }));
  });
});
