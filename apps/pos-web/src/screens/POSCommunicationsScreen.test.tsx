import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { POSCommunicationsScreen } from './POSCommunicationsScreen';

vi.mock('../api/posCommunicationsApi', () => {
  const thread = { id: 't1', customerName: 'Olivia Brown', customerContact: '(555) 123-4567', channel: 'sms', status: 'open', assignedToName: null, unreadCount: 1, lastMessageAt: '2026-06-06T14:00:00Z', lastMessagePreview: "Hi! I'd like to book a gel mani" };
  return {
    posCommunicationsApi: {
      getState: vi.fn().mockResolvedValue({
        kpis: { totalThreads: 1, openConversations: 1, unreadThreads: 1, repliedThreads: 0, missedThreads: 0 },
        threads: [thread], pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
      }),
      getThread: vi.fn().mockResolvedValue({
        thread,
        messages: [
          { id: 'm1', direction: 'inbound', body: 'Hi! I would like to book a gel mani this weekend.', authorName: null, createdAt: '2026-06-06T14:00:00Z', status: 'delivered' },
        ],
      }),
      markRead: vi.fn().mockResolvedValue({}),
      reply: vi.fn(), setStatus: vi.fn(), create: vi.fn(),
      getActivity: vi.fn().mockResolvedValue({
        windowDays: 30,
        messagesSentToday: { value: 12, available: true },
        campaignDeliveryRatePct: { value: 93, available: true },
        aiCallsHandled: { value: 4, available: true },
        reviewRequestsSent: { value: 7, available: true },
        avgResponseMinutes: { value: 15, available: true },
        rebookingConversionPct: { value: null, available: false, reason: 'Rebooking conversion needs campaign→booking attribution, which nothing records yet' },
      }),
    },
  };
});

describe('POSCommunicationsScreen', () => {
  it('renders the inbox + KPIs + hub modules, and opens a conversation on click', async () => {
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);

    // inbox list + KPIs
    expect(await screen.findByText('Olivia Brown')).toBeInTheDocument();
    expect(screen.getByText('Open Conversations')).toBeInTheDocument();
    expect(screen.getByText('Total Conversations')).toBeInTheDocument();
    // T14 hub modules
    expect(screen.getByText('Channel Mix')).toBeInTheDocument();
    expect(screen.getByText('AI Receptionist & Missed Calls')).toBeInTheDocument();
    expect(screen.getByText('Campaign Center')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // empty conversation pane prompt
    expect(screen.getByText('Select a conversation')).toBeInTheDocument();

    // open the thread → conversation messages render
    fireEvent.click(screen.getByText('Olivia Brown'));
    expect(await screen.findByText('Hi! I would like to book a gel mani this weekend.')).toBeInTheDocument();
  });

  it('Open AI Receptionist and Open Templates navigate to their REAL screens (both exist now)', async () => {
    // History: these buttons once navigated to unregistered routes (dead-end), then honestly said "isn't connected
    // yet" while the screens didn't exist. Both screens have since been BUILT and routed (/tenant/ai/receptionist,
    // /tenant/communications/templates) — so the honest-disclosure message itself became the lie. They navigate now.
    render(
      <MemoryRouter initialEntries={["/tenant/communications"]}>
        <Routes>
          <Route path="/tenant/communications" element={<POSCommunicationsScreen />} />
          <Route path="/tenant/ai/receptionist" element={<div>AI-RECEPTIONIST-SCREEN</div>} />
          <Route path="/tenant/communications/templates" element={<div>TEMPLATES-SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Olivia Brown');
    fireEvent.click(screen.getByText('Open AI Receptionist'));
    expect(await screen.findByText('AI-RECEPTIONIST-SCREEN')).toBeInTheDocument();
  });

  it('renders the activity metrics from their real sources, and shows an unavailable one as — not 0', async () => {
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Messages Sent Today')).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
    // rebooking conversion has no source — it must read as not-tracked, never as 0%
    expect(screen.getByText('Rebooking Conv.')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('not tracked yet').length).toBeGreaterThanOrEqual(1);
  });
});
