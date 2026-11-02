// CustomerEditSocialProfileScreen (customer mutation): edit NailShowcase profile (name, bio, profile toggles, avatar) and
// visibility via the embedded privacy control. All writes go through /customer/social/me/* and re-hydrate from the returned
// profile. Verifies hydrate, the Save payload, a toggle reflected in the payload, the visibility change, avatar upload,
// and a load error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/customerSocialApi', () => ({ customerSocialApi: { myProfile: vi.fn(), updateMyProfile: vi.fn(), uploadAvatar: vi.fn() } }));
vi.mock('./CustomerProfilePrivacySettings', () => ({ CustomerProfilePrivacySettings: ({ onUpdate }: any) => <button onClick={() => onUpdate('public')}>privacy-make-public</button> }));
vi.mock('./NailShowcaseLeaderboardCard', () => ({ SocialAvatar: () => <div data-testid="avatar" /> }));

import { customerSocialApi } from '../api/customerSocialApi';
import { CustomerEditSocialProfileScreen } from './CustomerEditSocialProfileScreen';

const prof = (over: any = {}) => ({
  customerId: 'c1', publicDisplayName: 'Sophia N.', avatarUrl: null, bio: 'I love almond nails',
  profileVisibility: 'private', isPublicProfile: false, showRankOnProfile: true, showPostsOnProfile: true, allowFollowers: true,
  followerCount: 12, followingCount: 8, score: 340, rank: 5, likesCount: 50, dislikesCount: 2, commentsCount: 10, postsCount: 6, isMine: true, ...over,
});

const renderScreen = () => render(<MemoryRouter><CustomerEditSocialProfileScreen /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  (customerSocialApi.myProfile as any).mockResolvedValue(prof());
  (customerSocialApi.updateMyProfile as any).mockImplementation((b: any) => Promise.resolve(prof(b)));
  (customerSocialApi.uploadAvatar as any).mockResolvedValue({ avatarUrl: 'https://img/a' });
});

describe('CustomerEditSocialProfileScreen', () => {
  it('hydrates the form from the loaded profile', async () => {
    renderScreen();
    expect(await screen.findByDisplayValue('Sophia N.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('I love almond nails')).toBeInTheDocument();
    expect(screen.getByLabelText('Allow other customers to follow me')).toBeChecked();
  });

  it('saves the edited profile payload', async () => {
    renderScreen();
    const nameInput = await screen.findByDisplayValue('Sophia N.');
    fireEvent.change(nameInput, { target: { value: 'Sophia Nguyen' } });
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(customerSocialApi.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({
      publicDisplayName: 'Sophia Nguyen', bio: 'I love almond nails', showRankOnProfile: true, showPostsOnProfile: true, allowFollowers: true,
    })));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('reflects a toggled flag in the save payload', async () => {
    renderScreen();
    await screen.findByDisplayValue('Sophia N.');
    fireEvent.click(screen.getByLabelText('Allow other customers to follow me'));   // true -> false
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(customerSocialApi.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ allowFollowers: false })));
  });

  it('changes visibility through the embedded privacy control', async () => {
    renderScreen();
    await screen.findByDisplayValue('Sophia N.');
    fireEvent.click(screen.getByText('privacy-make-public'));
    await waitFor(() => expect(customerSocialApi.updateMyProfile).toHaveBeenCalledWith({ profileVisibility: 'public' }));
  });

  it('uploads an avatar then re-fetches the profile', async () => {
    renderScreen();
    await screen.findByDisplayValue('Sophia N.');
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload avatar'), { target: { files: [file] } });
    await waitFor(() => expect(customerSocialApi.uploadAvatar).toHaveBeenCalledWith(file));
    await waitFor(() => expect(customerSocialApi.myProfile).toHaveBeenCalledTimes(2));   // initial + after upload
  });

  it('shows an error when the profile fails to load', async () => {
    (customerSocialApi.myProfile as any).mockRejectedValue(new Error('profile unavailable'));
    renderScreen();
    expect(await screen.findByText('profile unavailable')).toBeInTheDocument();
  });
});
