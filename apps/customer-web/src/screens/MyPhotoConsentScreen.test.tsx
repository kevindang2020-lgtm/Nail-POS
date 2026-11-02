// MyPhotoConsentScreen: lists the customer's consented salon photos and lets them withdraw consent (two-step confirm,
// then POST). Verifies listing, the empty state, and the confirm→withdraw flow + the confirmation note.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navMock }));
vi.mock('../api/customerPhotoConsentApi', () => ({ customerPhotoConsentApi: { list: vi.fn(), withdraw: vi.fn() } }));

import { customerPhotoConsentApi } from '../api/customerPhotoConsentApi';
import { MyPhotoConsentScreen } from './MyPhotoConsentScreen';

const photo = (over: any = {}) => ({ photoId: 'p1', imageUrl: '/p1.jpg', thumbnailUrl: '/p1t.jpg', caption: 'Chrome ombré', approvedUses: ['portfolio'], publicBlocked: false, consentedAt: '2026-06-01T00:00:00.000Z', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  (customerPhotoConsentApi.list as any).mockResolvedValue({ photos: [photo()] });
  (customerPhotoConsentApi.withdraw as any).mockResolvedValue({ ok: true, photoId: 'p1' });
});

describe('MyPhotoConsentScreen', () => {
  it('lists the customer’s consented photos', async () => {
    render(<MyPhotoConsentScreen />);
    expect(await screen.findByText('Chrome ombré')).toBeInTheDocument();
    expect(screen.getByText('Visible publicly')).toBeInTheDocument();
  });

  it('withdraws consent after a two-step confirm', async () => {
    render(<MyPhotoConsentScreen />);
    fireEvent.click(await screen.findByText('Withdraw consent'));
    fireEvent.click(screen.getByText('Yes, withdraw'));   // second step
    await waitFor(() => expect(customerPhotoConsentApi.withdraw).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText(/removed from public view/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no photos', async () => {
    (customerPhotoConsentApi.list as any).mockResolvedValue({ photos: [] });
    render(<MyPhotoConsentScreen />);
    expect(await screen.findByText(/No published photos/i)).toBeInTheDocument();
  });
});
