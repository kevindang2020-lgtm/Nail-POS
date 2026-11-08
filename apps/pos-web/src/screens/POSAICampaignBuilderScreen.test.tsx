// POSAICampaignBuilderScreen — Campaign Builder guide (Nov 3 2026): goal → audience → message → budget & cost → review & save. Next never
// sends or approves; saving makes an UNSENT, UNAPPROVED Campaign Center draft (the old AI submit + approve routes are gone).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { recommendations: vi.fn(), eligibility: vi.fn(), estimate: vi.fn(), saveDraft: vi.fn(), check: vi.fn(), offers: vi.fn(), scheduleCheck: vi.fn() } }));
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
  c.offers.mockResolvedValue({ items: [OFFER] });
  c.scheduleCheck.mockResolvedValue({ ok: true, timeZone: 'America/New_York', date: '2026-12-01', time: '10:00', sendAt: '2026-12-01T15:00:00.000Z', checks: [{ key: 'quiet_hours', state: 'ok', detail: 'Outside the quiet hours.' }] });
});
const OFFER = { id: 'd-1', title: 'Winter 15%', kind: 'coupon', status: 'active', discount: { type: 'percent', percent: 15, maxCents: null }, startsAt: null, endsAt: '2027-01-31T00:00:00.000Z', minSpendCents: 3000,
  maxRedemptions: 50, redeemed: 3, maxPerCustomer: 1, stackable: false, newCustomersOnly: false, memberOnly: false, requiresCode: true, terms: 'One per visit.', budgetCents: null, allBranches: true };

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
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → offer (approved Deals & Promotions offers only)
    fireEvent.click(await screen.findByTestId('amk-b-offer-card'));
    expect(screen.getByTestId('amk-b-offer-terms')).toHaveTextContent('Needs a code at checkout');
    expect(screen.getByTestId('amk-b-offer-terms')).toHaveTextContent('3 of 50 used');
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → schedule (a proposal, checked; budget beside it)
    fireEvent.change(screen.getByTestId('amk-b-budget'), { target: { value: '5' } });
    expect(screen.getByTestId('amk-b-readiness')).toHaveTextContent('Choose a date');
    fireEvent.click(screen.getByTestId('amk-b-next'));                         // → review
    fireEvent.click(screen.getByTestId('amk-b-save'));
    expect(await screen.findByTestId('amk-b-saved')).toHaveTextContent('Nothing has been sent or scheduled.');
    expect(c.saveDraft).toHaveBeenCalledTimes(1);
    const body = c.saveDraft.mock.calls[0][0];
    expect(body).toMatchObject({ kind: 'winback', channel: 'sms', message: REC.message.body, budgetCents: 500, name: 'We miss you', dealId: 'd-1', sendDate: null });
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
  it('Step 5: a proposed time is checked in salon time; a blocked time stops the wizard; the review shows offer + proposal; save carries both', async () => {
    c.saveDraft.mockResolvedValue({ duplicate: false, campaignId: 'cmp-7', eligible: 4, excluded: 1, sent: 0 });
    wrap('/tenant/ai/marketing/builder?kind=winback&channel=sms');
    fireEvent.click(screen.getByTestId('amk-b-next')); await screen.findByTestId('amk-b-aud-status');
    fireEvent.click(screen.getByTestId('amk-b-next')); await screen.findByTestId('amk-est-cost');
    fireEvent.click(screen.getByTestId('amk-b-next')); fireEvent.click(await screen.findByTestId('amk-b-offer-card'));
    fireEvent.click(screen.getByTestId('amk-b-next'));
    c.scheduleCheck.mockResolvedValueOnce({ ok: false, timeZone: 'America/New_York', sendAt: null, checks: [{ key: 'quiet_hours', state: 'block', detail: '21:45 is inside the quiet hours (21:00–08:00 salon time).' }] });
    fireEvent.click(screen.getByTestId('amk-b-date'));
    const all = [...document.querySelectorAll<HTMLButtonElement>('button[data-ymd]')]; const day = all[all.length - 1];
    fireEvent.click(day);
    fireEvent.change(screen.getByTestId('amk-b-time'), { target: { value: '21:45' } });
    expect(await screen.findByTestId('amk-b-ck-quiet_hours')).toHaveTextContent('Not allowed');
    expect(c.scheduleCheck).toHaveBeenLastCalledWith({ date: day.dataset.ymd, time: '21:45', dealId: 'd-1' });
    fireEvent.click(screen.getByTestId('amk-b-next'));
    expect(screen.getByTestId('amk-gate')).toHaveTextContent('Fix the send time');
    fireEvent.change(screen.getByTestId('amk-b-time'), { target: { value: '10:00' } });
    await waitFor(() => expect(screen.getByTestId('amk-b-ck-quiet_hours')).toHaveTextContent('OK'));
    fireEvent.click(screen.getByTestId('amk-b-next'));                       // → review
    expect(screen.getByTestId('amk-b-r-offer')).toHaveTextContent('Winter 15%');
    expect(screen.getByTestId('amk-b-r-when')).toHaveTextContent(`${day.dataset.ymd} 10:00 (America/New_York)`);
    fireEvent.click(screen.getByTestId('amk-b-save'));
    await screen.findByTestId('amk-b-saved');
    expect(c.saveDraft.mock.calls[0][0]).toMatchObject({ dealId: 'd-1', sendDate: day.dataset.ymd, sendTime: '10:00' });
  });
});
