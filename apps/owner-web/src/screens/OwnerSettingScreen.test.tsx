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

const putLanguage = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ language: 'vi' })));
vi.mock('../api/client', async (orig) => ({ ...(await orig<typeof import('../api/client')>()), api: { put: (...a: any[]) => putLanguage(...a), get: vi.fn(async () => ({ language: null, timeZone: null })) } }));
import { getLanguage, resetI18nForTests, loadCommonForTests } from '@aipowersalon/mobile-sdk';
import { ownerMoreApi } from '../api/ownerApi';
import { OwnerSettingScreen } from './OwnerSettingScreen';

beforeEach(() => {
  vi.clearAllMocks();
  resetI18nForTests(); loadCommonForTests();
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

  it('Face ID is a real enrolment switch (off and unavailable where the device has no biometrics)', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    // Sep 2026 redesign: two switches — the Face ID switch enrols a real credential, so in a browser test (no
    // biometrics) it is OFF and DISABLED rather than a local toggle; the startup prompt depends on it.
    const faceId = screen.getByRole('checkbox', { name: 'Face ID / Biometric Login' }) as HTMLInputElement;
    const startup = screen.getByRole('checkbox', { name: 'Auto Biometrics on Startup' }) as HTMLInputElement;
    expect(faceId.checked).toBe(false);
    expect(faceId.disabled).toBe(true);
    expect(startup.disabled).toBe(true);

  });

  it("Kevin (Oct 28 2026): only the POS is bilingual — the Owner App has no language picker and stays English", async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    expect(screen.queryByText('Tiếng Việt')).toBeNull();
    expect(getLanguage()).toBe('en');
    expect(putLanguage).not.toHaveBeenCalled();
  });

  it('navigates to notifications screen when Notifications row is tapped', async () => {
    render(<OwnerSettingScreen />);
    expect(await screen.findByText('Lotus Nails')).toBeInTheDocument();
    const notifRow = screen.getByText('Notifications');
    fireEvent.click(notifRow);
    expect(openNotifications).toHaveBeenCalledTimes(1);
  });
});
