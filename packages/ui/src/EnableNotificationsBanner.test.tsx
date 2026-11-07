// Nov 6 2026: notification permission is asked from a tap on this banner, never at sign-in.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EnableNotificationsBanner, pushPromptSnoozed, snoozePushPrompt, PUSH_PROMPT_SNOOZE_MS } from './EnableNotificationsBanner';

beforeEach(() => { localStorage.clear(); });

describe('EnableNotificationsBanner', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<EnableNotificationsBanner visible={false} onEnable={async () => true} onDismiss={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
  it('"Turn on" runs the permission request inside the tap', async () => {
    const onEnable = vi.fn(async () => true);
    render(<EnableNotificationsBanner visible onEnable={onEnable} onDismiss={() => undefined} reason="Why" />);
    expect(screen.getByText('Why')).toBeTruthy();
    fireEvent.click(screen.getByText('Turn on'));
    await waitFor(() => expect(onEnable).toHaveBeenCalledTimes(1));
  });
  it('a refusal explains where to allow it', async () => {
    render(<EnableNotificationsBanner visible onEnable={async () => false} onDismiss={() => undefined} />);
    fireEvent.click(screen.getByText('Turn on'));
    expect(await screen.findByText(/blocked/)).toBeTruthy();
  });
  it('"Not now" dismisses', () => {
    const onDismiss = vi.fn();
    render(<EnableNotificationsBanner visible onEnable={async () => true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(onDismiss).toHaveBeenCalled();
  });
  it('the snooze lasts 30 days on this device', () => {
    const now = 1_000_000_000_000;
    expect(pushPromptSnoozed(now)).toBe(false);
    snoozePushPrompt(now);
    expect(pushPromptSnoozed(now + PUSH_PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(pushPromptSnoozed(now + PUSH_PROMPT_SNOOZE_MS + 1)).toBe(false);
  });
});
