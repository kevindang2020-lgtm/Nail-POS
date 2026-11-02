// AICheckoutUpsellSettingsScreen.test.tsx — Functional Decision 27: the upsell value caps are configurable by the salon.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const settings = { enabled: true, disabledAtLevel: null, tunables: { maxTotal: 2, maxAddOn: 2, maxProduct: 2, maxMembership: 1, maxAddedValueCents: 3000, maxAddedPercent: 30, addOnsEnabled: true } };
vi.mock('../api/posAiCheckoutUpsellApi', () => ({ posAiCheckoutUpsellApi: { settings: vi.fn(), updateSettings: vi.fn() } }));
import { posAiCheckoutUpsellApi } from '../api/posAiCheckoutUpsellApi';
import { AICheckoutUpsellSettingsScreen } from './AICheckoutUpsellSettingsScreen';

beforeEach(() => {
  (posAiCheckoutUpsellApi.settings as any).mockResolvedValue(settings);
  (posAiCheckoutUpsellApi.updateSettings as any).mockImplementation(async (_l: string, p: any) => ({ ...settings, tunables: { ...settings.tunables, ...p.tunables } }));
});

describe('AI checkout upsell settings — Decision 27 value caps', () => {
  it('shows the defaults ($30 / 30%) and saves a salon\'s own choice of each', async () => {
    render(<MemoryRouter><AICheckoutUpsellSettingsScreen /></MemoryRouter>);
    const dollars = (await screen.findByLabelText('Max added value per visit')) as HTMLSelectElement;
    const share = screen.getByLabelText('Max share of booked services') as HTMLSelectElement;
    expect(dollars.value).toBe('3000'); expect(share.value).toBe('30');
    fireEvent.change(dollars, { target: { value: '5000' } });
    await waitFor(() => expect(posAiCheckoutUpsellApi.updateSettings).toHaveBeenCalledWith('tenant', expect.objectContaining({ tunables: expect.objectContaining({ maxAddedValueCents: 5000 }) })));
    fireEvent.change(screen.getByLabelText('Max share of booked services'), { target: { value: '20' } });
    await waitFor(() => expect(posAiCheckoutUpsellApi.updateSettings).toHaveBeenCalledWith('tenant', expect.objectContaining({ tunables: expect.objectContaining({ maxAddedPercent: 20 }) })));
  });
});
