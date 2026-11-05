import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: getMock, updateCategory: vi.fn() } }));
import { POSEmailScreen } from './POSEmailScreen';
describe('Email settings permissions', () => {
  it('shows a permission message on 403', async () => { getMock.mockRejectedValue({ status: 403 }); render(<POSEmailScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
