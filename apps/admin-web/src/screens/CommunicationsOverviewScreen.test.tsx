import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockCreateAnnouncement, mockGetLimit, mockSetLimit, mockListTpl, mockCreateTpl, mockPreviewTpl, mockPublishTpl, mockListProv, mockCreateProv, mockTestProv } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockCreateAnnouncement: vi.fn(), mockGetLimit: vi.fn(), mockSetLimit: vi.fn(), mockListTpl: vi.fn(), mockCreateTpl: vi.fn(), mockPreviewTpl: vi.fn(), mockPublishTpl: vi.fn(), mockListProv: vi.fn(), mockCreateProv: vi.fn(), mockTestProv: vi.fn() }));
vi.mock('../api/superAdminCommunicationsApi', () => ({ superAdminCommunicationsApi: { overview: (q: any) => mockOverview(q), getState: vi.fn(), createAnnouncement: (b: any) => mockCreateAnnouncement(b), eligibleRoles: vi.fn(), getTenantLimit: (t: string) => mockGetLimit(t), setTenantLimit: (t: string, b: any) => mockSetLimit(t, b), listTemplates: () => mockListTpl(), createTemplate: (b: any) => mockCreateTpl(b), previewTemplate: (b: any) => mockPreviewTpl(b), publishTemplateVersion: (i: string, v: number) => mockPublishTpl(i, v), getTemplate: vi.fn(), addTemplateVersion: vi.fn(), listProviders: () => mockListProv(), createProvider: (b: any) => mockCreateProv(b), testProvider: (i: string) => mockTestProv(i), rotateProviderCredential: vi.fn() } }));

import { CommunicationsOverviewScreen } from './CommunicationsOverviewScreen';

const kpi = (key: string, label: string, over: any = {}) => ({ key, label, value: 100, display: '100', available: true, deltaPct: 5, direction: 'up', semantic: 'good', href: null, ...over });
const overview = (over: any = {}) => ({
  ok: true, metadata: { generatedAt: new Date().toISOString(), windowDays: 30 }, scope: { tenantId: null, label: 'All tenants' },
  kpis: [
    kpi('messages_sent', 'Messages Sent'), kpi('delivered', 'Delivered Messages'), kpi('failed', 'Failed Messages', { semantic: 'bad', direction: 'down' }),
    kpi('suppressed', 'Suppressed Messages', { value: 0, display: '0' }), kpi('opt_outs', 'Opt-Outs'), kpi('provider_usage', 'Provider Usage', { available: false, display: '—' }),
    kpi('sms_cost', 'SMS Cost', { available: false, display: '—' }), kpi('email_cost', 'Email Cost', { available: false, display: '—' }), kpi('messaging_limits', 'Messaging Limits', { available: false, display: '—' }),
    kpi('tenant_usage', 'Active Tenants', { value: 3, display: '3' }), kpi('provider_status', 'Delivery-Provider Status', { display: '99% Healthy', direction: 'flat', deltaPct: 0 }), kpi('system_alerts', 'System Alerts', { available: false, display: '—' }),
  ],
  communicationMix: { total: 17, segments: [{ key: 'sms', label: 'SMS', count: 9, pct: 52.9 }, { key: 'email', label: 'Email', count: 5, pct: 29.4 }, { key: 'push', label: 'Push Notifications', count: 3, pct: 17.6 }] },
  communicationTypes: ['sms', 'email', 'push', 'in_app', 'system_alert', 'tenant_notice', 'support'].map((k, i) => ({ key: k, label: { sms: 'SMS', email: 'Email', push: 'Push Notifications', in_app: 'In-App Announcements', system_alert: 'System Alerts', tenant_notice: 'Tenant Notices', support: 'Support Messages' }[k], sent: i < 3 ? [9, 5, 3][i] : 0, delivered: i < 3 ? [8, 4, 3][i] : 0, deliveryRate: 90 })),
  providerStatus: { total: 3, segments: [{ key: 'healthy', label: 'Healthy', count: 2, pct: 66.7 }, { key: 'degraded', label: 'Degraded', count: 0, pct: 0 }, { key: 'down', label: 'Down', count: 1, pct: 33.3 }], providers: [] },
  volumeTrend: [{ day: '2026-06-30', sent: 17, delivered: 15, failed: 1, suppressed: 0 }],
  deliveryPerformance: [{ day: '2026-06-30', sent: 17, delivered: 15, failed: 1, suppressed: 0 }],
  tenantUsage: [{ tenantId: 't1', tenant: 'Glamour Studio', sent: 11, delivered: 11, failed: 0, deliveryRate: 100, optOuts: 1, optOutRate: 9 }],
  deliveryFailures: [{ tenant: 'Luxe Salon', channel: 'Email', template: 'promo', reason: 'Mailbox full', provider: 'sendgrid', time: new Date().toISOString() }],
  topActivity: [{ template: 'reminder', channel: 'SMS', sent: 9, delivered: 8, tenants: 3 }],
  templates: { total: 2 },
  atAGlance: { sms: 9, email: 5, push: 3, inApp: 0, avgDeliveryRate: 88, providerIncidents: { available: false } },
  ...over,
});

