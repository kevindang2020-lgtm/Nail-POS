// QA for the faceted Tenant Activity page: summary KPIs, an activity row with icon + severity badge, the category
// filter passing through to the API, opening the detail panel, and the empty state.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  tenantActivity: vi.fn(), tenantActivitySummary: vi.fn(),
} }));
import { superAdminApi } from '../api/superAdminApi';
import { TenantActivityScreen } from './TenantActivityScreen';

const item = (over: any = {}) => ({
  id: 'ev1', eventType: 'super_admin_tenant_created', category: 'tenant', icon: '🟢', title: 'New tenant registered',
  tenantId: 't1', tenantName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', description: 'tenant', severity: 'info',
  actorUserId: 'admin1', actorRole: 'SUPER_ADMIN', relatedRecordId: 't1', createdAt: new Date(Date.now() - 300000).toISOString(), ageLabel: '5m ago', ...over,
});
const summary = { total: 5, tenant: 1, payment: 2, hardware: 1, ai: 1, warningError: 1 };

describe('TenantActivityScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.tenantActivity as any).mockResolvedValue({ items: [item()], total: 1, page: 1, limit: 25, pageCount: 1 });
    (superAdminApi.tenantActivitySummary as any).mockResolvedValue(summary);
  });

  it('renders summary KPIs and an activity row with icon, title, salon code, and severity badge', async () => {
    render(<MemoryRouter><TenantActivityScreen /></MemoryRouter>);
    expect(await screen.findByText('New tenant registered')).toBeInTheDocument();
    expect(screen.getByText('Total Events')).toBeInTheDocument();
    expect(screen.getByText('🟢')).toBeInTheDocument();
    expect(screen.getByText(/LUXE-1001/)).toBeInTheDocument();
    expect(screen.getAllByText('Info').length).toBeGreaterThan(0);
  });

  it('passes the category filter through to the API', async () => {
    render(<MemoryRouter><TenantActivityScreen /></MemoryRouter>);
    await screen.findByText('New tenant registered');
    fireEvent.change(screen.getByDisplayValue('All categories'), { target: { value: 'payment' } });
    await waitFor(() => {
      const calls = (superAdminApi.tenantActivity as any).mock.calls;
      expect(calls.some((c: any[]) => c[0]?.category === 'payment')).toBe(true);
    });
  });

  it('opens the detail panel when a row is clicked', async () => {
    render(<MemoryRouter><TenantActivityScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('New tenant registered'));
    expect(await screen.findByText('Related record')).toBeInTheDocument();
    expect(screen.getByText('Open tenant')).toBeInTheDocument();
  });

  it('shows the empty state when there is no activity', async () => {
    (superAdminApi.tenantActivity as any).mockResolvedValue({ items: [], total: 0, page: 1, limit: 25, pageCount: 1 });
    render(<MemoryRouter><TenantActivityScreen /></MemoryRouter>);
    expect(await screen.findByText('No tenant activity matches these filters.')).toBeInTheDocument();
  });
});
