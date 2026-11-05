// RateTechScreen (customer mutation): 1-5 stars + tags + optional text, verified server-side against the paid ticket, with
// a 7-day edit window. Verifies a fresh submit (stars/tags/text payload), the existing-rating update path (which depends on
// existing.ratingId — the field actually returned by the backend), the read-only state past the edit window, the submit
// guard, an error, and the post-submit favorite action.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api/customerApi', () => ({ customerApi: { myTechRating: vi.fn(), submitTechRating: vi.fn(), updateTechRating: vi.fn(), addTechFavorite: vi.fn() } }));

import { customerApi } from '../api/customerApi';
import { RateTechScreen } from './RateTechScreen';

const renderAt = (path = '/rate/T1/tech1?name=Mia') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/rate/:ticketId/:technicianId" element={<RateTechScreen />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  (customerApi.myTechRating as any).mockResolvedValue({ exists: false });
  (customerApi.submitTechRating as any).mockResolvedValue({ ok: true, message: 'Thanks for rating Mia!' });
  (customerApi.updateTechRating as any).mockResolvedValue({ ok: true, message: 'Rating updated.' });
  (customerApi.addTechFavorite as any).mockResolvedValue({ ok: true, publicSlug: 'mia', displayName: 'Mia' });
});

describe('RateTechScreen', () => {
  it('submits a fresh rating with stars, tags and text', async () => {
    renderAt();
    expect(await screen.findByText(/How was your service with Mia/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByText('Friendly'));
    fireEvent.change(screen.getByPlaceholderText(/Write a review/), { target: { value: 'Great job' } });
    fireEvent.click(screen.getByText('Submit Rating'));
    await waitFor(() => expect(customerApi.submitTechRating).toHaveBeenCalledWith('T1', expect.objectContaining({
      technicianId: 'tech1', rating: 5, tags: ['Friendly'], reviewText: 'Great job', isPublic: true,
    })));
    expect(await screen.findByText('Thanks for rating Mia!')).toBeInTheDocument();
  });

  it('updates an existing rating using its ratingId', async () => {
    (customerApi.myTechRating as any).mockResolvedValue({ exists: true, ratingId: 'rt1', rating: 4, reviewText: 'good', tags: ['Fast'], editable: true, editableUntil: '2026-06-24T00:00:00Z' });
    renderAt();
    expect(await screen.findByText(/update it within 7 days/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('good')).toBeInTheDocument();         // prefilled
    fireEvent.click(screen.getByText('Update Rating'));
    await waitFor(() => expect(customerApi.updateTechRating).toHaveBeenCalledWith('T1', 'rt1', expect.objectContaining({ rating: 4, reviewText: 'good', tags: ['Fast'] })));
  });

  it('disables editing once the 7-day window has passed', async () => {
    (customerApi.myTechRating as any).mockResolvedValue({ exists: true, ratingId: 'rt1', rating: 3, reviewText: null, tags: [], editable: false, editableUntil: '2026-06-01T00:00:00Z' });
    renderAt();
    expect(await screen.findByText(/can no longer be edited/)).toBeInTheDocument();
    expect(screen.getByText('Update Rating')).toBeDisabled();
  });

  it('keeps Submit disabled until a star is chosen', async () => {
    renderAt();
    await screen.findByText(/How was your service with Mia/);
    expect(screen.getByText('Submit Rating')).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    expect(screen.getByText('Submit Rating')).not.toBeDisabled();
  });

  it('shows an error when submission fails', async () => {
    (customerApi.submitTechRating as any).mockRejectedValue(new Error('Ticket is not paid yet'));
    renderAt();
    await screen.findByText(/How was your service with Mia/);
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByText('Submit Rating'));
    expect(await screen.findByText('Ticket is not paid yet')).toBeInTheDocument();
  });

  it('favorites the tech from the thank-you screen', async () => {
    renderAt();
    await screen.findByText(/How was your service with Mia/);
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByText('Submit Rating'));
    const favBtn = await screen.findByText('♡ Favorite this tech');
    fireEvent.click(favBtn);
    await waitFor(() => expect(customerApi.addTechFavorite).toHaveBeenCalledWith({ technicianId: 'tech1' }));
  });
});
