import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { tipsMock } = vi.hoisted(() => ({ tipsMock: vi.fn() }));
vi.mock('../api/posReportsApi', () => ({ posReportsApi: { tips: tipsMock } }));
import { POSTeamTipsScreen } from './POSTeamTipsScreen';
describe('Team tips permissions', () => {
  it('shows a permission message on 403', async () => { tipsMock.mockRejectedValue({ status: 403 }); render(<POSTeamTipsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
