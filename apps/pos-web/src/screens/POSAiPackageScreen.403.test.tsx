import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { pkgMock } = vi.hoisted(() => ({ pkgMock: vi.fn() }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: { detail: pkgMock, startTrial: vi.fn(), cancel: vi.fn() } }));
import { POSAiPackageScreen } from './POSAiPackageScreen';
describe('AI package permissions', () => {
  it('shows a permission message on 403', async () => { pkgMock.mockRejectedValue({ status: 403 }); render(<POSAiPackageScreen code="ai_booking_assistant" title="AI Booking" />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
