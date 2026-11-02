import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { summary: vi.fn(), packages: vi.fn() } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: api, posAiUsageApi: {} }));
import { POSAiUsageScreen } from './POSAiUsageScreen';
describe('AI usage permissions', () => {
  it('shows a permission message on 403', async () => {
    const e = Object.assign(new Error('forbidden'), { status: 403, code: 'PERMISSION_DENIED' });
    api.summary.mockRejectedValue(e); api.packages.mockRejectedValue(e);
    render(<POSAiUsageScreen />);
    expect((await screen.findAllByText(/permission/i)).length).toBeGreaterThan(0);
  });
});
