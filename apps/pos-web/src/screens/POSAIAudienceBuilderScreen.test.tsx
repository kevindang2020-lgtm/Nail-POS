// POSAIAudienceBuilderScreen — Audience Builder guide (Nov 3 2026): a goal (the Customer Retention rule) and a channel → the eligibility
// funnel (matched, each exclusion reason, eligible; unique people for both channels). Counts only; nothing is saved or sent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { eligibility: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c } }));
import { POSAIAudienceBuilderScreen } from './POSAIAudienceBuilderScreen';
const wrap = () => render(<MemoryRouter><POSAIAudienceBuilderScreen /></MemoryRouter>);
beforeEach(() => vi.clearAllMocks());

describe('POSAIAudienceBuilderScreen', () => {
  it('a goal and a channel show the funnel with each reason, and continue to the Campaign Builder', async () => {
    c.eligibility.mockResolvedValue({ kind: 'winback', channels: [{ channel: 'sms', matched: 12, eligible: 7, excluded: { opted_out: 2, no_phone: 1, never_visited: 2 }, criteria: 'At least one completed visit and none in the last 60+ salon days.' }], uniqueEligible: null });
    wrap();
    expect(screen.getByText('Choose a goal to see who is eligible.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('amk-aud-winback'));
    expect(await screen.findByTestId('amk-eligible-sms')).toHaveTextContent('7');
    expect(screen.getByTestId('amk-ex-opted_out')).toHaveTextContent('2');
    expect(screen.getByTestId('amk-ex-never_visited')).toHaveTextContent('Never visited');
    expect(c.eligibility).toHaveBeenLastCalledWith('winback', 'sms');
    expect(screen.getByTestId('amk-aud-build').getAttribute('href')).toBe('/tenant/ai/marketing/builder?kind=winback&channel=sms');
  });
  it('both channels: unique people; birthday goes to Birthday Campaigns', async () => {
    c.eligibility.mockResolvedValue({ kind: 'birthday', channels: [{ channel: 'sms', matched: 3, eligible: 2, excluded: { no_consent: 1 }, criteria: 'x' }, { channel: 'email', matched: 3, eligible: 1, excluded: { no_email: 2 }, criteria: 'x' }], uniqueEligible: 2 });
    wrap();
    fireEvent.click(screen.getByTestId('amk-aud-birthday'));
    fireEvent.click(screen.getByTestId('amk-aud-ch-both'));
    expect(await screen.findByTestId('amk-unique')).toHaveTextContent('2 unique people');
    expect(c.eligibility).toHaveBeenLastCalledWith('birthday', 'both');
    expect(screen.getByText('Open Birthday Campaigns').closest('a')).toHaveAttribute('href', '/tenant/marketing/birthdays');
  });
});
