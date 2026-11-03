import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { summary: vi.fn(), recommendations: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c } }));
vi.mock('../api/posCampaignCenterApi', () => ({ posCampaignCenterApi: { list: vi.fn().mockRejectedValue({ status: 403 }) } }));
import { POSAIMarketingScreen } from './POSAIMarketingScreen';

describe('AI Marketing permissions', () => {
  it('shows a permission message on 403', async () => {
    c.summary.mockRejectedValue({ status: 403 }); c.recommendations.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSAIMarketingScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Your role cannot use marketing.')).length).toBeGreaterThan(0);
  });
});
