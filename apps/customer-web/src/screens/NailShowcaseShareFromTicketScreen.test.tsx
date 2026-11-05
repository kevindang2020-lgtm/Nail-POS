import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('../api/customerNailShowcaseApi', () => ({ customerNailShowcaseApi: { eligibility: vi.fn(), createVerifiedPost: vi.fn(), uploadPhotos: vi.fn() } }));
import { customerNailShowcaseApi } from '../api/customerNailShowcaseApi';
import { NailShowcaseShareFromTicketScreen } from './NailShowcaseShareFromTicketScreen';

const renderAt = () => render(
  <MemoryRouter initialEntries={['/nail-showcase/share/tk1']}>
    <Routes><Route path="/nail-showcase/share/:ticketId" element={<NailShowcaseShareFromTicketScreen />} /></Routes>
  </MemoryRouter>,
);

describe('NailShowcaseShareFromTicketScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the verified share form when the visit is eligible', async () => {
    (customerNailShowcaseApi.eligibility as any).mockResolvedValue({ eligible: true, ticketId: 'tk1', technicianId: 't1', serviceId: 's1' });
    renderAt();
    expect(await screen.findByText('Share Verified Post')).toBeInTheDocument();
    expect(screen.getAllByText('✓ Verified Service').length).toBeGreaterThan(0);
    expect(screen.getByText(/linked automatically from this visit/)).toBeInTheDocument();
  });

  it('explains when the visit was already shared', async () => {
    (customerNailShowcaseApi.eligibility as any).mockResolvedValue({ eligible: false, alreadyPosted: true });
    renderAt();
    expect(await screen.findByText('You’ve already shared a post from this visit.')).toBeInTheDocument();
  });
});
