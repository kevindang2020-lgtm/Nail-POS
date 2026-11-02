import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { summary: vi.fn(), customers: vi.fn(), readiness: vi.fn() } }));
vi.mock('../api/posRetentionApi', () => ({ posRetentionApi: api }));
import { POSRetentionScreen } from './POSRetentionScreen';
describe('Retention permissions', () => {
  it('shows a permission message on 403', async () => {
    const e = Object.assign(new Error('forbidden'), { status: 403, code: 'PERMISSION_DENIED' });
    api.summary.mockRejectedValue(e); api.customers.mockRejectedValue(e); api.readiness.mockRejectedValue(e);
    render(<POSRetentionScreen />);
    expect((await screen.findAllByText(/permission/i)).length).toBeGreaterThan(0);
  });
});
