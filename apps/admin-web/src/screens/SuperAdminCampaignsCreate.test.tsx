import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateAnnouncementModal } from './SuperAdminCampaignsCreate';

const createAnnouncement = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { createAnnouncement: (...a: any[]) => createAnnouncement(...a) } }));

const tenants = [{ id: 't1', name: 'Glamour Studio' }, { id: 't2', name: 'Luxe Salon' }];

describe('CreateAnnouncementModal', () => {
  beforeEach(() => { createAnnouncement.mockReset(); createAnnouncement.mockResolvedValue({ ok: true, announcement: { id: 'PANN-0001', title: 'Holiday Notice', status: 'draft', audienceSize: 20 } }); });

  it('requires a title', () => {
    render(<CreateAnnouncementModal tenantOptions={tenants} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Create announcement'));
    expect(screen.getByText(/A title is required/)).toBeInTheDocument();
    expect(createAnnouncement).not.toHaveBeenCalled();
  });

  it('requires targets when scope is selected-tenants', () => {
    render(<CreateAnnouncementModal tenantOptions={tenants} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'selected_tenants' } });
    fireEvent.click(screen.getByText('Create announcement'));
    expect(screen.getByText(/Select at least one tenant/)).toBeInTheDocument();
    expect(createAnnouncement).not.toHaveBeenCalled();
  });

  it('creates an all-tenants announcement', async () => {
    const onCreated = vi.fn();
    render(<CreateAnnouncementModal tenantOptions={tenants} onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Holiday Notice' } });
    fireEvent.click(screen.getByText('Create announcement'));
    await waitFor(() => expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'Holiday Notice', audienceScope: 'all_tenants', tenantIds: [] })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/Holiday Notice/)));
  });

  it('creates a selected-tenants announcement with chosen tenant ids', async () => {
    render(<CreateAnnouncementModal tenantOptions={tenants} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'selected_tenants' } });
    fireEvent.click(screen.getByLabelText('Glamour Studio'));
    fireEvent.click(screen.getByText('Create announcement'));
    await waitFor(() => expect(createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ audienceScope: 'selected_tenants', tenantIds: ['t1'] })));
  });
});
