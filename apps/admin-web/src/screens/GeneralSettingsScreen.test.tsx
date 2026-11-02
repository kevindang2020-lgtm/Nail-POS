import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { generalSettings: vi.fn(), generalSettingsOverview: vi.fn(), generalSettingsSave: vi.fn(), generalSettingsHistory: vi.fn(), generalSettingsSeries: vi.fn(), generalSettingsLocaleDistribution: vi.fn(), generalSettingsAdoptionRate: vi.fn(), generalSettingsReset: vi.fn(), generalSettingsOperation: vi.fn(), systemHealth: vi.fn(), bizCategoriesSummary: vi.fn(), bizCategories: vi.fn(), bizCatCreate: vi.fn(), bizCatRename: vi.fn(), bizCatActivate: vi.fn(), bizCatDeactivate: vi.fn(), bizCatReorder: vi.fn(), tenantPresets: vi.fn(), tenantPresetDefaults: vi.fn(), tenantPresetCreate: vi.fn(), tenantPresetMakeDefault: vi.fn(), branding: vi.fn(), brandingUpdate: vi.fn(), brandingRestore: vi.fn(), legalDocuments: vi.fn(), legalDocOverviewVersion: vi.fn(), legalDocHistory: vi.fn(), legalDocAcceptance: vi.fn(), legalDocCreate: vi.fn(), legalDocPublish: vi.fn(), legalDocRetire: vi.fn(), maintenanceState: vi.fn(), maintenanceHistory: vi.fn(), maintenanceEnable: vi.fn(), maintenanceDisable: vi.fn(), maintenanceSchedule: vi.fn(), maintenanceCancel: vi.fn(), maintenanceBanner: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { GeneralSettingsScreen } from './GeneralSettingsScreen';

const S = (key: string, group: string, label: string, value: unknown, extra: Partial<any> = {}) => ({ key, group, label, valueType: extra.valueType || 'string', value, default: value, policy: extra.policy || 'overridable', mandatory: !!extra.mandatory, sensitive: false, version: extra.version ?? 0, isExplicitlySet: false, ...extra });

const GROUPS = [
  { group: 'platform_identity', settings: [S('platform.name', 'platform_identity', 'Platform Name', 'AI PowerSalon', { mandatory: true }), S('platform.theme', 'platform_identity', 'Active Brand Theme', 'Sunset Orange', { mandatory: true }), S('platform.legal_name', 'platform_identity', 'Legal Name', 'AI PowerSalon, Inc.', { mandatory: true })] },
  { group: 'support_contact', settings: [S('support.email', 'support_contact', 'Support Email', 'support@aipowersalon.com', { valueType: 'email', mandatory: true }), S('support.phone', 'support_contact', 'Support Phone', '+1 (855) 123-4567', { mandatory: true })] },
  { group: 'localization', settings: [S('localization.default_language', 'localization', 'Default Language', 'en-US', { valueType: 'locale' }), S('localization.default_currency', 'localization', 'Default Currency', 'USD', { valueType: 'currency' }), S('localization.default_timezone', 'localization', 'Default Time Zone', 'America/New_York', { valueType: 'timezone' }), S('localization.date_format', 'localization', 'Date Format', 'MMM dd, yyyy'), S('localization.time_format', 'localization', 'Time Format', '12h'), S('localization.number_format', 'localization', 'Number Format', '1,234.56')] },
  { group: 'global_defaults', settings: [S('defaults.tenant_trial_days', 'global_defaults', 'Default Tenant Trial Period', 14, { valueType: 'number' }), S('defaults.notifications_enabled', 'global_defaults', 'Notifications by Default', true, { valueType: 'boolean' })] },
  { group: 'platform_urls', settings: [S('urls.main_website', 'platform_urls', 'Main Website', 'https://www.aipowersalon.com', { valueType: 'url', mandatory: true })] },
  { group: 'maintenance', settings: [S('maintenance.mode', 'maintenance', 'Maintenance Mode', false, { valueType: 'boolean', mandatory: true }), S('maintenance.message', 'maintenance', 'Maintenance Message', '', { mandatory: true }), S('maintenance.announcement_banner', 'maintenance', 'Announcement Banner', '', { mandatory: true })] },
  { group: 'customer_display_ads', settings: [S('display_ads.max_ads_per_tenant', 'customer_display_ads', 'Maximum Ads per Salon', 50, { valueType: 'number', mandatory: true, policy: 'mandatory' }), S('display_ads.max_file_size_mb', 'customer_display_ads', 'Max Image File Size (MB)', 8, { valueType: 'number', mandatory: true, policy: 'mandatory' }), S('display_ads.allowed_mime_types', 'customer_display_ads', 'Allowed File Types', 'image/jpeg,image/png,image/webp', { mandatory: true, policy: 'mandatory' }), S('display_ads.fullscreen_idle_allowed', 'customer_display_ads', 'Full-Screen Idle Ads Allowed', true, { valueType: 'boolean', mandatory: true, policy: 'mandatory' })] },
];
const OVERVIEW = { cards: {
  activeTenants: { value: 248, trend: '+18 this month', available: true },
  platformLocale: { value: 'English (US)', label: 'Primary Language' }, brandTheme: { value: 'Sunset Orange', label: 'Current Theme' },
  maintenanceMode: { on: false, label: 'Platform is Live' }, legalDocsVersion: { value: null, available: false },
  defaultTimezone: { value: '(UTC-05:00)', label: 'Eastern Standard Time' }, supportChannels: { value: 4, label: 'Active Channels' },
  platformStatus: { value: 'Healthy', label: 'All Systems Operational' },
} };

describe('GeneralSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.generalSettings as any).mockResolvedValue({ groups: GROUPS, explicitlySetCount: 0 });
    (superAdminApi.generalSettingsOverview as any).mockResolvedValue(OVERVIEW);
    (superAdminApi.generalSettingsSave as any).mockResolvedValue({ applied: [{ key: 'support.email', version: 1 }], skipped: [], conflicts: [] });
    (superAdminApi.legalDocuments as any).mockResolvedValue([]);
    (superAdminApi.legalDocOverviewVersion as any).mockResolvedValue({ available: false, version: null, docCount: 0 });
    (superAdminApi.legalDocHistory as any).mockResolvedValue([]);
    (superAdminApi.legalDocCreate as any).mockResolvedValue({ id: 'ld_1' });
    (superAdminApi.legalDocPublish as any).mockResolvedValue({ id: 'ld_1', status: 'published' });
    (superAdminApi.maintenanceState as any).mockResolvedValue({ active: false, mode: 'full', message: '', expectedRestoration: null, allowedRoles: [], announcementBanner: '', enabledBy: null, enabledAt: null, nextScheduled: null });
    (superAdminApi.maintenanceHistory as any).mockResolvedValue([]);
    (superAdminApi.maintenanceEnable as any).mockResolvedValue({ active: true });
    (superAdminApi.generalSettingsHistory as any).mockResolvedValue([{ settingKey: 'defaults.booking_interval_min', actor: 'Super Admin', createdAt: '2026-05-06T00:00:00Z', previousValue: 30, newValue: 20 }]);
    (superAdminApi.generalSettingsSeries as any).mockResolvedValue([{ date: '2026-05-05', count: 1 }, { date: '2026-05-06', count: 2 }]);
    (superAdminApi.legalDocAcceptance as any).mockResolvedValue({ available: false, accepted: 0, declined: 0, pending: 0, total: 0 });
    (superAdminApi.generalSettingsLocaleDistribution as any).mockResolvedValue({ available: false, defaultLocale: 'en-US', items: [] });
    (superAdminApi.generalSettingsAdoptionRate as any).mockResolvedValue({ available: false, totalTenants: 0, onDefaults: 0, customized: 0, rate: 0 });
    (superAdminApi.generalSettingsReset as any).mockResolvedValue({ reset: 3 });
    (superAdminApi.generalSettingsOperation as any).mockResolvedValue({ ok: true, op: 'cache_clear', note: 'In-process caches cleared.' });
    (superAdminApi.systemHealth as any).mockResolvedValue({ ok: true, database: { ok: true, latencyMs: 4, counts: { tenants: 248, users: 900, activeSubscriptions: 200 } }, process: { uptimeSeconds: 1000, node: '22', env: 'test' } });
    (superAdminApi.bizCategoriesSummary as any).mockResolvedValue({ active: 3, total: 4 });
    (superAdminApi.bizCategories as any).mockResolvedValue([{ id: 'bc_1', name: 'Nail Salon', slug: 'nail-salon', description: null, sortOrder: 10, active: true, isDefault: false }]);
    (superAdminApi.bizCatCreate as any).mockResolvedValue({ id: 'bc_2' });
    (superAdminApi.tenantPresetDefaults as any).mockResolvedValue({ tenant: null, branch: null, onboarding: null });
    (superAdminApi.tenantPresets as any).mockResolvedValue([]);
    (superAdminApi.tenantPresetCreate as any).mockResolvedValue({ id: 'tp_1' });
    (superAdminApi.branding as any).mockResolvedValue({ platform_name: 'AI PowerSalon', tagline: 'Smarter Salon. Stronger Business.', primary_color: '#A96F22', secondary_color: '#84561A', accent_color: '#C9971B', surface_color: '#FBF6EC', text_color: '#2A2118', logo_full_url: '/brand/logo.png', logo_locked: true });
    (superAdminApi.brandingUpdate as any).mockResolvedValue({});
  });

  it('surfaces real brand colors and edits tagline via the branding drawer (logo locked)', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Update Branding'));
    const drawer = await screen.findByRole('dialog', { name: 'Platform Branding' });
    expect(within(drawer).getByText(/protected brand asset/i)).toBeInTheDocument(); // logo locked
    fireEvent.change(within(drawer).getByDisplayValue('Smarter Salon. Stronger Business.'), { target: { value: 'New tagline' } });
    fireEvent.click(within(drawer).getByText('Save branding'));
    await waitFor(() => expect(superAdminApi.brandingUpdate).toHaveBeenCalledWith(expect.objectContaining({ tagline: 'New tagline' })));
  });

  it('shows default-preset rows + Default Tenant Presets table, and creates a preset', async () => {
    (superAdminApi.tenantPresetDefaults as any).mockResolvedValue({ tenant: { id: 'tp_1', name: 'Standard Salon', count: 6 }, branch: null, onboarding: null });
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Standard Salon · 6 settings')).toBeInTheDocument(); // panel 4 default row
    const presetPanel = screen.getByText('Default Tenant Presets').closest('section') as HTMLElement;
    fireEvent.click(within(presetPanel).getByText('Manage'));
    const drawer = await screen.findByRole('dialog', { name: 'Tenant Presets' });
    fireEvent.change(within(drawer).getByPlaceholderText(/Name \(e\.g\. Standard/), { target: { value: 'Premium Spa' } });
    fireEvent.click(within(drawer).getByText('Create preset'));
    await waitFor(() => expect(superAdminApi.tenantPresetCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Premium Spa', scope: 'tenant' })));
  });

  it('shows the real category count in panel 4 and creates one from the drawer', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('3 Categories')).toBeInTheDocument();
    const h2 = screen.getByText('4. Business Categories & Defaults');
    const section = h2.closest('section') as HTMLElement;
    fireEvent.click(within(section).getByText('Edit'));
    const drawer = await screen.findByRole('dialog', { name: 'Business Categories' });
    fireEvent.change(within(drawer).getByPlaceholderText(/Name \(e\.g\./), { target: { value: 'Spa' } });
    fireEvent.click(within(drawer).getByText('Add category'));
    await waitFor(() => expect(superAdminApi.bizCatCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Spa' })));
  });

  it('renders the 6 action cards + 8 Quick Actions, and an action card opens a drawer', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Update Branding')).toBeInTheDocument();
    expect(screen.getByText('Manage Legal-Document Versions')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Clear Platform Cache')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Configure Global Formatting'));
    expect(await screen.findByRole('dialog', { name: 'Localization & Formatting' })).toBeInTheDocument();
  });

  it('requires typing RESET to reset to defaults', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Reset to Default Settings'));
    const dialog = await screen.findByRole('dialog', { name: 'Reset to defaults' });
    const confirmBtn = within(dialog).getByRole('button', { name: 'Reset to defaults' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(within(dialog).getByPlaceholderText('RESET'), { target: { value: 'RESET' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(superAdminApi.generalSettingsReset).toHaveBeenCalledWith('RESET'));
  });

  it('runs a system health check into a modal', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('System Health Check'));
    const dialog = await screen.findByRole('dialog', { name: 'System Health' });
    expect(within(dialog).getByText(/Healthy/)).toBeInTheDocument();
  });

  it('renders the analytics panels + lower tables (real data + honest NotConnected)', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Settings Changes (Last 7 Days)')).toBeInTheDocument();
    expect(screen.getByText('Document Acceptance Status')).toBeInTheDocument();
    expect(screen.getByText('Default Setting Adoption Rate')).toBeInTheDocument();
    expect(screen.getByText('Recent Configuration Changes')).toBeInTheDocument();
    expect(screen.getByText('Legal Document Version History')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Maintenance History')).toBeInTheDocument();
    // honest placeholders for the not-yet-built data
    expect(screen.getByText(/locale distribution isn’t available yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Adoption populates once tenants exist/i)).toBeInTheDocument();
    // real config-change row
    expect(await screen.findByText('30 → 20')).toBeInTheDocument();
  });

  it('enables maintenance from the drawer with a required reason + confirmation', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    const h2 = await screen.findByText(/6\. Maintenance/);
    const section = h2.closest('section') as HTMLElement;
    fireEvent.click(within(section).getByText('Edit'));
    const drawer = await screen.findByRole('dialog', { name: 'Maintenance & Messaging' });
    fireEvent.change(within(drawer).getAllByRole('textbox')[0], { target: { value: 'Security patch' } });
    fireEvent.click(within(drawer).getByText('Enable maintenance'));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm maintenance' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(superAdminApi.maintenanceEnable).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Security patch', mode: 'full' })));
  });

  it('renders header, star, subtitle and platform-wide banner', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Controls basic platform-wide configuration.')).toBeInTheDocument();
    expect(screen.getByText('★')).toBeInTheDocument();
    expect(screen.getByText(/apply platform-wide and serve as defaults/i)).toBeInTheDocument();
  });

  it('renders all eight summary cards with real values, honest — where unavailable', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    await screen.findByText('248');
    for (const label of ['Active Tenants', 'Platform Locale', 'Active Brand Theme', 'Maintenance Mode', 'Legal Docs Version', 'Default Time Zone', 'Support Channels', 'Platform Status']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByText('+18 this month')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('renders all eight settings panels with real values + honest placeholders', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    for (const t of ['1. Platform Identity', '2. Support Contact Information', '3. Localization & Formatting', '4. Business Categories & Defaults']) {
      expect(await screen.findByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText('support@aipowersalon.com')).toBeInTheDocument();
    expect(screen.getByText('14 days')).toBeInTheDocument();
    expect(screen.getByText(/No legal documents configured yet/i)).toBeInTheDocument(); // honest empty (legal)
  });

  it('edits a support field, stages it, and saves via the confirm summary', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Edit'))[1]); // Support Contact
    await screen.findByRole('dialog', { name: 'Support Contact Information' });
    fireEvent.change(screen.getByDisplayValue('support@aipowersalon.com'), { target: { value: 'help@aipowersalon.com' } });
    fireEvent.click(screen.getByText('Stage changes'));
    // pending banner appears
    expect(await screen.findByText(/1 unsaved change/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Review & Save'));
    const dialog = await screen.findByRole('dialog', { name: 'Review changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save 1 change$/i }));
    await waitFor(() => expect(superAdminApi.generalSettingsSave).toHaveBeenCalledWith([{ key: 'support.email', value: 'help@aipowersalon.com', expectedVersion: 0, reason: 'Updated via General Settings' }]));
  });

  it('shows live localization previews in the localization editor', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Edit'))[2]); // Localization
    await screen.findByRole('dialog', { name: 'Localization & Formatting' });
    expect(screen.getByText('Live Preview')).toBeInTheDocument();
    expect(screen.getByText('$1,234.56')).toBeInTheDocument(); // currency preview
  });

  it('blocks staging an invalid email (validation mirrors backend)', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Edit'))[1]);
    await screen.findByRole('dialog', { name: 'Support Contact Information' });
    fireEvent.change(screen.getByDisplayValue('support@aipowersalon.com'), { target: { value: 'nope' } });
    expect(screen.getByText('Must be a valid email')).toBeInTheDocument();
    expect(screen.getByText('Stage changes')).toBeDisabled();
  });

  it('renders the Localization Distribution donut when tenant-locale data is available', async () => {
    (superAdminApi.generalSettingsLocaleDistribution as any).mockResolvedValue({ available: true, defaultLocale: 'en-US', items: [{ locale: 'en-US', label: 'English (US)', count: 208 }, { locale: 'es-ES', label: 'Spanish (ES)', count: 40 }] });
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    const panel = (await screen.findByText('Localization Distribution')).closest('section') as HTMLElement;
    expect(within(panel).getAllByText('English (US)').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('208').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Adoption Rate donut when tenant data is available', async () => {
    (superAdminApi.generalSettingsAdoptionRate as any).mockResolvedValue({ available: true, totalTenants: 200, onDefaults: 140, customized: 60, rate: 70 });
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    const panel = (await screen.findByText('Default Setting Adoption Rate')).closest('section') as HTMLElement;
    expect(within(panel).getAllByText('70%').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('On Defaults').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a retry on load error', async () => {
    (superAdminApi.generalSettings as any).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Retry')).toBeInTheDocument();
  });

  it('lights up the Legal Docs card + panel table from real legal data', async () => {
    (superAdminApi.legalDocOverviewVersion as any).mockResolvedValue({ available: true, version: 'v2.3.0', docCount: 3 });
    (superAdminApi.legalDocuments as any).mockResolvedValue([
      { docType: 'terms_of_service', label: 'Terms of Service', version: 'v2.3.0', lastUpdated: '2026-04-28T00:00:00Z', status: 'published', versionId: 'ld_1', requiredAcceptance: true },
    ]);
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    expect((await screen.findAllByText('v2.3.0')).length).toBeGreaterThanOrEqual(1); // card value + table cell
    expect(screen.getByText('3 Documents')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument(); // panel table row
  });

  it('opens Manage All and creates a legal draft', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Manage All'));
    const drawer = await screen.findByRole('dialog', { name: 'Legal Documents' });
    fireEvent.change(within(drawer).getByPlaceholderText('v2.3.0'), { target: { value: 'v1.0.0' } });
    fireEvent.click(within(drawer).getByText('Create draft'));
    await waitFor(() => expect(superAdminApi.legalDocCreate).toHaveBeenCalledWith(expect.objectContaining({ docType: 'terms_of_service', version: 'v1.0.0', requiredAcceptance: true })));
  });

  it('§110 shows the customer-display advertising controls and edits them through the standard drawer', async () => {
    render(<MemoryRouter><GeneralSettingsScreen /></MemoryRouter>);
    const panel = (await screen.findByRole('heading', { name: /Customer Display Advertising/ })).closest('section') as HTMLElement;
    expect(within(panel).getByText('50 ads')).toBeInTheDocument();
    expect(within(panel).getByText('8 MB')).toBeInTheDocument();
    expect(within(panel).getByText('JPEG, PNG, WEBP')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Feature Registry' })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: /Edit/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Customer Display Advertising' });
    expect(within(drawer).getByText('Maximum Ads per Salon')).toBeInTheDocument();
  });
});
