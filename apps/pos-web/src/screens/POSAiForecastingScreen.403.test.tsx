import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { apptMock } = vi.hoisted(() => ({ apptMock: vi.fn() }));
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: { appointments: apptMock, revenue: vi.fn(), noShowRisk: vi.fn(), accuracy: vi.fn().mockResolvedValue({ evaluated: 0, note: 'none' }) } }));
import { POSAiForecastingScreen } from './POSAiForecastingScreen';

describe('AI Forecasting permissions', () => {
  it('shows a permission message on 403', async () => {
    apptMock.mockRejectedValue({ status: 403 });
    render(<POSAiForecastingScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
