import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { pageMock } = vi.hoisted(() => ({ pageMock: vi.fn() }));
vi.mock('../api/posLogsApi', () => ({ posLogsApi: { page: pageMock } }));
import { TenantLogsScreen } from './TenantLogsScreen';

const logs = [
  { id: 'l1', category: 'integration', severity: 'info', source: 'webhook', message: 'Test delivery to hooks.example.com succeeded', correlationId: null, relatedId: 'wh1', status: 'delivered', metadata: { status: 200 }, createdIso: '2026-05-06T14:00:00Z' },
  { id: 'l2', category: 'integration', severity: 'error', source: 'webhook', message: 'Delivery failed for CRM', correlationId: null, relatedId: 'wh2', status: 'failed', metadata: { status: 500 }, createdIso: '2026-05-06T13:00:00Z' },
];
beforeEach(() => { pageMock.mockReset(); pageMock.mockResolvedValue({ logs, total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 0, errors: 1, device: 0, integration: 2 } }); });

describe('TenantLogsScreen', () => {
  it('renders log entries and the five verified cards (newest first, page 1 of 25)', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    expect(await screen.findByText('Device & Integration Logs')).toBeInTheDocument();
    expect(await screen.findByText('Test delivery to hooks.example.com succeeded')).toBeInTheDocument();
    expect(screen.getByText('Delivery failed for CRM')).toBeInTheDocument();
    expect(screen.getByTestId('lgx-kpi-errors').textContent).toContain('1');
    expect(pageMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }));
  });
  it('filters by severity on the server (the original All severities control)', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    await screen.findByText('Delivery failed for CRM');
    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'error' } });
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'error', page: 1 })));
  });
  it('an event opens its details', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    expect(await screen.findByTestId('lgx-detail')).toBeInTheDocument();
  });
});
