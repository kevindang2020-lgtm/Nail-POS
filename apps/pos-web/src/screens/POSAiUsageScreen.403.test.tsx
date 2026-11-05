import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { pkgMock } = vi.hoisted(() => ({ pkgMock: vi.fn() }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageApi: { packages: pkgMock, startTrial: vi.fn(), cancel: vi.fn() } }));
import { POSAiUsageScreen } from './POSAiUsageScreen';
describe('AI usage permissions', () => {
  it('shows a permission message on 403', async () => { pkgMock.mockRejectedValue({ status: 403 }); render(<POSAiUsageScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