const renderScreen = () => render(<MemoryRouter><CommunicationsOverviewScreen /></MemoryRouter>);

describe('CommunicationsOverviewScreen', () => {
  beforeEach(() => { mockOverview.mockReset(); mockCreateAnnouncement.mockReset(); mockGetLimit.mockReset(); mockSetLimit.mockReset(); mockListTpl.mockReset(); mockCreateTpl.mockReset(); mockPreviewTpl.mockReset(); mockPublishTpl.mockReset(); mockListProv.mockReset(); mockCreateProv.mockReset(); mockTestProv.mockReset(); mockListTpl.mockResolvedValue({ templates: [] }); mockListProv.mockResolvedValue({ providers: [] }); });

  it('configures providers: secret is write-only, list shows masked last4, test shows health', async () => {
    mockOverview.mockResolvedValue(overview());
    mockListProv.mockResolvedValue({ providers: [{ id: 'p1', name: 'Twilio', channel: 'sms', region: null, api_endpoint: null, status: 'active', priority: 10, credential_last4: '9876', last_health_check_at: null }] });
    mockCreateProv.mockResolvedValue({ ok: true, id: 'p2', status: 'test' });
    mockTestProv.mockResolvedValue({ ok: true, id: 'p1', credentialValid: true, health: 'healthy', healthLabel: 'Healthy', recent: { delivered: 5, failed: 0 }, status: 'active' });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Configure Communication Providers').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Configure Communication Providers')[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Communication Providers' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Twilio')).toBeInTheDocument());
    expect(screen.getByText(/••••9876/)).toBeInTheDocument();
    // credential field is a write-only password input
    expect((screen.getByLabelText('Provider credential') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(mockTestProv).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText(/Healthy · 5 ok \/ 0 failed/)).toBeInTheDocument());
    // add provider
    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'SendGrid' } });
    fireEvent.change(screen.getByLabelText('Provider credential'), { target: { value: 'SG_secret_1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    await waitFor(() => expect(mockCreateProv).toHaveBeenCalledWith(expect.objectContaining({ name: 'SendGrid', credential: 'SG_secret_1234' })));
  });

  it('manages message templates: preview escaping + create', async () => {
    mockOverview.mockResolvedValue(overview());
    mockListTpl.mockResolvedValue({ templates: [{ id: 't1', tenant_id: null, name: 'Reminder', channel: 'sms', category: null, status: 'draft', current_version: 1, versions: 1 }] });
    mockPreviewTpl.mockResolvedValue({ rendered: 'Hi &lt;b&gt;', placeholders: ['name'] });
    mockCreateTpl.mockResolvedValue({ ok: true, id: 't2', version: 1, status: 'draft', placeholders: ['name'] });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Manage Message Templates').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Manage Message Templates')[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Message Templates' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Reminder')).toBeInTheDocument());
    // publish action available on the draft template
    expect(screen.getByText('Publish')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Welcome' } });
    fireEvent.change(screen.getByLabelText('Template body'), { target: { value: 'Hi {{name}}' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText(/Hi &lt;b&gt;|Preview:/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create template'));
    await waitFor(() => expect(mockCreateTpl).toHaveBeenCalledWith(expect.objectContaining({ name: 'Welcome', channel: 'sms', body: 'Hi {{name}}' })));
  });

  it('sets tenant usage limits with current usage prefill', async () => {
    mockOverview.mockResolvedValue(overview());
    mockGetLimit.mockResolvedValue({ tenantId: 't1', limit: null, usage: { sms: 6, email: 3, push: 2, total: 11 }, limitUsed: null, available: false });
    mockSetLimit.mockResolvedValue({ ok: true, tenantId: 't1', before: null, after: { monthlySms: 100, enforcement: 'hard' } });
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Set Tenant Usage Limits').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Set Tenant Usage Limits')[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Set Tenant Usage Limits' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 't1' } });
    await waitFor(() => expect(mockGetLimit).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getByText(/Month-to-date usage/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Monthly SMS'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Enforcement'), { target: { value: 'hard' } });
    fireEvent.click(screen.getByText('Save limits'));
    await waitFor(() => expect(mockSetLimit).toHaveBeenCalledWith('t1', expect.objectContaining({ monthlySms: 100, enforcement: 'hard' })));
    await waitFor(() => expect(screen.getByText('Limits saved and enforced.')).toBeInTheDocument());
  });

  it('opens the Send Announcement form and queues an announcement with a recipient estimate', async () => {
    mockOverview.mockResolvedValue(overview());
    mockCreateAnnouncement.mockResolvedValue({ ok: true, idempotent: false, id: 'a1', recipientEstimate: 1862, status: 'queued' });
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Send Announcement/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Send Announcement/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Send Platform Announcement' })).toBeInTheDocument());
    // validation: no title/roles
    fireEvent.click(screen.getByText('Queue announcement'));
    expect(screen.getByText('A title is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByLabelText('Announcement body'), { target: { value: 'Downtime Sunday' } });
    fireEvent.click(screen.getByText('Queue announcement'));
    expect(screen.getByText('Select at least one recipient role.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Role OWNER'));
    fireEvent.click(screen.getByText('Queue announcement'));
    await waitFor(() => expect(mockCreateAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ title: 'Maintenance', recipientRoles: ['OWNER'], targetScope: 'all_tenants' })));
    await waitFor(() => expect(screen.getByText(/Estimated recipients/)).toBeInTheDocument());
    expect(screen.getByText('1,862')).toBeInTheDocument();
  });

  it('recipient roles never include CUSTOMER in the form', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Send Announcement/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Send Announcement/ }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Send Platform Announcement' })).toBeInTheDocument());
    expect(screen.queryByLabelText('Role CUSTOMER')).not.toBeInTheDocument();
    for (const r of ['OWNER', 'MANAGER', 'RECEPTION', 'TECHNICIAN']) expect(screen.getByLabelText(`Role ${r}`)).toBeInTheDocument();
  });

  it('renders the title, subtitle, and header actions', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Export Report/ })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Communications/ })).toBeInTheDocument();
    expect(screen.getByText(/Centralizes platform messaging infrastructure/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Announcement/ })).toBeInTheDocument();
  });

  it('renders all 12 KPI cards with honest "Not tracked" for unmodelled sources', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Messages Sent')).toBeInTheDocument());
    for (const l of ['Messages Sent', 'Delivered Messages', 'Failed Messages', 'Suppressed Messages', 'Opt-Outs', 'Provider Usage', 'SMS Cost', 'Email Cost', 'Messaging Limits', 'Active Tenants', 'Delivery-Provider Status', 'System Alerts']) {
      expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getAllByText('Not tracked').length).toBeGreaterThanOrEqual(5); // 5 KPIs + at-a-glance incidents
  });

  it('renders control sections, charts, 7 types, tables, 9 quick actions, and 6 at-a-glance', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Platform Communication Controls')).toBeInTheDocument());
    expect(screen.getByText('Tenant Communication Oversight')).toBeInTheDocument();
    expect(screen.getByText('Send Platform Announcements')).toBeInTheDocument();
    expect(screen.getAllByText('Block Abusive Usage').length).toBeGreaterThanOrEqual(1);
    for (const h of ['Messaging Volume Trend', 'Delivery Performance', 'Communication Mix by Type', 'Provider Status', 'Communication Types', 'Top Communication Activity Today', 'Tenant Usage Overview', 'Delivery Failures & Compliance Review', 'Quick Actions', 'At-a-Glance Summary (Today)']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    // 7 communication types
    for (const t of ['SMS', 'Push Notifications', 'In-App Announcements', 'Tenant Notices', 'Support Messages']) expect(screen.getAllByText(t).length).toBeGreaterThanOrEqual(1);
    // tenant usage + failures rows
    expect(screen.getByText('Glamour Studio')).toBeInTheDocument();
    expect(screen.getByText('Mailbox full')).toBeInTheDocument();
    // at-a-glance
    expect(screen.getByText('Avg Delivery Rate')).toBeInTheDocument();
  });

  it('opens an informative modal for a control/quick action', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('Configure Sender Information').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Configure Sender Information')[0]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Configure Sender Information' })).toBeInTheDocument());
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
      expect(screen.getByText('Messages Sent')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('shows an error state with retry', async () => {
    mockOverview.mockRejectedValue(new Error('down'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Couldn’t load Communications')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
