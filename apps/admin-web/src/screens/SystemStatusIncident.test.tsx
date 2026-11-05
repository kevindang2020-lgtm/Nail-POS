import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateIncidentModal, PublishUpdateModal, ScheduleMaintenanceModal, PostIncidentReportModal, NotifyTenantsModal } from './SystemStatusIncident';

const createIncident = vi.fn();
const publishStatusUpdate = vi.fn();
const scheduleMaintenance = vi.fn();
const createPostIncidentReport = vi.fn();
const notifyTenants = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { createIncident: (...a: any[]) => createIncident(...a), publishStatusUpdate: (...a: any[]) => publishStatusUpdate(...a), scheduleMaintenance: (...a: any[]) => scheduleMaintenance(...a), createPostIncidentReport: (...a: any[]) => createPostIncidentReport(...a), notifyTenants: (...a: any[]) => notifyTenants(...a) } }));

const services = [
  { key: 'booking', service: 'Booking System', category: 'Application', status: 'degraded', statusLabel: 'Degraded Performance', uptimePct: 99.45, responseTimeMs: 820, ownerTeam: 'Platform Team', affectedTenants: 28, lastIncidentAt: null },
  { key: 'payments', service: 'Payment Processing', category: 'Payments', status: 'operational', statusLabel: 'Operational', uptimePct: 99.99, responseTimeMs: 180, ownerTeam: 'Payments Team', affectedTenants: 0, lastIncidentAt: null },
] as any;

describe('CreateIncidentModal', () => {
  beforeEach(() => { createIncident.mockReset(); createIncident.mockResolvedValue({ ok: true, incident: { incidentId: 'INC-2026-0506-101', service: 'Payment Processing', severity: 'High', status: 'Investigating' } }); });

  it('requires a title', () => {
    render(<CreateIncidentModal services={services} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Create incident'));
    expect(screen.getByText(/incident title is required/)).toBeInTheDocument();
    expect(createIncident).not.toHaveBeenCalled();
  });

  it('creates an incident and reports it starts Investigating', async () => {
    const onCreated = vi.fn();
    render(<CreateIncidentModal services={services} onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Checkout errors' } });
    fireEvent.change(screen.getByLabelText('Affected service'), { target: { value: 'payments' } });
    fireEvent.click(screen.getByText('Create incident'));
    await waitFor(() => expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ title: 'Checkout errors', componentKey: 'payments' })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/Investigating/)));
  });
});


describe('PublishUpdateModal', () => {
  beforeEach(() => { publishStatusUpdate.mockReset(); publishStatusUpdate.mockResolvedValue({ ok: true, update: { title: 'X', audience: 'All Tenants', status: 'Published' } }); });
  it('requires a title', () => {
    render(<PublishUpdateModal onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Publish update'));
    expect(screen.getByText(/update title is required/)).toBeInTheDocument();
    expect(publishStatusUpdate).not.toHaveBeenCalled();
  });
  it('publishes to the chosen audience', async () => {
    const onDone = vi.fn();
    render(<PublishUpdateModal onClose={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Recovery update' } });
    fireEvent.click(screen.getByText('Publish update'));
    await waitFor(() => expect(publishStatusUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recovery update', audience: 'all_tenants' })));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/published/i)));
  });
});

describe('ScheduleMaintenanceModal', () => {
  beforeEach(() => { scheduleMaintenance.mockReset(); scheduleMaintenance.mockResolvedValue({ ok: true, maintenance: { service: 'Database', scope: 'Global', noticeStatus: 'Published' } }); });
  it('rejects a window that ends before it starts', () => {
    render(<ScheduleMaintenanceModal services={services} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('Window start'), { target: { value: '2026-05-08T01:00' } });
    fireEvent.change(screen.getByLabelText('Window end'), { target: { value: '2026-05-07T23:00' } });
    fireEvent.click(screen.getByText('Schedule maintenance'));
    expect(screen.getByText(/cannot end before it starts/)).toBeInTheDocument();
    expect(scheduleMaintenance).not.toHaveBeenCalled();
  });
  it('schedules maintenance for a valid window', async () => {
    const onDone = vi.fn();
    render(<ScheduleMaintenanceModal services={services} onClose={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Window start'), { target: { value: '2026-05-09T23:00' } });
    fireEvent.change(screen.getByLabelText('Window end'), { target: { value: '2026-05-10T01:00' } });
    fireEvent.click(screen.getByText('Schedule maintenance'));
    await waitFor(() => expect(scheduleMaintenance).toHaveBeenCalled());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});


describe('PostIncidentReportModal', () => {
  const incidents = [{ incidentId: 'INC-2026-0506-001', service: 'Booking System', severity: 'High', status: 'Investigating', startedAt: '', affectedTenants: 28 }] as any;
  beforeEach(() => { createPostIncidentReport.mockReset(); createPostIncidentReport.mockResolvedValue({ ok: true, report: { reportReference: 'PIR-2026-0506-101', title: 'RCA', status: 'Published' } }); });
  it('requires title and related incident', () => {
    render(<PostIncidentReportModal incidents={[] as any} onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Create report'));
    expect(screen.getByText(/report title is required/)).toBeInTheDocument();
    expect(createPostIncidentReport).not.toHaveBeenCalled();
  });
  it('creates a report', async () => {
    const onDone = vi.fn();
    render(<PostIncidentReportModal incidents={incidents} onClose={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Booking RCA' } });
    fireEvent.click(screen.getByText('Create report'));
    await waitFor(() => expect(createPostIncidentReport).toHaveBeenCalledWith(expect.objectContaining({ title: 'Booking RCA', incidentReference: 'INC-2026-0506-001' })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});


describe('NotifyTenantsModal', () => {
  const incidents = [{ incidentId: 'INC-2026-0506-001', service: 'Booking System', severity: 'High', status: 'Investigating', startedAt: '', affectedTenants: 28 }] as any;
  beforeEach(() => { notifyTenants.mockReset(); notifyTenants.mockResolvedValue({ ok: true, sent: { channel: 'Email', audience: 'affected_tenants', message: 'Hi' } }); });
  it('requires a message', () => {
    render(<NotifyTenantsModal incidents={incidents} onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Send notification'));
    expect(screen.getByText(/message is required/)).toBeInTheDocument();
    expect(notifyTenants).not.toHaveBeenCalled();
  });
  it('sends a notification to affected tenants', async () => {
    const onDone = vi.fn();
    render(<NotifyTenantsModal incidents={incidents} onClose={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Customer-safe message'), { target: { value: 'Investigating latency' } });
    fireEvent.click(screen.getByText('Send notification'));
    await waitFor(() => expect(notifyTenants).toHaveBeenCalledWith(expect.objectContaining({ message: 'Investigating latency' })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
