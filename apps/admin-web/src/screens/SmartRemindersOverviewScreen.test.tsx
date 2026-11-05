import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockListTpl, mockCreateTpl, mockPreviewTpl, mockPublishTpl, mockGetTiming, mockSetTiming, mockGetEff, mockSetOvr, mockRevertOvr, mockGetFlow, mockDisableFlow, mockEnableFlow, mockGetCh, mockSetCh, mockListPf, mockSetPf, mockExport } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockListTpl: vi.fn(), mockCreateTpl: vi.fn(), mockPreviewTpl: vi.fn(), mockPublishTpl: vi.fn(), mockGetTiming: vi.fn(), mockSetTiming: vi.fn(), mockGetEff: vi.fn(), mockSetOvr: vi.fn(), mockRevertOvr: vi.fn(), mockGetFlow: vi.fn(), mockDisableFlow: vi.fn(), mockEnableFlow: vi.fn(), mockGetCh: vi.fn(), mockSetCh: vi.fn(), mockListPf: vi.fn(), mockSetPf: vi.fn(), mockExport: vi.fn() }));
vi.mock('../api/superAdminSmartRemindersApi', () => ({ superAdminSmartRemindersApi: { overview: (q: any) => mockOverview(q), listTemplates: () => mockListTpl(), createTemplate: (b: any) => mockCreateTpl(b), previewTemplate: (b: any) => mockPreviewTpl(b), publishTemplateVersion: (i: string, v: number) => mockPublishTpl(i, v), getTiming: (rt: string) => mockGetTiming(rt), setTiming: (b: any) => mockSetTiming(b), getEffective: (t: string, rt: string) => mockGetEff(t, rt), setOverride: (t: string, b: any) => mockSetOvr(t, b), revertOverride: (t: string, rt: string) => mockRevertOvr(t, rt), getFlow: (rt: string) => mockGetFlow(rt), disableFlow: (b: any) => mockDisableFlow(b), enableFlow: (b: any) => mockEnableFlow(b), getChannels: (rt: string) => mockGetCh(rt), setChannels: (b: any) => mockSetCh(b), listPlanFeatures: (p?: string) => mockListPf(p), setPlanFeature: (b: any) => mockSetPf(b), exportCsv: (b: any) => mockExport(b) } }));

import { SmartRemindersOverviewScreen } from './SmartRemindersOverviewScreen';

const kpi = (key: string, label: string, over: any = {}) => ({ key, label, value: 100, display: '100', available: true, deltaPct: 5, direction: 'up', semantic: 'good', ...over });
const overview = (over: any = {}) => ({
  ok: true, metadata: { generatedAt: new Date().toISOString(), windowDays: 30 }, scope: { tenantId: null, label: 'All tenants' },
  kpis: [
    kpi('active_flows', 'Active Reminder Flows'), kpi('scheduled_today', 'Scheduled Reminders Today', { available: false, display: '—' }), kpi('delivered', 'Delivered Reminders'),
    kpi('failed', 'Failed Reminders', { semantic: 'bad', direction: 'down' }), kpi('fallback', 'Fallback Executions', { available: false, display: '—' }), kpi('delivery_rate', 'Delivery Rate', { display: '97%', direction: 'flat', deltaPct: 0 }),
    kpi('sms', 'SMS Reminders'), kpi('email', 'Email Reminders'), kpi('push', 'Push Reminders'),
    kpi('customizations', 'Tenant Customizations Enabled'), kpi('problematic', 'Problematic Reminder Flows'), kpi('engagement', 'Avg Reminder Engagement', { available: false, display: '—' }),
  ],
  reminderTypes: ['appointment_confirmation', 'upcoming_appointment', 'missed_appointment_followup', 'customer_rebooking', 'technician_schedule', 'subscription_payment', 'merchant_document', 'onboarding', 'support_ticket_update', 'device_offline_alert'].map((k) => ({ key: k, label: k, countAvailable: false })),
  channelMix: { total: 16, segments: [{ key: 'sms', label: 'SMS', count: 9, pct: 56.3 }, { key: 'email', label: 'Email', count: 6, pct: 37.5 }, { key: 'push', label: 'Push', count: 1, pct: 6.3 }] },
  deliveryStatus: { total: 16, segments: [{ key: 'delivered', label: 'Delivered', count: 13, pct: 81 }, { key: 'failed', label: 'Failed', count: 2, pct: 12 }, { key: 'blocked', label: 'Blocked', count: 1, pct: 6 }], pendingAvailable: false, fallbackAvailable: false },
  deliveryTrend: [{ day: '2026-06-30', total: 16, delivered: 13, failed: 2, blocked: 1 }],
  scheduledVsDelivered: { days: [{ day: '2026-06-30', delivered: 13, failed: 2 }], scheduledAvailable: false },
  tenantUsage: [{ tenantId: 't1', tenant: 'Glamour Studio', total: 10, delivered: 9, failed: 1, sms: 7, email: 3, push: 0, deliveryRate: 90 }],
  deliveryFailures: [{ tenant: 'Luxe Salon', channel: 'Email', reason: 'Mailbox full', status: 'failed', time: new Date().toISOString() }],
  recentActivity: [{ tenant: 'Glamour Studio', channel: 'SMS', status: 'sent', time: new Date().toISOString() }],
  upcomingJobs: { available: false, jobs: [] },
  performanceByTenant: [{ tenant: 'Glamour Studio', delivered: 9, deliveryRate: 90, openRateAvailable: false, engagementAvailable: false }],
  settings: { enabledFlows: 2, customizations: 3, avgLeadMinutes: 90, tenantsUsing: 3 },
  atAGlance: { sentToday: 16, successfulToday: 13, failedToday: 2, fallbackToday: { available: false }, avgOpenRate: { available: false }, tenantsUsingReminders: 3 },
  ...over,
});

