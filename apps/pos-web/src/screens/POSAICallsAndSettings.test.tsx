import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// AI Calls guide (Oct 31 2026): the calls page reads /pos/ai/calls-center/* (posAiCallsCenterApi)
const callRow = { id: 'o1', callRef: 'call_1', startedAt: '2026-07-04T14:00:00Z', endedAt: '2026-07-04T14:02:05Z', durationSeconds: 125, intents: ['book_appointment'], bookingOutcome: 'booked',
  handoffOutcome: null, abandoned: false, followUpRequired: false, errorCategory: null, callerMasked: '•••• 0142', identity: 'linked_customer', status: 'completed', tools: { requested: 2, failed: 1 }, linkedAppointments: 0 };
const detail = {
  call: { id: 'o1', callRef: 'call_1', startedAt: callRow.startedAt, endedAt: callRow.endedAt, durationSeconds: 125, provider: 'retell', intents: ['book_appointment'], bookingOutcome: 'booked', handoffOutcome: null, errorCategory: null, summary: { text: 'Booked a gel manicure.', generated: true } },
  caller: { masked: '•••• 0142', identity: 'linked_customer', explanation: 'Linked through the follow-up the call created.' }, customer: null, appointments: [], followUps: [], handoffs: [], actions: [], transcript: null,
  overview: { agentRef: 'agent_a', direction: 'inbound', disconnectionReason: 'agent_hangup', lastSyncedAt: callRow.endedAt, statusNote: null }, events: [],
  toolActivity: [{ id: 't1', tool: 'create_appointment', status: 'failed', businessResult: null, errorCategory: 'SLOT_UNAVAILABLE', requests: 1, requestedAt: callRow.startedAt }],
  toolNote: 'Each row is a request the agent made.', booking: { aiReported: 'booked', verified: [], note: 'The agent reported "booked", but no appointment is linked to this call through a recorded tool result.' },
  recording: { state: 'consent_unknown', note: 'No consent record exists for this call, so no recording may be shown.', consent: null }, customerPermissions: null,
};
const kpis = { window: { from: '2026-07-01', to: '2026-07-31' }, total: 1, completed: 1, failedOrMissed: 0, inProgress: 0, stale: 0, bookings: { aiReported: 1, verified: null }, handoffs: { requested: 0, connected: 0 },
  unresolved: 0, followUpsCreated: 0, avgDurationSeconds: 125, voiceMinutes: 2.1, definitions: {}, lastSyncedAt: callRow.endedAt };
vi.mock('../api/posAiCallsCenterApi', () => ({
  posAiCallsCenterApi: {
    kpis: () => Promise.resolve(kpis), calls: () => Promise.resolve({ items: [callRow], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } }),
    search: () => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }), call: () => Promise.resolve(detail),
    health: () => Promise.resolve({ overall: 'READY', checks: [] }), lastHealth: () => Promise.resolve(null), reconciliation: () => Promise.resolve({ eventsWithoutCall: [], staleInProgress: [] }),
    assistant: () => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
  },
}));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
const settings = { enabled: false, defaultLanguage: 'en', afterHoursBehavior: 'ai_answers', allowInterruptions: true, silenceTimeoutSeconds: 8, maxCallDurationSeconds: 600, recordingEnabled: false, recordingConsentMessage: 'This call may be recorded.' };
const updateReceptionistSettings = vi.fn((_b?: any) => Promise.resolve({ ...settings, enabled: true }));

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistSettings: () => Promise.resolve(settings), receptionistSettingsHistory: () => Promise.resolve({ items: [] }),
    updateReceptionistSettings: (b: any) => updateReceptionistSettings(b),
  },
}));

import { POSAICallsScreen } from './POSAICallsScreen';
import { POSAISettingsScreen } from './POSAISettingsScreen';

describe('POSAICallsScreen', () => {
  it('lists the call, separates "AI says booked" from a verified booking, and the overlay shows the failed tool honestly', async () => {
    render(<MemoryRouter><POSAICallsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('book_appointment')).toBeInTheDocument());
    expect(screen.getByText('AI says booked')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aic-open'));
    await waitFor(() => expect(screen.getByTestId('aic-overlay')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('aic-tab-tools'));
    expect(screen.getByText('create_appointment')).toBeInTheDocument(); expect(screen.getByText('SLOT_UNAVAILABLE')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aic-tab-booking'));
    expect(screen.getByTestId('aic-booking-note')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aic-tab-recording'));
    expect(screen.getByText(/no recording may be shown/)).toBeInTheDocument();
  });
});

describe('POSAISettingsScreen', () => {
  it('loads real settings and saves a patch', async () => {
    render(<MemoryRouter><POSAISettingsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Enable AI Receptionist')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(updateReceptionistSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, defaultLanguage: 'en' })));
  });
});
