import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posUsageLimitsApi', () => ({ posUsageLimitsApi: { state: stateMock } }));
import { POSUsageLimitsScreen } from './POSUsageLimitsScreen';
describe('Usage & limits permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSUsageLimitsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
