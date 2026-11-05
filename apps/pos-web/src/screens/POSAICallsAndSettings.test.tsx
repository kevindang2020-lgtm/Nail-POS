import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const calls = [
  { providerCallId: 'call_1', startedAt: '2026-07-04T14:00:00Z', durationSeconds: 125, language: 'en', intents: ['book_appointment'], toolCalls: [{ name: 'create_appointment', ok: true }, { name: 'check_availability', ok: false }], bookingOutcome: 'booked', handoffOutcome: null, sentiment: 'positive', abandoned: false, followUpRequired: false, summary: 'Booked a gel manicure.' },
];
const settings = { enabled: false, defaultLanguage: 'en', afterHoursBehavior: 'ai_answers', allowInterruptions: true, silenceTimeoutSeconds: 8, maxCallDurationSeconds: 600, recordingEnabled: false, recordingConsentMessage: 'This call may be recorded.' };
const updateReceptionistSettings = vi.fn((_b?: any) => Promise.resolve({ ...settings, enabled: true }));

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistCalls: (_n?: number) => Promise.resolve(calls),
    receptionistSettings: () => Promise.resolve(settings),
    updateReceptionistSettings: (b: any) => updateReceptionistSettings(b),
  },
}));

import { POSAICallsScreen } from './POSAICallsScreen';
import { POSAISettingsScreen } from './POSAISettingsScreen';

describe('POSAICallsScreen', () => {
  it('shows a call and opens an honest detail drawer (no fake transcript)', async () => {
    render(<MemoryRouter><POSAICallsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('book_appointment')).toBeInTheDocument());
    fireEvent.click(screen.getByText('book_appointment'));
    await waitFor(() => expect(screen.getByText('Call detail')).toBeInTheDocument());
    expect(screen.getByText('Booked a gel manicure.')).toBeInTheDocument();
    expect(screen.getByText(/Transcript and recording aren/)).toBeInTheDocument(); // honest, not a broken player
    expect(screen.getByText('create_appointment')).toBeInTheDocument();
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
