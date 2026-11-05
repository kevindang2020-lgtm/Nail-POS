import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    platformReminders: vi.fn().mockResolvedValue({
      rows: [
        { id: 'l1', channel: 'sms', template: 'appt_reminder_24h', targetMasked: '***1234', status: 'delivered', errorMessage: null, createdAt: '2026-06-22T10:00:00Z', tenantId: 'x', tenantName: 'Pilot Nail Salon' },
        { id: 'l2', channel: 'push', template: 'birthday', targetMasked: 'device-x', status: 'failed', errorMessage: 'token expired', createdAt: '2026-06-22T09:00:00Z', tenantId: 'x', tenantName: 'Pilot Nail Salon' },
      ],
      total: 6,
      kpis: { appointmentRemindersSent: 2, remindersSentThisMonth: 2, tenantsConfigured: 1, remindersEnabled: 1, avgLeadMinutes: 1440, deliveryLogs: 6, delivered: 5, failed: 1, deliveryRate: 83.3 },
      byChannel: [{ channel: 'sms', count: 3 }, { channel: 'push', count: 2 }, { channel: 'email', count: 1 }],
      byStatus: [{ status: 'delivered', count: 4 }, { status: 'sent', count: 1 }, { status: 'failed', count: 1 }],
      settingsByChannel: [{ channel: 'sms', count: 1 }],
      byDay: [{ date: '2026-06-22', count: 6, delivered: 5 }],
    }),
  },
}));

import { SmartRemindersScreen } from './SmartRemindersScreen';

describe('SmartRemindersScreen (S15)', () => {
  it('renders every mockup module: real reminder telemetry, honest gaps for ML/queue modules', async () => {
    render(<MemoryRouter><SmartRemindersScreen /></MemoryRouter>);
    expect(await screen.findByText('Smart Reminders')).toBeInTheDocument();
    expect(screen.getAllByText('Total Reminders Sent').length).toBeGreaterThanOrEqual(1);
    // real modules
    expect(screen.getByText('Reminder Performance Overview')).toBeInTheDocument();
    expect(screen.getByText('Reminder Channel Mix')).toBeInTheDocument();
    expect(screen.getByText('AI Reminder Health')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Reminder Flows')).toBeInTheDocument();
    expect(screen.getByText('Recent Reminder Activity')).toBeInTheDocument();
    expect(screen.getByText('Reminder Delivery Log', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Appt Reminder 24h').length).toBeGreaterThanOrEqual(1);
    // honest modules
    expect(screen.getByText('Today’s Reminder Queue')).toBeInTheDocument();
    expect(screen.getByText('Customer Segment Response')).toBeInTheDocument();
    expect(screen.getByText('AI Reminder Insights')).toBeInTheDocument();
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(3);
  });
});
