import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ metrics: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { aiBookingMetrics: (t: string, d?: number) => h.metrics(t, d) } }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { state: vi.fn().mockResolvedValue({ tenants: [{ id: 'ten_1', name: 'Belle Palace' }] }) } }));
import AiBookingAnalyticsScreen from './AiBookingAnalyticsScreen';

beforeEach(() => h.metrics.mockReset());

describe('AiBookingAnalyticsScreen', () => {
  it('renders overall conversion and the per-source breakdown', async () => {
    h.metrics.mockResolvedValue({
      overall: { searches: 10, attempts: 6, successes: 3, failures: 2, handoffs: 0, bookingConversionRate: 0.5, searchToBookingRate: 0.3 },
      bySource: [{ source: 'FRONT_DESK_POS', searches: 6, attempts: 4, successes: 2, failures: 1, handoffs: 0, bookingConversionRate: 0.5, searchToBookingRate: 0.3333 }],
      failureReasons: [{ reason: 'APPOINTMENT_CONFLICT', count: 1 }],
    });
    render(<AiBookingAnalyticsScreen />);
    await waitFor(() => expect(screen.getByText('Booking conversion')).toBeInTheDocument());
    // overall conversion: the value sits in the 'Booking conversion' card (the per-source row is also 50% in this data)
    expect(screen.getByText('Booking conversion').parentElement).toHaveTextContent('50%');
    expect(screen.getByText('Front Desk')).toBeInTheDocument();   // source label
    expect(screen.getByText('APPOINTMENT_CONFLICT')).toBeInTheDocument();
  });

  it('shows an honest empty state when no activity is recorded', async () => {
    h.metrics.mockResolvedValue({ overall: { searches: 0, attempts: 0, successes: 0, failures: 0, handoffs: 0, bookingConversionRate: 0, searchToBookingRate: 0 }, bySource: [], failureReasons: [] });
    render(<AiBookingAnalyticsScreen />);
    await waitFor(() => expect(screen.getByText(/No booking activity recorded/)).toBeInTheDocument());
  });
});
