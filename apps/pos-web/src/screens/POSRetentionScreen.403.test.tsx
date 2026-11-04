import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
// every call the screen makes on load answers 403 (the SMS pricing card loads on its own — it was missing here and crashed the test)
const { api } = vi.hoisted(() => ({ api: { summary: vi.fn(), customers: vi.fn(), readiness: vi.fn(), smsPricing: vi.fn(), settings: vi.fn(), campaigns: vi.fn(), snapshotRuns: vi.fn(), recovery: vi.fn() } }));
vi.mock('../api/posRetentionApi', () => ({ posRetentionApi: api }));
import { POSRetentionScreen } from './POSRetentionScreen';
describe('Retention permissions', () => {
  it('shows a permission message on 403', async () => {
    const e = Object.assign(new Error('forbidden'), { status: 403, code: 'PERMISSION_DENIED' });
    for (const f of Object.values(api)) f.mockRejectedValue(e);
    render(<MemoryRouter><POSRetentionScreen /></MemoryRouter>);
    expect((await screen.findAllByText(/permission/i)).length).toBeGreaterThan(0);
  });
});
