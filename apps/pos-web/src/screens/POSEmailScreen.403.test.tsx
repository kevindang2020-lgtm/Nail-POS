import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
// the Email screen reads the Email Center API (settings / summary / health / history); a 403 from any of them is a permission message
const { deny } = vi.hoisted(() => ({ deny: vi.fn() }));
vi.mock('../api/posEmailCenterApi', () => ({ posEmailCenterApi: { settings: deny, summary: deny, health: deny, history: deny, check: vi.fn(), detail: vi.fn(), resend: vi.fn(), test: vi.fn(), compose: vi.fn() } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn().mockResolvedValue({ items: [] }) } }));
import { POSEmailScreen } from './POSEmailScreen';
describe('Email settings permissions', () => {
  it('shows a permission message on 403', async () => { deny.mockRejectedValue({ status: 403 }); render(<MemoryRouter><POSEmailScreen /></MemoryRouter>); expect((await screen.findAllByText(/do not have permission/i)).length).toBeGreaterThan(0); });
});
