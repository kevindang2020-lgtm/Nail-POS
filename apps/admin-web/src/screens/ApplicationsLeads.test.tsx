// QA for the §7 intake pipeline screens. Applications: status actions send the exact transitions and Approve Package
// reflects the backend auto-hardware behavior in the refreshed row. Leads: + Add Lead body, Mark Contacted, and
// Convert to Application. All against a mocked superAdminApi with the real {rows, total} loader shape.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  applications: vi.fn(), applicationStatus: vi.fn(), applicationConvert: vi.fn(), applicationNote: vi.fn(),
  applicationConverted: vi.fn(), applicationAssign: vi.fn(), applicationPriority: vi.fn(), applicationFollowUp: vi.fn(),
  applicationContactLog: vi.fn(), applicationApprove: vi.fn(), applicationReject: vi.fn(), applicationDuplicate: vi.fn(),
  applicationSpam: vi.fn(), applicationArchive: vi.fn(), applicationEin: vi.fn(), applicationMetrics: vi.fn(),
  leads: vi.fn(), leadStatus: vi.fn(), leadConvert: vi.fn(), createLead: vi.fn(),
} }));
import { superAdminApi } from '../api/superAdminApi';
import { ApplicationsScreen } from './ApplicationsScreen';
import { LeadsScreen } from './LeadsScreen';

const app = (over: any = {}) => ({ id: 'app1', status: 'qualified', salon_name: 'Glow Nail Spa', owner_name: 'Linh T.', email: 'linh@glow.test', phone: '8565550101', city: 'Cherry Hill', state: 'NJ', technicians_count: 6, monthly_card_volume_cents: 4200000, preferred_imac_color: 'Silver', converted_tenant_id: null, ...over });

describe('ApplicationsScreen (intake pipeline)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an application with its real fields and offers the status transitions', async () => {
    (superAdminApi.applications as any).mockResolvedValue({ rows: [app()], total: 1 });
    render(<MemoryRouter><ApplicationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Glow Nail Spa')).toBeInTheDocument();
    expect(screen.getByText(/Cherry Hill, NJ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' })); // actions live in the expanded panel
    // Approve is gated on a written note (intake spec): disabled until one is typed.
    const approve = await screen.findByRole('button', { name: 'Approve Package' });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Approval note (required)'), { target: { value: 'ok to proceed' } });
    expect(approve).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Mark Qualified' })).not.toBeInTheDocument(); // already qualified
  });

  it('Approve Package sends the approved transition and the refreshed row reflects approval', async () => {
    (superAdminApi.applications as any)
      .mockResolvedValueOnce({ rows: [app()], total: 1 })
      .mockResolvedValueOnce({ rows: [app({ status: 'approved' })], total: 1 });
    (superAdminApi.applicationApprove as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><ApplicationsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.change(await screen.findByPlaceholderText('Approval note (required)'), { target: { value: 'verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Package' }));
    await waitFor(() => expect(superAdminApi.applicationApprove).toHaveBeenCalledWith('app1', 'verified'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve Package' })).not.toBeInTheDocument());
  });

  it('surfaces a load failure honestly', async () => {
    (superAdminApi.applications as any).mockRejectedValue(new Error('Failed to load applications.'));
    render(<MemoryRouter><ApplicationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Failed to load applications.')).toBeInTheDocument();
  });
});

describe('LeadsScreen (website + manual leads)', () => {
  beforeEach(() => vi.clearAllMocks());
  const lead = (over: any = {}) => ({ id: 'l1', name: 'Mai P.', salon_name: 'Polished', kind: 'demo_request', status: 'new', email: 'mai@polished.test', phone: '8565550102', city: 'Marlton', state: 'NJ', ...over });

  it('adds a lead with the typed fields', async () => {
    (superAdminApi.leads as any).mockResolvedValue({ rows: [], total: 0 });
    (superAdminApi.createLead as any).mockResolvedValue({ ok: true, id: 'l2' });
    render(<MemoryRouter><LeadsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Lead' }));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Mai P.' } });
    fireEvent.change(screen.getByPlaceholderText('Salon'), { target: { value: 'Polished' } });
    fireEvent.change(screen.getByPlaceholderText('Phone'), { target: { value: '8565550102' } });
    const createBtn = screen.getAllByRole('button').find((b) => /Create|Add|Save/.test(b.textContent || '') && b.textContent !== '+ Add Lead')!;
    fireEvent.click(createBtn);
    await waitFor(() => expect(superAdminApi.createLead).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mai P.', salon_name: 'Polished', phone: '8565550102' })));
  });

  it('Mark Contacted and Convert to Application send the exact calls', async () => {
    (superAdminApi.leads as any)
      .mockResolvedValueOnce({ rows: [lead()], total: 1 })
      .mockResolvedValue({ rows: [lead({ status: 'contacted' })], total: 1 });
    (superAdminApi.leadStatus as any).mockResolvedValue({ ok: true });
    (superAdminApi.leadConvert as any).mockResolvedValue({ ok: true, applicationId: 'app9' });
    render(<MemoryRouter><LeadsScreen /></MemoryRouter>);
    const row = (await screen.findByText('Mai P.')).closest('.row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mark Contacted' }));
    await waitFor(() => expect(superAdminApi.leadStatus).toHaveBeenCalledWith('l1', 'contacted'));
    const row2 = (await screen.findByText('Mai P.')).closest('.row') as HTMLElement;
    fireEvent.click(within(row2).getByRole('button', { name: 'Convert to Application' }));
    await waitFor(() => expect(superAdminApi.leadConvert).toHaveBeenCalledWith('l1'));
  });
});
