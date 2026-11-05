import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../shell/ScopeContext', () => ({ useScope: () => ({ tenantId: null, tenantName: null }) }));

const catalog = {
  dimensions: [{ key: 'payment_method', label: 'Payment method' }, { key: 'branch', label: 'Branch' }, { key: 'device_status', label: 'Device status' }],
  measures: [{ key: 'revenue_cents', label: 'Revenue', format: 'money' }, { key: 'device_count', label: 'Device count', format: 'count' }],
  visualizations: [{ key: 'donut', label: 'Donut chart' }, { key: 'table', label: 'Table' }],
  supported: { payment_method: { measures: ['revenue_cents'], source: 'paymentMethods' }, branch: { measures: ['revenue_cents'], source: 'branchComparison' }, device_status: { measures: ['device_count'], source: 'deviceStatus' } },
};
const definitions = [{ id: 'rd1', name: 'Saved Payments', dimension: 'payment_method', measure: 'revenue_cents', visualization: 'donut', rangeKey: '30d', scopeTenantId: null, filters: {}, rowLimit: 50, createdByUserId: null, createdAt: '2026-06-01', updatedAt: '2026-06-01' }];
const runMock = vi.fn();

vi.mock('../api/superAdminReportBuilderApi', () => ({
  useReportCatalog: () => ({ catalog, definitions, loading: false, error: null, reloadDefinitions: vi.fn() }),
  reportBuilderApi: { run: (...a: any[]) => runMock(...a), create: vi.fn(), remove: vi.fn(), list: vi.fn() },
}));

import { ReportBuilderScreen } from './ReportBuilderScreen';

describe('ReportBuilderScreen (Super Admin · report builder)', () => {
  beforeEach(() => runMock.mockReset());
  const renderScreen = () => render(<MemoryRouter><ReportBuilderScreen /></MemoryRouter>);

  it('renders the builder controls and saved reports', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Report Builder' })).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Run report')).toBeInTheDocument();
    expect(screen.getByText('Saved Reports')).toBeInTheDocument();
    expect(screen.getByText('Saved Payments')).toBeInTheDocument();
  });

  it('runs a report and previews real rows', async () => {
    runMock.mockResolvedValue({ ok: true, available: true, spec: { dimension: 'payment_method', measure: 'revenue_cents', visualization: 'donut', limit: 50 }, columns: ['payment method', 'Revenue'], format: 'money', source: 'paymentMethods', rows: [{ label: 'card', value: 189000000 }, { label: 'cash', value: 41000000 }], generatedAt: '2026-06-29T12:00:00.000Z' });
    renderScreen();
    fireEvent.click(screen.getByText('Run report'));
    await waitFor(() => expect(screen.getAllByText('card').length).toBeGreaterThan(0));
    expect(screen.getAllByText('cash').length).toBeGreaterThan(0); // second real row rendered
  });

  it('surfaces an honest NotConnected state when the selection has no source', async () => {
    runMock.mockResolvedValue({ ok: true, available: false, reason: 'Measure "revenue_cents" is not available for dimension "device_status".', spec: { dimension: 'device_status', measure: 'revenue_cents', visualization: 'donut', limit: 50 }, generatedAt: '2026-06-29T12:00:00.000Z' });
    renderScreen();
    fireEvent.click(screen.getByText('Run report'));
    await waitFor(() => expect(screen.getByText(/not connected/i)).toBeInTheDocument());
    expect(screen.getByText(/is not available for dimension/)).toBeInTheDocument();
  });
});