const renderScreen = () => render(<MemoryRouter><SmartRemindersOverviewScreen /></MemoryRouter>);

describe('SmartRemindersOverviewScreen', () => {
  beforeEach(() => { mockOverview.mockReset(); mockListTpl.mockReset(); mockCreateTpl.mockReset(); mockPreviewTpl.mockReset(); mockPublishTpl.mockReset(); mockGetTiming.mockReset(); mockSetTiming.mockReset(); mockGetEff.mockReset(); mockSetOvr.mockReset(); mockRevertOvr.mockReset(); mockGetFlow.mockReset(); mockDisableFlow.mockReset(); mockEnableFlow.mockReset(); mockGetCh.mockReset(); mockSetCh.mockReset(); mockListPf.mockReset(); mockSetPf.mockReset(); mockExport.mockReset(); mockListTpl.mockResolvedValue({ templates: [] }); mockGetTiming.mockResolvedValue({ reminderType: 'upcoming_appointment', timing: null }); mockGetFlow.mockResolvedValue({ reminderType: 'missed_appointment_followup', state: null }); mockGetCh.mockResolvedValue({ reminderType: 'upcoming_appointment', config: null }); mockListPf.mockResolvedValue({ planCode: null, features: [] }); mockGetEff.mockResolvedValue({ tenantId: 't1', reminderType: 'upcoming_appointment', platform: { direction: 'before', offsetMinutes: 1440, min: 60, max: 4320 }, override: null, effective: { enabled: true, direction: 'before', offsetMinutes: 1440, offsetSource: 'platform', channels: null, quietHoursPolicy: 'defer', allowedBand: { min: 60, max: 4320 } } }); (URL as any).createObjectURL = vi.fn(() => 'blob:mock'); (URL as any).revokeObjectURL = vi.fn(); });

  it('exports a CSV report from the header action', async () => {
    mockOverview.mockResolvedValue(overview());
    mockExport.mockResolvedValue({ ok: true, filename: 'smart-reminders-tenant-usage-2026-07-02.csv', mimeType: 'text/csv', dataset: 'tenant-usage', rowCount: 1, content: 'Tenant,Total\nGlamour,10' });
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: '⭳ Export Report' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '⭳ Export Report' }));
    await waitFor(() => expect(mockExport).toHaveBeenCalledWith({ dataset: 'tenant-usage' }));
    await waitFor(() => expect((URL as any).createObjectURL).toHaveBeenCalled());
  });

  it('sets a plan-level reminder feature (backend-enforced)', async () => {
    mockOverview.mockResolvedValue(overview());
    mockSetPf.mockResolvedValue({ ok: true, planCode: 'starter', featureKey: 'subscription_payment', state: 'disabled', allowed: false });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Enable Reminders by Subscription Plan')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Enable Reminders by Subscription Plan'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Enable Reminders by Subscription Plan' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Plan code'), { target: { value: 'starter' } });
    fireEvent.change(screen.getByLabelText('Plan feature'), { target: { value: 'subscription_payment' } });
    fireEvent.change(screen.getByLabelText('Plan feature state'), { target: { value: 'disabled' } });
    fireEvent.click(screen.getByText('Save plan feature'));
    await waitFor(() => expect(mockSetPf).toHaveBeenCalledWith({ planCode: 'starter', featureKey: 'subscription_payment', state: 'disabled' }));
    await waitFor(() => expect(screen.getByText(/subscription_payment on starter: disabled \(blocked\)/)).toBeInTheDocument());
  });

  it('sets channels with an ordered fallback sequence', async () => {
    mockOverview.mockResolvedValue(overview());
    mockSetCh.mockResolvedValue({ ok: true, reminderType: 'upcoming_appointment', before: null, after: { reminderType: 'upcoming_appointment', primaryChannel: 'push', fallbackChannels: ['sms'], sequence: ['push', 'sms'], fallbackOn: 'temporary_failure', maxFallbackAttempts: 1, stopOnSuccess: true, recheckSuppression: true, recheckQuietHours: true } });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Set SMS, Email, or Push Channels')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Set SMS, Email, or Push Channels'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Set Channels and Fallback' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Primary channel'), { target: { value: 'push' } });
    fireEvent.click(screen.getByLabelText('Fallback sms'));
    // live sequence preview reflects push → sms
    expect(screen.getByText('push → sms')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save channels'));
    await waitFor(() => expect(mockSetCh).toHaveBeenCalledWith(expect.objectContaining({ reminderType: 'upcoming_appointment', primaryChannel: 'push', fallbackChannels: ['sms'] })));
    await waitFor(() => expect(screen.getByText(/Delivery order: push → sms/)).toBeInTheDocument());
  });

  it('disables a problematic reminder flow with a required reason', async () => {
    mockOverview.mockResolvedValue(overview());
    mockDisableFlow.mockResolvedValue({ ok: true, reminderType: 'missed_appointment_followup', status: 'disabled' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Disable Problematic Reminders')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Disable Problematic Reminders'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Disable Problematic Reminders' })).toBeInTheDocument());
    // disabling without a reason is blocked client-side
    fireEvent.click(screen.getByText('Disable flow'));
    await waitFor(() => expect(screen.getByText(/reason is required to disable/)).toBeInTheDocument());
    expect(mockDisableFlow).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Disable reason'), { target: { value: 'Excessive delivery failures' } });
    fireEvent.click(screen.getByText('Disable flow'));
    await waitFor(() => expect(mockDisableFlow).toHaveBeenCalledWith(expect.objectContaining({ reminderType: 'missed_appointment_followup', reason: 'Excessive delivery failures', status: 'disabled' })));
    await waitFor(() => expect(screen.getByText(/New jobs are stopped; history is preserved/)).toBeInTheDocument());
  });

  it('sets a tenant customization bounded by the platform band', async () => {
    mockOverview.mockResolvedValue(overview());
    mockSetOvr.mockResolvedValue({ ok: true, tenantId: 't1', reminderType: 'upcoming_appointment', effective: { enabled: true, direction: 'before', offsetMinutes: 120, offsetSource: 'override', channels: ['sms'], quietHoursPolicy: 'defer', allowedBand: { min: 60, max: 4320 } } });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Allow Tenant Customization')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Allow Tenant Customization'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Allow Tenant Customization' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Customization tenant'), { target: { value: 't1' } });
    await waitFor(() => expect(mockGetEff).toHaveBeenCalledWith('t1', 'upcoming_appointment'));
    await waitFor(() => expect(screen.getByText(/allowed 60–4320m|Platform default/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Override offset'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Save customization'));
    await waitFor(() => expect(mockSetOvr).toHaveBeenCalledWith('t1', expect.objectContaining({ reminderType: 'upcoming_appointment', offsetMinutes: 120 })));
    await waitFor(() => expect(screen.getByText('Customization saved.')).toBeInTheDocument());
  });

  it('configures default timing for a reminder type', async () => {
    mockOverview.mockResolvedValue(overview());
    mockGetTiming.mockResolvedValue({ reminderType: 'upcoming_appointment', timing: { reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: 1440, minOffsetMinutes: 60, maxOffsetMinutes: 4320, signedOffset: -1440, quietHoursStart: 1320, quietHoursEnd: 480, quietHoursLabel: '22:00–08:00', quietHoursPolicy: 'defer', timezoneSource: 'tenant', enabled: true, updatedAt: '' } });
    mockSetTiming.mockResolvedValue({ ok: true, reminderType: 'upcoming_appointment', before: null, after: null });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Configure Default Timing')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Configure Default Timing'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Configure Default Timing' })).toBeInTheDocument());
    await waitFor(() => expect(mockGetTiming).toHaveBeenCalledWith('upcoming_appointment'));
    await waitFor(() => expect((screen.getByLabelText('Offset minutes') as HTMLInputElement).value).toBe('1440'));
    fireEvent.change(screen.getByLabelText('Offset minutes'), { target: { value: '120' } });
    fireEvent.click(screen.getByText('Save timing'));
    await waitFor(() => expect(mockSetTiming).toHaveBeenCalledWith(expect.objectContaining({ reminderType: 'upcoming_appointment', offsetMinutes: 120, direction: 'before' })));
    await waitFor(() => expect(screen.getByText('Timing saved.')).toBeInTheDocument());
  });

  it('creates a global reminder template with type + preview escaping', async () => {
    mockOverview.mockResolvedValue(overview());
    mockListTpl.mockResolvedValue({ templates: [{ id: 't1', tenant_id: null, reminder_type: 'appointment_confirmation', name: 'Confirm', status: 'draft', current_version: 1, versions: 1 }] });
    mockPreviewTpl.mockResolvedValue({ placeholders: ['name'], sms: 'Hi &lt;b&gt;', emailBody: null, pushBody: null });
    mockCreateTpl.mockResolvedValue({ ok: true, id: 't2', version: 1, status: 'draft', reminderType: 'onboarding', placeholders: ['name'] });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Create Global Reminder Templates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create Global Reminder Templates'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Reminder Templates' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Confirm')).toBeInTheDocument());
    expect(screen.getByText('Publish')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Welcome' } });
    fireEvent.change(screen.getByLabelText('Reminder type'), { target: { value: 'onboarding' } });
    fireEvent.change(screen.getByLabelText('SMS content'), { target: { value: 'Hi {{name}}' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText(/Hi &lt;b&gt;|Preview:/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create template'));
    await waitFor(() => expect(mockCreateTpl).toHaveBeenCalledWith(expect.objectContaining({ name: 'Welcome', reminderType: 'onboarding', sms: 'Hi {{name}}' })));
  });

  it('renders header, actions, and all 12 KPIs with honest "Not tracked"', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Create Reminder' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Smart Reminders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⭳ Export Report' })).toBeInTheDocument();
    for (const l of ['Active Reminder Flows', 'Delivered Reminders', 'Failed Reminders', 'Delivery Rate', 'SMS Reminders', 'Problematic Reminder Flows']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getAllByText('Not tracked').length).toBeGreaterThanOrEqual(3); // scheduled/fallback/engagement + at-a-glance
  });

  it('renders controls, 10 reminder types, charts, tables, quick actions, at-a-glance', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Smart Reminder Controls')).toBeInTheDocument());
    for (const c of ['Create Global Reminder Templates', 'Configure Fallback Behavior', 'Allow Tenant Customization']) expect(screen.getByText(c)).toBeInTheDocument();
    for (const h of ['Reminder Types', 'Reminder Delivery Trend (Last 7 Days)', 'Scheduled vs Delivered vs Failed', 'Reminder Mix by Channel', 'Delivery Status', 'Tenant Reminder Usage', 'Delivery Failures & Problematic Reminders', 'Recent Reminder Activity', 'Upcoming Reminder Jobs', 'Quick Actions', 'At-a-Glance Summary (Today)']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Glamour Studio').length).toBeGreaterThan(0);
    expect(screen.getByText('Mailbox full')).toBeInTheDocument();
    expect(screen.getByText(/scheduled counts not tracked/)).toBeInTheDocument();
    expect(screen.getByText(/Scheduled jobs are not tracked yet/)).toBeInTheDocument();
  });

  it('opens an informative modal for a control', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Monitor Delivery Rates')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Monitor Delivery Rates'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Monitor Delivery Rates' })).toBeInTheDocument());
    expect(screen.getByText(/permissioned, audited workflow/)).toBeInTheDocument();
  });

  it('shows a live indicator and preserves data on a background refresh failure', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValueOnce(overview());
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText(/auto-refresh 25s/)).toBeInTheDocument();
      mockOverview.mockRejectedValueOnce(new Error('blip'));
      await vi.advanceTimersByTimeAsync(25_000);
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      expect(screen.getByText('Delivered Reminders')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('shows an error state with retry', async () => {
    mockOverview.mockRejectedValue(new Error('down'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Couldn’t load Smart Reminders')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
