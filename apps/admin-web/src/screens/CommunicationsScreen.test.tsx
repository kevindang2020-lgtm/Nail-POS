import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminCommunicationsApi', () => ({
  superAdminCommunicationsApi: {
    getState: vi.fn().mockResolvedValue({
      kpis: { totalThreads: 2, openConversations: 2, unreadThreads: 2, unreadMessages: 3, repliedThreads: 0, missedThreads: 0 },
      messageKpis: { totalMessages: 8, emailSent: 3, smsSent: 3, whatsappSent: 2, callCount: 0, deliveryRate: 62.5, responseRate: 14.3, customerReplies: 1, outboundCount: 7 },
      threads: [
        { id: 't1', tenantId: 'x', customerName: 'Sarah Johnson', channel: 'whatsapp', status: 'open', unreadCount: 2, lastMessageAt: '2026-06-22T10:00:00Z', lastMessagePreview: 'reschedule pls' },
        { id: 't2', tenantId: 'x', customerName: 'Michael Brown', channel: 'email', status: 'open', unreadCount: 1, lastMessageAt: '2026-06-22T09:00:00Z', lastMessagePreview: 'availability?' },
      ],
      byChannel: [{ channel: 'whatsapp', count: 1, unread: 2 }, { channel: 'email', count: 1, unread: 1 }],
      messageByChannel: [{ channel: 'email', count: 3, delivered: 2 }, { channel: 'sms', count: 3, delivered: 2 }, { channel: 'whatsapp', count: 2, delivered: 1 }],
      channelAnalytics: [{ channel: 'email', sent: 3, delivered: 2, deliveryRate: 66.7 }, { channel: 'sms', sent: 3, delivered: 2, deliveryRate: 66.7 }],
      queue: { scheduled: 1, pending: 0, failed: 1, draft: 1 },
      engagementTrend: [{ date: '2026-06-22', count: 8 }],
      recentActivity: [{ customerName: 'Sarah Johnson', channel: 'whatsapp', preview: 'reschedule pls', at: '2026-06-22T10:00:00Z', direction: 'inbound' }],
      pagination: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
    }),
  },
}));

import { CommunicationsScreen } from './CommunicationsScreen';

describe('CommunicationsScreen (S12)', () => {
  it('renders every mockup module wired to real message data, with honest empties where there is no source', async () => {
    render(<MemoryRouter><CommunicationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Communications Hub')).toBeInTheDocument();
    expect(screen.getAllByText('Total Messages').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Email Sent')).toBeInTheDocument();
    expect(screen.getByText('Message Channel Performance')).toBeInTheDocument();
    expect(screen.getByText('Communication Overview')).toBeInTheDocument();
    expect(screen.getByText('Engagement Trend')).toBeInTheDocument();
    expect(screen.getByText('Unified Inbox', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Message Queue')).toBeInTheDocument();
    expect(screen.getByText('Channel Analytics')).toBeInTheDocument();
    expect(screen.getByText('Top Performing Templates')).toBeInTheDocument();
    expect(screen.getByText('Audience Segmentation')).toBeInTheDocument();
    expect(screen.getByText('Communication Automation')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    // real data
    expect(screen.getAllByText('Sarah Johnson').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Scheduled Messages')).toBeInTheDocument();
    // honest gaps
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(1);
  });
});
