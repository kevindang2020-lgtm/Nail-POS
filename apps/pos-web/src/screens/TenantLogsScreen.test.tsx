import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TenantLogsScreen } from './TenantLogsScreen';

vi.mock('../api/posLogsApi', () => ({
  posLogsApi: { list: vi.fn().mockResolvedValue({ logs: [
    { id: 'l1', category: 'integration', severity: 'info', source: 'webhook', message: 'Test delivery to hooks.example.com succeeded', correlationId: null, relatedId: 'wh1', status: 'delivered', metadata: { status: 200 }, createdIso: '2026-05-06T14:00:00Z' },
    { id: 'l2', category: 'integration', severity: 'error', source: 'webhook', message: 'Delivery failed for CRM', correlationId: null, relatedId: 'wh2', status: 'failed', metadata: { status: 500 }, createdIso: '2026-05-06T13:00:00Z' },
  ] }) },
}));

describe('TenantLogsScreen', () => {
  it('renders log entries from the store', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    expect(await screen.findByText('Device & Integration Logs')).toBeInTheDocument();
    expect(await screen.findByText('Test delivery to hooks.example.com succeeded')).toBeInTheDocument();
    expect(screen.getByText('Delivery failed for CRM')).toBeInTheDocument();
  });

  it('filters by severity (client-side)', async () => {
    render(<MemoryRouter><TenantLogsScreen /></MemoryRouter>);
    await screen.findByText('Delivery failed for CRM');
    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'error' } });
    expect(screen.queryByText('Test delivery to hooks.example.com succeeded')).not.toBeInTheDocument();
    expect(screen.getByText('Delivery failed for CRM')).toBeInTheDocument();
  });
});
