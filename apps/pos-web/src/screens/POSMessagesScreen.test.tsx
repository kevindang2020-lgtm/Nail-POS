import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { POSMessagesScreen } from './POSMessagesScreen';

const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSMessagesScreen', () => {
  it('mounts, renders compose + empty recent log', async () => {
    globalThis.fetch = mockFetch({ items: [] }) as any;
    render(<POSMessagesScreen />);
    expect(await screen.findByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Compose')).toBeInTheDocument();
    expect(await screen.findByText('No messages sent yet.')).toBeInTheDocument();
  });

  it('disables send until recipient + body are present', async () => {
    globalThis.fetch = mockFetch({ items: [] }) as any;
    render(<POSMessagesScreen />);
    const sendBtn = (await screen.findByText('Send message')) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), { target: { value: '+15551234567' } });
    fireEvent.change(screen.getByPlaceholderText('Type your message…'), { target: { value: 'Hello' } });
    expect((screen.getByText('Send message') as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches to the Opt-outs tab and shows its empty state', async () => {
    globalThis.fetch = mockFetch({ items: [] }) as any;
    render(<POSMessagesScreen />);
    fireEvent.click(await screen.findByText('Opt-outs'));
    expect(await screen.findByText(/Recipients who opt out will appear here/)).toBeInTheDocument();
    expect(screen.getByText('Add opt-out')).toBeInTheDocument();
  });

  it('switches to the Reminders tab and shows the enable control', async () => {
    globalThis.fetch = mockFetch({ enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' }) as any;
    render(<POSMessagesScreen />);
    fireEvent.click(await screen.findByText('Reminders'));
    expect(await screen.findByText('Enable appointment reminders')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
});
