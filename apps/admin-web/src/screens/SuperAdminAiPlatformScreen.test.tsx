// SuperAdminAiPlatformScreen.test — Constitution 10 §171–176, and the null-is-not-zero rule.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuperAdminAiPlatformScreen, usd, measured, isDegraded } from './SuperAdminAiPlatformScreen';

vi.mock('../api/superAdminAiPlatformApi', () => ({
  superAdminAiPlatformApi: { overview: vi.fn(), providers: vi.fn(), models: vi.fn(), tenants: vi.fn(), routing: vi.fn() },
}));
import { superAdminAiPlatformApi } from '../api/superAdminAiPlatformApi';

const idle = {
  requestsToday: 0, successRate: null, averageLatencyMs: null, costTodayMicroUsd: 0, costMonthMicroUsd: 0,
  activeTenants: 0, jobsRunning: 0, failures: 0, providerHealth: {}, safetyEvents: 0,
};
const busy = { ...idle, requestsToday: 40, successRate: 0.95, averageLatencyMs: 812, costTodayMicroUsd: 1_500_000 };

const setup = (o: any = busy, p: any[] = [], m: any[] = [], t: any[] = [], r: any[] = []) => {
  (superAdminAiPlatformApi.routing as any).mockResolvedValue(r);
  (superAdminAiPlatformApi.overview as any).mockResolvedValue(o);
  (superAdminAiPlatformApi.providers as any).mockResolvedValue(p);
  (superAdminAiPlatformApi.models as any).mockResolvedValue(m);
  (superAdminAiPlatformApi.tenants as any).mockResolvedValue(t);
};

describe('null means NOT MEASURED, never zero and never 100%', () => {
  it('an unmeasured rate renders as a dash', () => {
    expect(measured(null)).toBe('—');
    expect(measured(undefined as never)).toBe('—');
  });
  it('a measured rate renders as a percentage', () => {
    expect(measured(0.95)).toBe('95%');
  });
  it('a genuine zero rate is 0%, NOT a dash — measured-and-bad differs from unmeasured', () => {
    expect(measured(0)).toBe('0%');
  });
  it('latency renders in ms', () => {
    expect(measured(812, 'ms')).toBe('812 ms');
    expect(measured(null, 'ms')).toBe('—');
  });
  it('THE RULE, on screen: an idle platform shows a dash, not 100% success', async () => {
    setup(idle);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('Success rate')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('money', () => {
  it('micro-USD becomes dollars', () => expect(usd(1_500_000)).toBe('$1.50'));
  it('a missing cost is a dash, not $0.00', () => expect(usd(null)).toBe('—'));
  it('a real zero cost is $0.00', () => expect(usd(0)).toBe('$0.00'));
});

describe('provider health', () => {
  it('anything other than HEALTHY is degraded, whatever the casing', () => {
    expect(isDegraded('OPEN')).toBe(true);
    expect(isDegraded('DEGRADED')).toBe(true);
    expect(isDegraded('HEALTHY')).toBe(false);
    expect(isDegraded('healthy')).toBe(false);
    expect(isDegraded(undefined)).toBe(false);
  });

  it('renders a provider row with its measured values', async () => {
    setup(busy, [{ provider: 'openai', status: 'HEALTHY', latencyMsP50: 300, errorRate: 0.02, requests: 40, costMicroUsd: 1_500_000, lastIncidentAt: null, routableModels: [] }]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('openai')).toBeInTheDocument();
    expect(screen.getByText('300 ms')).toBeInTheDocument();
    expect(screen.getByText('2%')).toBeInTheDocument();
  });

  it('§173: no credential appears — the payload carries none and the screen invents none', async () => {
    setup(busy, [{ provider: 'openai', status: 'HEALTHY', latencyMsP50: 300, errorRate: 0, requests: 1, costMicroUsd: 0, lastIncidentAt: null, routableModels: [] }]);
    const { container } = render(<SuperAdminAiPlatformScreen />);
    await screen.findByText('openai');
    expect(container.textContent).not.toMatch(/sk-|api[_ ]?key|secret|bearer/i);
  });
});

describe('models and tenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an unscored model shows a dash rather than an invented number', async () => {
    setup(busy, [], [{ model: 'gpt-4o-mini', provider: 'openai', status: 'ACTIVE', tier: 'cheap', allowedTasks: [], requests: 5, costMicroUsd: 100, inPerM: 1, outPerM: 2, qualityScore: null }]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('with no usage the tenant table says so instead of rendering an empty grid', async () => {
    setup(idle);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText(/No AI usage has been recorded/)).toBeInTheDocument();
  });

  it('tenant spend renders', async () => {
    setup(busy, [], [], [{ tenantId: 'tn-1', requests: 30, costMicroUsd: 900_000, failures: 2 }]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('tn-1')).toBeInTheDocument();
    expect(screen.getByText('$0.90')).toBeInTheDocument();
  });

  it('a load failure explains instead of rendering an empty control plane', async () => {
    (superAdminAiPlatformApi.overview as any).mockRejectedValue(new Error('forbidden'));
    (superAdminAiPlatformApi.providers as any).mockResolvedValue([]);
    (superAdminAiPlatformApi.models as any).mockResolvedValue([]);
    (superAdminAiPlatformApi.tenants as any).mockResolvedValue([]);
    (superAdminAiPlatformApi.routing as any).mockResolvedValue([]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
  });
});

describe('§175 routing — why a task uses the model it uses', () => {
  beforeEach(() => vi.clearAllMocks());

  const route = (over: Record<string, unknown> = {}) => ({
    taskKey: 'followups.draft', module: 'followups', riskLevel: 'LOW', capability: 'text',
    preferredTier: 'CHEAP', allowedProviders: ['openai', 'anthropic'], defaultModel: 'gpt-4o-mini',
    maxOutputTokens: 500, timeoutMs: 10_000, maxAutomation: 'SUGGEST_ONLY', approval: 'none',
    routingPolicyVersion: 'v1', ...over,
  });

  it('shows each task with its default model, providers and ceiling', async () => {
    setup(busy, [], [], [], [route()]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('followups.draft')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('openai, anthropic')).toBeInTheDocument();
    expect(screen.getByText('SUGGEST_ONLY')).toBeInTheDocument();
  });

  it('NO default model says the router picks by tier — a blank cell would read as broken config', async () => {
    setup(busy, [], [], [], [route({ defaultModel: null, preferredTier: 'BALANCED' })]);
    render(<SuperAdminAiPlatformScreen />);
    expect(await screen.findByText('by tier (BALANCED)')).toBeInTheDocument();
  });
});
