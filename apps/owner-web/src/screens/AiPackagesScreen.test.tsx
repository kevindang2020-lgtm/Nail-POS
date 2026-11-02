import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerAiApi: { packages: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
import { ownerAiApi } from '../api/ownerApi';
import { AiPackagesScreen } from './AiPackagesScreen';

const pkg = (over: any = {}) => ({
  code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: 'Books appts', category: 'front_desk', posArea: 'Booking',
  monthlyPriceCents: 4900, includedUsageLimit: 1000, usageUnit: 'messages', trialDays: 14,
  subscription: null, used: 0, remainingUsage: 0, accessible: false, lockReason: 'not_subscribed', lockLabel: 'Subscribe to unlock this AI assistant', upgradeRequired: true, trialAvailable: true, ...over,
});

describe('owner AiPackagesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ownerAiApi.startTrial as any).mockResolvedValue({ ok: true, status: 'trialing', trialEndsAt: null });
  });

  it('lists packages with lock state + start-trial CTA', async () => {
    (ownerAiApi.packages as any).mockResolvedValue({ packages: [pkg(), pkg({ code: 'ai_business_assistant', name: 'AI Business Assistant', subscription: { status: 'active', usageLimit: 1000, overageEnabled: false, trialEndsAt: null }, used: 250, remainingUsage: 750, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false })] });
    render(<AiPackagesScreen />);
    expect(await screen.findByText('AI Booking Assistant')).toBeInTheDocument();
    expect(screen.getByText('Subscribe to unlock this AI assistant')).toBeInTheDocument();
    expect(screen.getByText('Start Free Trial')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('250 / 1,000 messages')).toBeInTheDocument();
  });

  it('starts a trial', async () => {
    (ownerAiApi.packages as any).mockResolvedValue({ packages: [pkg()] });
    render(<AiPackagesScreen />);
    fireEvent.click(await screen.findByText('Start Free Trial'));
    await waitFor(() => expect(ownerAiApi.startTrial).toHaveBeenCalledWith('ai_booking_assistant'));
  });
});
