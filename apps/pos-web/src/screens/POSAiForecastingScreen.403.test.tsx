import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { apptMock } = vi.hoisted(() => ({ apptMock: vi.fn() }));
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: { appointments: apptMock, revenue: vi.fn(), noShowRisk: vi.fn(), accuracy: vi.fn().mockResolvedValue({ evaluated: 0, note: 'none' }), readiness: vi.fn().mockResolvedValue({ appointments: { historyDays: 0, minimum: 14, ready: false, daysShort: 14 }, revenue: { restricted: true }, sources: { appointments: 'booking_calendar', revenue: 'sales_report' } }) } }));
import { POSAiForecastingScreen } from './POSAiForecastingScreen';

describe('AI Forecasting permissions', () => {
  it('shows a permission message on 403', async () => {
    apptMock.mockRejectedValue({ status: 403 });
    render(<POSAiForecastingScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
