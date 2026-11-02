import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, createMock, updateMock, deleteMock, evalMock } = vi.hoisted(() => ({ listMock: vi.fn(), createMock: vi.fn(), updateMock: vi.fn(), deleteMock: vi.fn(), evalMock: vi.fn() }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { alertsList: listMock, alertCreate: createMock, alertUpdate: updateMock, alertDelete: deleteMock, alertEvaluate: evalMock } }));
import { POSAiAlertsScreen } from './POSAiAlertsScreen';

const alert = (o: any = {}) => ({ id: 'al1', title: 'Low revenue', metricId: 'net_sales', operator: 'lt', threshold: 500000, preset: 'today', minSampleSize: 5, frequency: 'daily', channel: 'in_app', active: true, createdAt: '2026-07-01', lastCheckedAt: null, lastTriggeredAt: null, ...o });

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([alert()]);
  createMock.mockReset().mockResolvedValue(alert());
  updateMock.mockReset().mockResolvedValue(alert());
  deleteMock.mockReset().mockResolvedValue({ deleted: true });
  evalMock.mockReset();
});

describe('POSAiAlertsScreen', () => {
  it('lists existing alerts with formatted money threshold', async () => {
    render(<POSAiAlertsScreen />);
    expect(await screen.findByText('Low revenue')).toBeInTheDocument();
    expect(screen.getByText(/\$5,000\.00/)).toBeInTheDocument(); // 500000 cents formatted
  });

  it('creates a money alert converting dollars to cents', async () => {
    listMock.mockResolvedValue([]);
    render(<POSAiAlertsScreen />);
    await screen.findByText(/No alerts yet/);
    fireEvent.change(screen.getByPlaceholderText('Alert name'), { target: { value: 'Rev floor' } });
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Alert' }));   // Sep 2026 redesign: title-case label
    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rev floor', metricId: 'net_sales', operator: 'lt', threshold: 500000, preset: 'today' })));
  });

  it('evaluates an alert and shows the result', async () => {
    evalMock.mockResolvedValue({ metricId: 'net_sales', unit: 'currency_cents', value: 420000, threshold: 500000, operator: 'lt', sampleSize: 30, sampleOk: true, triggered: true, reason: 'net_sales (420000) is below 500000.' });
    render(<POSAiAlertsScreen />);
    fireEvent.click(await screen.findByText('Evaluate now'));
    expect(await screen.findByText('Would fire')).toBeInTheDocument();
    expect(screen.getByText(/value \$4,200\.00/)).toBeInTheDocument();
  });
});
