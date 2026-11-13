// AiPriceTablePanel.test — AI Usage Limits 07 (extras round 11): empty by default; publishing needs the keep-previous answer
// (nothing pre-selected); whole cents; salon price set / remove needs a reason.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { priceTable: vi.fn(), publishPriceVersion: vi.fn(), setPriceOverride: vi.fn() } }));
import { superAdminAiApi } from '../api/superAdminAiApi';
import { AiPriceTablePanel, dollarsToCents } from './AiPriceTablePanel';

const api = superAdminAiApi as unknown as Record<'priceTable' | 'publishPriceVersion' | 'setPriceOverride', ReturnType<typeof vi.fn>>;
const PKGS = [{ code: 'ai_marketing_assistant', name: 'AI Marketing Assistant' }, { code: 'ai_booking_assistant', name: 'AI Booking Assistant' }];
const EMPTY = { versions: [], overrides: [], empty: true, ceilingCents: 1_000_000 };
beforeEach(() => { vi.clearAllMocks(); api.priceTable.mockResolvedValue(EMPTY); });

describe('AiPriceTablePanel', () => {
  it('dollarsToCents: whole cents only, never a guess', () => {
    expect(dollarsToCents('61')).toBe(6100); expect(dollarsToCents('61.5')).toBe(6150); expect(dollarsToCents('0.07')).toBe(7);
    expect(dollarsToCents('61.555')).toBeNull(); expect(dollarsToCents('-1')).toBeNull(); expect(dollarsToCents('abc')).toBeNull(); expect(dollarsToCents('')).toBeNull();
  });
  it('says the table is empty; Publish stays off until the keep-previous question is answered (no answer pre-selected); then sends whole cents', async () => {
    api.publishPriceVersion.mockResolvedValue({ versionNo: 1 });
    render(<AiPriceTablePanel packages={PKGS} />);
    expect(await screen.findByTestId('apt-empty')).toHaveTextContent('Every salon sees "no price set"');
    const keep = within(screen.getByTestId('apt-keep')).getAllByRole('radio') as HTMLInputElement[];
    expect(keep.every((r) => !r.checked)).toBe(true);
    fireEvent.change(screen.getByLabelText('AI package'), { target: { value: 'ai_marketing_assistant' } });
    fireEvent.change(screen.getByLabelText('Price in dollars'), { target: { value: '61.00' } });
    fireEvent.change(screen.getByLabelText('Takes effect'), { target: { value: '2026-12-01T09:00' } });
    expect(screen.getByTestId('apt-publish')).toBeDisabled();
    fireEvent.click(keep[1]!);
    expect(screen.getByTestId('apt-publish')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('apt-publish'));
    await waitFor(() => expect(api.publishPriceVersion).toHaveBeenCalledWith(expect.objectContaining({ existingSalonsKeepPrevious: false, note: null,
      rows: [{ feature: 'ai_marketing_assistant', unit: 'month', priceCents: 6100 }] })));
    expect(await screen.findByTestId('apt-msg')).toHaveTextContent('Version 1 published.');
  });
  it('an invalid price keeps Publish off; published versions are listed with their keep choice', async () => {
    api.priceTable.mockResolvedValue({ ...EMPTY, empty: false, versions: [{ versionNo: 2, effectiveFrom: '2026-12-01T14:00:00Z', existingSalonsKeepPrevious: true, note: null, publishedAt: '2026-11-13T00:00:00Z', inEffect: false,
      rows: [{ feature: 'ai_marketing_assistant', unit: 'month', priceCents: 6900 }] }] });
    render(<AiPriceTablePanel packages={PKGS} />);
    const t = await screen.findByTestId('apt-versions');
    expect(t).toHaveTextContent('2 (scheduled)'); expect(t).toHaveTextContent('Yes'); expect(t).toHaveTextContent('AI Marketing Assistant $69.00 per month');
    fireEvent.change(screen.getByLabelText('AI package'), { target: { value: 'ai_marketing_assistant' } });
    fireEvent.change(screen.getByLabelText('Price in dollars'), { target: { value: '61.555' } });
    fireEvent.change(screen.getByLabelText('Takes effect'), { target: { value: '2026-12-01T09:00' } });
    fireEvent.click(within(screen.getByTestId('apt-keep')).getAllByRole('radio')[0]!);
    expect(screen.getByTestId('apt-publish')).toBeDisabled();
  });
  it('a salon price needs a salon, a package and a reason; Remove sends null', async () => {
    api.setPriceOverride.mockResolvedValue({});
    render(<AiPriceTablePanel packages={PKGS} />);
    await screen.findByTestId('apt-empty');
    fireEvent.change(screen.getByLabelText('Salon ID'), { target: { value: 'c5e97100-0000-4000-8000-000000000001' } });
    fireEvent.change(screen.getByLabelText('Salon price package'), { target: { value: 'ai_booking_assistant' } });
    fireEvent.click(screen.getByLabelText('Remove the salon price'));
    expect(screen.getByTestId('apt-override')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Pilot ended' } });
    fireEvent.click(screen.getByTestId('apt-override'));
    await waitFor(() => expect(api.setPriceOverride).toHaveBeenCalledWith({ tenantId: 'c5e97100-0000-4000-8000-000000000001', feature: 'ai_booking_assistant', unit: 'month', priceCents: null, reason: 'Pilot ended' }));
  });
});
