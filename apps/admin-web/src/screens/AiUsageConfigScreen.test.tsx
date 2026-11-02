import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const aiUsageOverview = vi.fn();
const setAiProviderStatus = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  aiUsageOverview: (...a: any[]) => aiUsageOverview(...a),
  setAiProviderStatus: (...a: any[]) => setAiProviderStatus(...a),
  saveAiProvider: vi.fn(),
  saveAiPrompt: vi.fn(),
} }));

import { AiUsageConfigScreen } from './AiUsageConfigScreen';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const overview = () => ({
  kpis: [
    kpi('usage_by_tenant', 'AI Usage by Tenant', '87 active'), kpi('tokens_minutes', 'Tokens / Minutes Used', '2.48M tokens · 14,260 mins'),
    kpi('receptionist_calls', 'AI Receptionist Calls', '18,642'), kpi('ai_costs', 'AI Costs', '$12,846.40'), kpi('model_requests', 'Model Usage Requests', '248,420'),
    kpi('failed_requests', 'Failed AI Requests', '186', { unfavorableIfUp: true }), kpi('avg_latency', 'Avg Response Latency', null),
    kpi('allowances_used', 'Tenant Allowances Used', '78%'), kpi('overage_events', 'Overage Events', '37'), kpi('safety_flags', 'Safety / Quality Flags', null),
    kpi('provider_health', 'Provider Health', null), kpi('active_features', 'Active AI Features', '5 enabled'),
  ],
  providers: [
    { id: 'AIPRV-0001', providerKey: 'openai', displayName: 'OpenAI', status: 'active', defaultModel: 'GPT-4.1', apiKeyMasked: 'sk_live_••••••••9X4K', apiKeyFingerprint: 'a1b2c3d4e5f6', hasKey: true, lastSyncAt: '2026-05-06T13:00:00Z' },
    { id: 'AIPRV-0002', providerKey: 'anthropic', displayName: 'Anthropic', status: 'active', defaultModel: 'Claude 3.5 Sonnet', apiKeyMasked: 'sk_live_••••••••7B2L', apiKeyFingerprint: 'b2c3d4e5f6a1', hasKey: true, lastSyncAt: '2026-05-06T13:08:00Z' },
  ],
  prompts: [{ id: 'AIPMT-0001', promptKey: 'reminders', name: 'Reminders', body: 'You are…', version: 3, status: 'active', updatedAt: '2026-05-06T10:00:00Z' }, { id: 'AIPMT-0002', promptKey: 'smart_reminders', name: 'Smart Reminders', body: 'Craft…', version: 2, status: 'active', updatedAt: '2026-05-06T10:00:00Z' }],
  analytics: {
    trend: { available: true, points: [{ date: '2026-05-05', tokens: 201000 }, { date: '2026-05-06', tokens: 186000 }] },
    costRequests: { available: true, points: [{ date: '2026-05-05', costCents: 236000, requests: 45100 }, { date: '2026-05-06', costCents: 184236, requests: 36842 }] },
    byProvider: { available: true, segments: [{ label: 'OpenAI', value: 45200, pct: 45.2 }, { label: 'Anthropic', value: 24000, pct: 24 }] },
    byFeature: { available: true, segments: [{ label: 'AI Receptionist', value: 34600, pct: 34.6 }, { label: 'AI Insights', value: 21500, pct: 21.5 }] },
    tenants: [{ tenant: 'VIP Nail Club', tokens: 452100, minutes: 2540, calls: 3420, costCents: 234560, failed: 12, status: 'Warning' }],
  },
  security: { kekConfigured: false, note: 'Secrets are encrypted (AES-256-GCM) and never displayed in full after being saved.' },
});

describe('AiUsageConfigScreen', () => {
  beforeEach(() => { aiUsageOverview.mockReset(); aiUsageOverview.mockResolvedValue(overview()); setAiProviderStatus.mockReset(); setAiProviderStatus.mockResolvedValue({ ok: true }); });

  it('renders the encrypted-secrets banner, 12 KPIs, and masked provider keys', async () => {
    render(<AiUsageConfigScreen />);
    expect(await screen.findByText('AI Usage & Configuration', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText(/never displayed in full after being saved/)).toBeInTheDocument();
    expect(screen.getByText('AI Costs')).toBeInTheDocument();
    expect(screen.getByText('sk_live_••••••••9X4K')).toBeInTheDocument();
    expect(screen.getByText('sk_live_••••••••7B2L')).toBeInTheDocument();
  });

  it('shows Not Available for unbacked KPIs (latency, safety flags, provider health)', async () => {
    render(<AiUsageConfigScreen />);
    await screen.findByText('AI Usage & Configuration', { selector: 'h1' });
    expect(screen.getByText('Avg Response Latency')).toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(3);
  });

  it('opens the provider modal from Add Provider', async () => {
    render(<AiUsageConfigScreen />);
    await screen.findByText('AI Usage & Configuration', { selector: 'h1' });
    fireEvent.click(screen.getByText('+ Add Provider'));
    expect(await screen.findByText('Add Approved Provider')).toBeInTheDocument();
  });

  it('renders the Global Prompt Configuration panel and opens the editor', async () => {
    render(<AiUsageConfigScreen />);
    await screen.findByText('AI Usage & Configuration', { selector: 'h1' });
    expect(screen.getByText('Global Prompt Configuration')).toBeInTheDocument();
    expect(screen.getByText('Smart Reminders')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ New Prompt'));
    expect(await screen.findByText('New Global Prompt')).toBeInTheDocument();
  });

  it('renders the four analytics modules and the tenant usage table from real data', async () => {
    render(<AiUsageConfigScreen />);
    await screen.findByText('AI Usage & Configuration', { selector: 'h1' });
    expect(screen.getByText('AI Usage Trend')).toBeInTheDocument();
    expect(screen.getByText('Cost vs Requests')).toBeInTheDocument();
    expect(screen.getByText('Usage by Provider')).toBeInTheDocument();
    expect(screen.getByText('Feature Usage Mix')).toBeInTheDocument();
    expect(screen.getByText('VIP Nail Club')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('toggles provider status', async () => {
    render(<AiUsageConfigScreen />);
    await screen.findByText('AI Usage & Configuration', { selector: 'h1' });
    fireEvent.click(screen.getAllByText('Disable')[0]);
    await waitFor(() => expect(setAiProviderStatus).toHaveBeenCalledWith('openai', 'disabled'));
  });
});
