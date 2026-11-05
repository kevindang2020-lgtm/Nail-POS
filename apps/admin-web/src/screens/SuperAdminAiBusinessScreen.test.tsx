import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { aiBusinessOverview: vi.fn() } }));

import { superAdminAiApi } from '../api/superAdminAiApi';
import { SuperAdminAiBusinessScreen } from './SuperAdminAiBusinessScreen';

const mock = () => superAdminAiApi.aiBusinessOverview as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe('SuperAdminAiBusinessScreen', () => {
  it('renders adoption KPIs and breakdowns', async () => {
    mock().mockResolvedValue({
      savedQuestions: { total: 42, tenants: 9, byIntent: [{ intent: 'daily_summary', count: 20 }, { intent: 'revenue_summary', count: 22 }] },
      alerts: { total: 15, active: 11, tenants: 6, byMetric: [{ metricId: 'net_sales', count: 8 }, { metricId: 'no_show_rate', count: 7 }] },
    });
    render(<SuperAdminAiBusinessScreen />);
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText(/11 active/)).toBeInTheDocument();
    expect(screen.getByText('Daily Summary')).toBeInTheDocument();
    expect(screen.getByText('Net Sales')).toBeInTheDocument();
  });

  it('renders zeros honestly for an empty platform', async () => {
    mock().mockResolvedValue({ savedQuestions: { total: 0, tenants: 0, byIntent: [] }, alerts: { total: 0, active: 0, tenants: 0, byMetric: [] } });
    render(<SuperAdminAiBusinessScreen />);
    expect(await screen.findAllByText('0')).not.toHaveLength(0);
    expect(screen.getAllByText('None yet.').length).toBe(2);
  });

  it('surfaces a load failure honestly', async () => {
    mock().mockRejectedValue(new Error('Failed to load AI Business adoption.'));
    render(<SuperAdminAiBusinessScreen />);
    expect(await screen.findByText('Failed to load AI Business adoption.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
