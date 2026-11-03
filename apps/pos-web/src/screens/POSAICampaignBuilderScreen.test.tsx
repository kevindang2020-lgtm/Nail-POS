// POSAICampaignBuilderScreen — Campaign Builder guide (Nov 3 2026): goal → audience → message → budget & cost → review & save. Next never
// sends or approves; saving makes an UNSENT, UNAPPROVED Campaign Center draft (the old AI submit + approve routes are gone).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { recommendations: vi.fn(), eligibility: vi.fn(), estimate: vi.fn(), saveDraft: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c, generateDraft: vi.fn() } }));
import { POSAICampaignBuilderScreen } from './POSAICampaignBuilderScreen';
const REC = { kind: 'winback', status: 'ready', matched: 5, eligible: 4, excludedTotal: 1, excluded: { no_phone: 1 }, message: { name: 'We miss you', body: 'We miss you at {salon_name}! Come back soon. Reply STOP to opt out.', subject: null } };
const est = (o: any = {}) => ({ channel: 'sms', asSent: 'Pilot: We miss you at Pilot!', characters: 60, encoding: 'GSM-7', segmentsPerMessage: 1, recipients: 4, estimatedSegments: 4, estimatedCostCents: 14, budgetCents: null, withinBudget: null, unresolved: [], costNote: 'estimate', ...o });
const wrap = (url = '/tenant/ai/marketing/builder') => render(<MemoryRouter initialEntries={[url]}><POSAICampaignBuilderScreen /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  c.recommendations.mockResolvedValue({ items: [REC] });
  c.eligibility.mockResolvedValue({ kind: 'winback', channels: [{ channel: 'sms', matched: 5, eligible: 4, excluded: { no_phone: 1 }, criteria: 'x' }], uniqueEligible: null });
  c.estimate.mockResolvedValue(est());
});

describe('POSAICampaignBuilderScreen', () => {
  it('Next is gated until a goal is chosen', () => {
    wrap();
    fireEvent.click(screen.getByTestId('amk-b-next'));
    expect(screen.getByTestId('amk-gate')).toHaveTextContent('Choose a goal first.');
  });
  it('walks the steps with the server\'s suggested text and saves an unsent draft into Campaign Center — once', async () => {
    c.saveDraft.mockResolvedValue({ duplicate: false, campaignId: 'cmp-9', eligible: 4, excluded: 1, sent: 0 });
    wrap('/tenant/ai/marketing/builder?kind=winback&channel=sms');
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → audience
    expect(await screen.findByTestId('amk-b-aud-status')).toHaveTextContent('5 match · 4 eligible · 1 excluded');
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → message (prefilled from the recommendation)
    expect(screen.getByTestId('amk-b-message')).toHaveValue(REC.message.body);
    expect(await screen.findByTestId('amk-est-cost')).toHaveTextContent('$0.14');
    expect(c.estimate).toHaveBeenLastCalledWith({ channel: 'sms', body: REC.message.body, recipients: 4, budgetCents: null });
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → budget
    fireEvent.change(screen.getByTestId('amk-b-budget'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → review
    fireEvent.click(screen.getByTestId('amk-b-save'));
    expect(await screen.findByTestId('amk-b-saved')).toHaveTextContent('Nothing has been sent or scheduled.');
    expect(c.saveDraft).toHaveBeenCalledTimes(1);
    const body = c.saveDraft.mock.calls[0][0];
    expect(body).toMatchObject({ kind: 'winback', channel: 'sms', message: REC.message.body, budgetCents: 500, name: 'We miss you' });
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(screen.getByTestId('amk-b-open').getAttribute('href')).toBe('/tenant/marketing/campaigns?q=cmp-9');
  });
  it('a placeholder Campaign Center cannot fill blocks the message step', async () => {
    c.estimate.mockResolvedValue(est({ unresolved: ['{{customer_first_name}}'] }));
    wrap('/tenant/ai/marketing/builder?kind=winback&channel=sms&message=Hi%20%7B%7Bcustomer_first_name%7D%7D');
    fireEvent.click(screen.getByTestId('amk-b-next'));
    await screen.findByTestId('amk-b-aud-status');
    fireEvent.click(screen.getByTestId('amk-b-next'));
    expect(await screen.findByTestId('amk-unresolved')).toHaveTextContent('{{customer_first_name}}');
    fireEvent.click(screen.getByTestId('amk-b-next'));
    expect(screen.getByTestId('amk-gate')).toHaveTextContent('Remove the placeholders');
  });
  it('nobody eligible: the audience step stops the wizard with the reason', async () => {
    c.recommendations.mockResolvedValue({ items: [{ ...REC, status: 'no_eligible', eligible: 0 }] });
    wrap('/tenant/ai/marketing/builder?kind=winback');
    fireEvent.click(screen.getByTestId('amk-b-next'));
    await screen.findByTestId('amk-b-aud-status');
    fireEvent.click(screen.getByTestId('amk-b-next'));
    expect(screen.getByTestId('amk-gate')).toHaveTextContent('Nobody is eligible');
  });
});
