// Audit Logs: paged platform audit trail from GET /super-admin/platform/audit-logs. Verifies rows render, pagination
// requests the next page, Apply sends only the active filters (resetting to page 1), and Clear sends NO stale filters
// (regression lock for the documented "bug #13" stale-closure fix).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { auditLogs: vi.fn() } }));

import { superAdminApi } from '../api/superAdminApi';
import { AuditLogsScreen } from './AuditLogsScreen';

const entry = (over: any = {}) => ({ id: 'a1', action_type: 'super_admin_support_access_started', entity_type: 'tenant', created_at: '2026-06-17T12:00:00Z', role: 'SUPER_ADMIN', user_id: 'usr_12345678', tenant_id: 'tnt_87654321', entity_id: 'ent_abcdef123456', metadata_json: { reason: 'view_pos' }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.auditLogs as any).mockResolvedValue({ rows: [entry()], total: 120 });
});

const renderScreen = () => render(<MemoryRouter><AuditLogsScreen /></MemoryRouter>);

describe('AuditLogsScreen', () => {
  it('renders entries and a multi-page footer for 120 entries at 50/page', async () => {
    renderScreen();
    expect(await screen.findByText('super_admin_support_access_started')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();       // ceil(120/50) = 3
    expect(screen.getByRole('button', { name: '‹ Prev' })).toBeDisabled();
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
  });

  it('requests the next page when Next is clicked', async () => {
    renderScreen();
    await screen.findByText('super_admin_support_access_started');
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50 })));
  });

  it('applies only the active filters and resets to page 1', async () => {
    renderScreen();
    await screen.findByText('super_admin_support_access_started');
    fireEvent.change(screen.getByPlaceholderText(/Action contains/), { target: { value: 'support_access' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith({ action: 'support_access', page: 1, pageSize: 50 }));
  });

  it('quick-filter chip applies its action substring and resets to page 1', async () => {
    renderScreen();
    await screen.findByText('super_admin_support_access_started');
    fireEvent.click(screen.getByText('User mgmt'));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith({ action: 'super_admin_user_', page: 1, pageSize: 50 }));
  });

  it('Clear sends no stale filters (bug #13 regression)', async () => {
    renderScreen();
    await screen.findByText('super_admin_support_access_started');
    fireEvent.change(screen.getByPlaceholderText(/Action contains/), { target: { value: 'support_access' } });
    fireEvent.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith(expect.objectContaining({ action: 'support_access' })));
    fireEvent.click(screen.getByText('Clear'));
    // the very next request must carry ONLY paging — not the previously-applied action filter
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 }));
  });

  it('starts from the action / entity / tenant / date filters in the URL (the overview hands them over)', async () => {
    render(<MemoryRouter initialEntries={['/audit-logs/browse?action=support_access&tenantId=t1']}><AuditLogsScreen /></MemoryRouter>);
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith(expect.objectContaining({ action: 'support_access', tenantId: 't1', page: 1 })));
    expect((screen.getByPlaceholderText(/Action contains/) as HTMLInputElement).value).toBe('support_access');
  });
});
