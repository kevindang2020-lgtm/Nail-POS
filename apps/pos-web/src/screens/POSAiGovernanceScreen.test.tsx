// POSAiGovernanceScreen.test — Constitution 10 §166/§168/§110 in the UI.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSAiGovernanceScreen, formatMicroUsd, formatRate, isAtCeiling, AUTOMATION_LABELS } from './POSAiGovernanceScreen';
import { AUTOMATION_LEVELS } from '../api/posAiGovernanceApi';

vi.mock('../api/posAiGovernanceApi', async (orig) => ({
  ...(await orig<typeof import('../api/posAiGovernanceApi')>()),   // keep the real AUTOMATION_LEVELS constant
  posAiGovernanceApi: { dashboard: vi.fn(), feedbackSummary: vi.fn() },
}));
import { posAiGovernanceApi } from '../api/posAiGovernanceApi';

const base = {
  enabledModules: [], usage: { requests: 12, failures: 1, costMicroUsd: 2_500_000 },
  budget: { limitMicroUsd: 10_000_000, spentMicroUsd: 2_500_000, usedPercent: 25 },
  pendingApprovals: [], automationByTask: [{ taskKey: 'followups.draft', effective: 'SUGGEST_ONLY', platformMax: 'APPROVAL_REQUIRED' }],
  canManageSettings: true, hidden: [] as string[],
};

const noFeedback = () => (posAiGovernanceApi.feedbackSummary as any).mockResolvedValue({ total: 0, acceptanceRate: 0, correctionRate: 0, rejectionRate: 0, topReason: null });

describe('money and levels are shown in words a salon owner reads', () => {
  it('micro-USD becomes dollars', () => {
    expect(formatMicroUsd(2_500_000)).toBe('$2.50');
    expect(formatMicroUsd(0)).toBe('$0.00');
  });
  it('a non-finite cost does not render as NaN', () => {
    expect(formatMicroUsd(Number.NaN)).toBe('—');
  });
  it('SUGGEST_ONLY / APPROVAL_REQUIRED are translated, not shown raw', () => {
    expect(AUTOMATION_LABELS.SUGGEST_ONLY).toBe('Suggests only');
    expect(AUTOMATION_LABELS.APPROVAL_REQUIRED).toBe('Acts after approval');
    expect(AUTOMATION_LABELS.OFF).toBe('Off');
  });

  // The vocabulary is the SERVER's, not one this screen invented. An earlier draft of this file used a
  // made-up four-value lowercase set; the tests passed because their fixtures used the same wrong words,
  // while every real task would have rendered its raw level string. Pin it against the source of truth.
  it('every level the safety engine can return has a label', async () => {
    const policy = await import('@aipowersalon/api-contracts/tenant');   // the contract owns the level list now (Constitution 13); this path broke at a988daa
    for (const level of policy.AUTOMATION_LEVELS) {
      expect(AUTOMATION_LABELS[level as keyof typeof AUTOMATION_LABELS], `no label for ${level}`).toBeTruthy();
    }
  });

  it('the client vocabulary matches the server list exactly — no extras, no omissions', async () => {
    const policy = await import('@aipowersalon/api-contracts/tenant');   // the contract owns the level list now (Constitution 13); this path broke at a988daa
    expect([...AUTOMATION_LEVELS]).toEqual([...policy.AUTOMATION_LEVELS]);
  });

  it('§110: at-ceiling is detected so the UI can say a level is not raisable', () => {
    expect(isAtCeiling('APPROVAL_REQUIRED', 'APPROVAL_REQUIRED')).toBe(true);
    expect(isAtCeiling('SUGGEST_ONLY', 'APPROVAL_REQUIRED')).toBe(false);
  });
});

describe('§166: a forbidden section is EXPLAINED, never rendered as empty', () => {
  beforeEach(() => { vi.clearAllMocks(); noFeedback(); });

  it('hidden usage says why — an empty cost panel and a forbidden one must not look alike', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue({ ...base, usage: null, hidden: ['usage'] });
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText(/need.*AI usage permission/i)).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();   // not a fake zero
  });

  it('a budget that is genuinely unset says THAT instead — a different sentence from forbidden', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue({ ...base, budget: null, hidden: [] });
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText(/No AI budget has been set/i)).toBeInTheDocument();
  });

  it('visible usage renders the real figures', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('$2.50')).toBeInTheDocument();
  });

  it('a task shows its level AND the platform ceiling beside it', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText('followups.draft')).toBeInTheDocument();
    expect(screen.getByText('Suggests only')).toBeInTheDocument();
    expect(screen.getByText(/Acts after approval/)).toBeInTheDocument();
  });

  it('a task already at the ceiling says so', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue({ ...base, automationByTask: [{ taskKey: 't', effective: 'APPROVAL_REQUIRED', platformMax: 'APPROVAL_REQUIRED' }] });
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText(/at the limit/)).toBeInTheDocument();
  });

  it('a load failure says so rather than rendering an empty dashboard', async () => {
    (posAiGovernanceApi.dashboard as any).mockRejectedValue(new Error('nope'));
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });
});

describe('it does not duplicate the AI Command Center', () => {
  beforeEach(() => { vi.clearAllMocks(); noFeedback(); });
  it('links to it for business results instead of repeating them', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    render(<POSAiGovernanceScreen />);
    const link = await screen.findByText('AI Command Center');
    expect(link.getAttribute('href')).toBe('/tenant/ai/command-center');
  });
});

describe('§129 feedback panel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a rate renders as a percentage', () => {
    expect(formatRate(0.75, 4)).toBe('75%');
  });

  it('ZERO rated suggestions is not "0%" — 0/0 is not a fact about quality', () => {
    expect(formatRate(0, 0)).toBe('—');
  });

  it('shows the salon\'s own accept/edit/reject split', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    (posAiGovernanceApi.feedbackSummary as any).mockResolvedValue({ total: 4, acceptanceRate: 0.5, correctionRate: 0.25, rejectionRate: 0.25, topReason: 'wrong tone' });
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/Based on 4 rated suggestions/)).toBeInTheDocument();
    expect(screen.getByText(/wrong tone/)).toBeInTheDocument();
  });

  it('with nothing rated yet the panel is absent, not an empty box of dashes', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    noFeedback();
    render(<POSAiGovernanceScreen />);
    await screen.findByText('followups.draft');
    expect(screen.queryByText(/How your team rates/)).not.toBeInTheDocument();
  });

  it('a 403 on the summary hides the panel and NOT the whole screen', async () => {
    (posAiGovernanceApi.dashboard as any).mockResolvedValue(base);
    (posAiGovernanceApi.feedbackSummary as any).mockRejectedValue(new Error('forbidden'));
    render(<POSAiGovernanceScreen />);
    expect(await screen.findByText('followups.draft')).toBeInTheDocument();   // screen still renders
    expect(screen.queryByText(/How your team rates/)).not.toBeInTheDocument();
  });
});
