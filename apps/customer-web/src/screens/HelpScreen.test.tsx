import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { salon: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { HelpScreen } from './HelpScreen';

describe('HelpScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows FAQ and a real call link to the salon', async () => {
    (customerApi.salon as any).mockResolvedValue({ name: 'AIPowerSalon', address: '123 Main St', phone: '(856) 555-0100' });
    render(<MemoryRouter><HelpScreen /></MemoryRouter>);
    expect(screen.getByText('How do I book an appointment?')).toBeInTheDocument();
    expect(await screen.findByText('AIPowerSalon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call salon' })).toHaveAttribute('href', 'tel:8565550100');
  });
});
