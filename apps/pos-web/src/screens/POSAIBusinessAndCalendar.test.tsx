import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const overview = { frontDeskStatus: 'setup', writeToolsEnabled: false, keyIssued: false, providers: { voiceAgent: 'not_connected', telephony: 'not_connected' }, analytics: { totalCalls: 0, booked: 0, bookingRatePct: null, handoffs: 0, handoffRatePct: null, abandoned: 0, abandonmentRatePct: null, avgDurationSeconds: null, topIntents: [] }, checklist: [{ key: 'business_setup', label: 'Confirm business hours & services', state: 'done', detail: 'ok' }], setupProgressPct: 100 };
const faqs = [{ id: 'faq1', question: 'Do you take walk-ins?', answer: 'Yes when available.', category: 'general', language: 'en', isActive: true, createdAtMs: 1, updatedAtMs: 1 }];

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistOverview: () => Promise.resolve(overview),
    receptionistFaqs: () => Promise.resolve(faqs),
    createReceptionistFaq: vi.fn(), updateReceptionistFaq: vi.fn(), deleteReceptionistFaq: vi.fn(),
  },
}));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: () => Promise.resolve([{ id: 's1' }, { id: 's2' }]) } }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { list: () => Promise.resolve([{ id: 't1' }]) } }));
vi.mock('../api/posBookingApi', () => ({ posBookingApi: { dayGrid: () => Promise.resolve({ date: '2026-07-04', openTime: '09:00', closeTime: '19:00', totalOpenSlots: 12, columns: [{ available: true }], appointments: [{ appointmentId: 'bk1', startTime: '10:00', endTime: '10:30', customerName: 'Ann', services: [{ serviceName: 'Gel Manicure' }], status: 'booked', source: 'ai' }] }) } }));

import { POSAIBusinessSetupScreen } from './POSAIBusinessSetupScreen';
import { POSAICalendarScreen } from './POSAICalendarScreen';

describe('POSAIBusinessSetupScreen', () => {
  it('shows readiness from real service/technician counts and lists FAQs', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Do you take walk-ins?')).toBeInTheDocument());
    expect(screen.getByText(/2 services available/)).toBeInTheDocument();
    expect(screen.getByText(/1 technician on file/)).toBeInTheDocument();
  });
});

describe('POSAICalendarScreen', () => {
  it('reuses the booking day-grid and marks AI-created appointments', async () => {
    render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Ann')).toBeInTheDocument());
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument(); // AI-source badge
    expect(screen.getByText('Open in POS Booking')).toBeInTheDocument(); // deep link, not a second calendar
  });
});
