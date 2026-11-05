// Tenant Applications queue: renders the queue from /super-admin/platform/applications, requests the repo's max page size
// (so >25 applications aren't silently hidden), opens a row, drives a status action, and adds a note — all via the REAL
// platform endpoints (no duplicate paths).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { applications: vi.fn(), applicationStatus: vi.fn(), applicationNote: vi.fn(), applicationConverted: vi.fn(), applicationAssign: vi.fn(), applicationPriority: vi.fn(), applicationFollowUp: vi.fn(), applicationContactLog: vi.fn(), applicationApprove: vi.fn(), applicationReject: vi.fn(), applicationDuplicate: vi.fn(), applicationSpam: vi.fn(), applicationArchive: vi.fn(), applicationEin: vi.fn(), applicationConvertToOnboarding: vi.fn(), applicationMetrics: vi.fn() } }));

import { superAdminApi } from '../api/superAdminApi';
import { ApplicationsScreen } from './ApplicationsScreen';

const app = (over: any = {}) => ({
  id: 'app1', salon_name: 'Luxe Nails & Spa', owner_name: 'Emily Johnson', city: 'Houston', state: 'TX',
  phone: '(512) 555-8765', email: 'emily@luxenails.com', technicians_count: 6, monthly_card_volume_cents: 4500000,
  preferred_imac_color: 'Silver', source: 'website', status: 'qualified', notes: [], converted_tenant_id: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.applications as any).mockResolvedValue({ rows: [app()], total: 28 });
  (superAdminApi.applicationMetrics as any).mockResolvedValue({ received30: 12, open: 5, approved: 3, rejected: 1, duplicatesFlagged: 2, followUpsOverdue: 1, conversionRatePct: 25, avgApprovalHours: 36.5, avgFirstResponseHours: null, bySource: [{ key: 'website', count: 9 }] });
  (superAdminApi.applicationStatus as any).mockResolvedValue({ id: 'app1', status: 'approved' });
  (superAdminApi.applicationNote as any).mockResolvedValue({});
});

const renderScreen = () => render(<MemoryRouter><ApplicationsScreen /></MemoryRouter>);

describe('ApplicationsScreen', () => {
  it('renders the queue and requests the max page size so applications are not hidden', async () => {
    renderScreen();
    expect(await screen.findByText(/Luxe Nails & Spa/)).toBeInTheDocument();
    // the fix: must request pageSize 100 (repo cap) rather than the controller's default 25
    await waitFor(() => expect(superAdminApi.applications).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 })));
    // honest "first N of total" hint when capped (rows < total)
    expect(screen.getByText(/Showing first 1 of 28/)).toBeInTheDocument();
  });

  it('approves via the dedicated endpoint and REQUIRES a note (spec) — button disabled until one is typed', async () => {
    (superAdminApi.applicationApprove as any).mockResolvedValue({ id: 'app1', status: 'approved' });
    renderScreen();
    fireEvent.click(await screen.findByText('Open'));
    const btn = await screen.findByText('Approve Package');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Approval note (required)'), { target: { value: 'Verified on call' } });
    fireEvent.click(btn);
    await waitFor(() => expect(superAdminApi.applicationApprove).toHaveBeenCalledWith('app1', 'Verified on call'));
  });

  it('rejects with a required reason via the dedicated endpoint', async () => {
    (superAdminApi.applicationReject as any).mockResolvedValue({ id: 'app1', status: 'rejected' });
    renderScreen();
    fireEvent.click(await screen.findByText('Open'));
    fireEvent.change(screen.getByPlaceholderText('Rejection reason (required)'), { target: { value: 'Outside area' } });
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(superAdminApi.applicationReject).toHaveBeenCalledWith('app1', 'Outside area'));
  });

  it('shows the duplicate-risk findings and the APS reference; reveals the EIN via the audited endpoint', async () => {
    (superAdminApi.applications as any).mockResolvedValue({ rows: [app({ reference_number: 'APS-AB12-CD34', duplicate_risk_score: 50, duplicate_reasons: JSON.stringify(['Same email as application APS-X']), ein_last4: '6789' })], total: 1 });
    (superAdminApi.applicationEin as any).mockResolvedValue({ ok: true, ein: '12-3456789', last4: '6789' });
    renderScreen();
    expect(await screen.findByText(/APS-AB12-CD34/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open'));
    expect(await screen.findByText(/Risk findings/)).toBeInTheDocument();
    expect(screen.getByText(/Same email as application APS-X/)).toBeInTheDocument();
    expect(screen.getByText(/••-•••6789/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reveal EIN'));
    await waitFor(() => expect(superAdminApi.applicationEin).toHaveBeenCalledWith('app1'));
    expect(await screen.findByText('12-3456789')).toBeInTheDocument();
  });

  it('renders the real metrics strip and an honest em-dash for untracked first-response', async () => {
    renderScreen();
    expect(await screen.findByText('Received (30d)')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('36.5h')).toBeInTheDocument();
    const firstResponse = screen.getByText('Avg first response').parentElement!;
    expect(firstResponse.textContent).toContain('—');
    expect(screen.getByText(/Top source: website \(9\)/)).toBeInTheDocument();
  });

  it('starts onboarding from an approved application via the conversion endpoint', async () => {
    (superAdminApi.applications as any).mockResolvedValue({ rows: [app({ status: 'approved' })], total: 1 });
    (superAdminApi.applicationConvertToOnboarding as any).mockResolvedValue({ id: 'app1', status: 'converted_onboarding', onboarding_id: 'ob_1' });
    renderScreen();
    fireEvent.click(await screen.findByText('Open'));
    fireEvent.click(await screen.findByText('Start Onboarding'));
    await waitFor(() => expect(superAdminApi.applicationConvertToOnboarding).toHaveBeenCalledWith('app1'));
  });

  it('logs a contact attempt through the contact-log endpoint', async () => {
    (superAdminApi.applicationContactLog as any).mockResolvedValue({});
    renderScreen();
    fireEvent.click(await screen.findByText('Open'));
    fireEvent.change(screen.getByPlaceholderText(/What happened on the call/), { target: { value: 'Left voicemail' } });
    fireEvent.click(screen.getByText('Log Contact'));
    await waitFor(() => expect(superAdminApi.applicationContactLog).toHaveBeenCalledWith('app1', 'phone', 'Left voicemail'));
  });

  it('adds a note to an application', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Open'));
    fireEvent.change(await screen.findByPlaceholderText('Add a note…'), { target: { value: 'Called, left voicemail' } });
    fireEvent.click(screen.getByText('Add Note'));
    await waitFor(() => expect(superAdminApi.applicationNote).toHaveBeenCalledWith('app1', 'Called, left voicemail'));
  });

  it('filters by status tab through the backend', async () => {
    renderScreen();
    await screen.findByText(/Luxe Nails & Spa/);
    fireEvent.click(screen.getByText('approved'));   // status tab
    await waitFor(() => expect(superAdminApi.applications).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', pageSize: 100 })));
  });
});
