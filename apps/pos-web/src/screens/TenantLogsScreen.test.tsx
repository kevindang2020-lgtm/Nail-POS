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
  it('Device Integration Logs · 03: a device event opens that device\'s own timeline on the server; the chip clears it; an integration event has no such button', async () => {
    pageMock.mockResolvedValue({ logs: [{ id: 'd1', category: 'device', severity: 'warning', source: 'customer_display', message: 'customer display offline', correlationId: null, relatedId: 'disp-1', status: null, metadata: null, createdIso: '2026-05-06T14:00:00Z' }, logs[1]], total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 1, errors: 1, device: 1, integration: 1 } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    await screen.findByTestId('lgx-detail');
    expect(screen.queryByTestId('lgx-device-history')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('lgx-detail')).toBeNull());
    fireEvent.click(screen.getAllByTestId('lgx-view')[0]);
    fireEvent.click(await screen.findByTestId('lgx-device-history'));
    await waitFor(() => expect(pageMock).toHaveBeenLastCalledWith(expect.objectContaining({ relatedId: 'disp-1', category: 'device', severity: 'all', page: 1 })));
    expect(screen.queryByTestId('lgx-detail')).toBeNull();
    fireEvent.click(await screen.findByTestId('lgx-device-chip'));
    await waitFor(() => expect(pageMock.mock.calls.slice(-1)[0]![0].relatedId).toBeUndefined());
  });
  it('an event opens its details', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[1]);
    expect(await screen.findByTestId('lgx-detail')).toBeInTheDocument();
  });
  it('Customer-impact context: a device event says what that device is for; an integration event does not', async () => {
    pageMock.mockResolvedValue({ logs: [{ id: 'd1', category: 'device', severity: 'warning', source: 'payment_terminal', message: 'terminal offline', correlationId: null, relatedId: 't1', status: null, metadata: null, createdIso: '2026-05-06T14:00:00Z' }, logs[1]], total: 2, page: 1, pageSize: 25, totalPages: 1, summary: { events: 2, warnings: 1, errors: 1, device: 1, integration: 1 } });
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lgx-view'))[0]);
    expect(await screen.findByTestId('lgx-impact')).toHaveTextContent(/card payments/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('lgx-detail')).toBeNull());
    fireEvent.click(screen.getAllByTestId('lgx-view')[1]);
    await screen.findByTestId('lgx-detail');
    expect(screen.queryByTestId('lgx-impact')).toBeNull();
  });
});
