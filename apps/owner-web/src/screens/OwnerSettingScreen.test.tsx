import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const back = vi.hoisted(() => vi.fn());
const openNotifications = vi.hoisted(() => vi.fn());
vi.mock('../shell/nav', () => ({
  useOwnerNav: () => ({ back, openNotifications }),
}));

vi.mock('../api/ownerApi', () => ({
  ownerMoreApi: {
    settings: vi.fn(),
  },
}));

import { ownerMoreApi } from '../api/ownerApi';
import { OwnerSettingScreen } from './OwnerSettingScreen';

beforeEach(() => {
  vi.clearAllMocks();
  (ownerMoreApi.settings as any).mockResolvedValue({
    businessName: 'Lotus Nails',
    timezone: 'America/New_York',
    currency: 'USD',
    branchCount: 3,
    activeBranchCount: 2,
  });
});

describe('OwnerSettingScreen', () => {
  it('renders Settings header and back button', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    const backBtn = screen.getByLabelText('Back');
    fireEvent.click(backBtn);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('loads and displays settings snapshot details', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    expect(screen.getByText('America/New_York')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('2 active / 3')).toBeInTheDocument();
  });

  it('opens and submits Change Password modal', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    const changePwBtn = screen.getByText('Change Password');
    fireEvent.click(changePwBtn);

    expect(screen.getByText('Current Password')).toBeInTheDocument();
    expect(screen.getByText('New Password')).toBeInTheDocument();
    expect(screen.getByText('Confirm New Password')).toBeInTheDocument();

    const inputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(inputs[0], { target: { value: 'oldsecret' } });
    fireEvent.change(inputs[1], { target: { value: 'newsecret' } });
    fireEvent.change(inputs[2], { target: { value: 'newsecret' } });

    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Password Updated')).toBeInTheDocument();
  });

  it('toggles Face ID switch and updates language dropdown', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    const faceIdRow = screen.getByText('Face ID / Biometric Login');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;

    expect(checkbox.checked).toBe(false);
    fireEvent.click(faceIdRow);
    expect(checkbox.checked).toBe(true);

    const langSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(langSelect.value).toBe('English (US)');
    fireEvent.change(langSelect, { target: { value: 'Spanish' } });
    expect(langSelect.value).toBe('Spanish');
  });

  it('navigates to notifications screen when Notifications row is tapped', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    const notifRow = screen.getByText('Notifications');
    fireEvent.click(notifRow);
    expect(openNotifications).toHaveBeenCalledTimes(1);
  });
});
