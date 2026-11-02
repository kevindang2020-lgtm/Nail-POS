import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ overview: vi.fn(), list: vi.fn(), detail: vi.fn(), intelligence: vi.fn(), generateSummary: vi.fn(), search: vi.fn(), unresolved: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock('../api/posAIVoiceTranscriptionApi', () => ({ posAIVoiceTranscriptionApi: m }));
vi.mock('react-router-dom', async (orig) => ({ ...(await (orig() as any)), useParams: () => ({ id: 'tr1' }) }));
import { POSAIVoiceTranscriptionScreen } from './POSAIVoiceTranscriptionScreen';
import { POSAIVoiceTranscriptionHistoryScreen } from './POSAIVoiceTranscriptionHistoryScreen';
import { POSAIVoiceTranscriptionSearchScreen } from './POSAIVoiceTranscriptionSearchScreen';
import { POSAIVoiceTranscriptionDetailScreen } from './POSAIVoiceTranscriptionDetailScreen';
beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe('Overview', () => {
  it('renders KPIs + status breakdown', async () => {
    m.overview.mockResolvedValue({ total: 12, completed: 9, withUnresolved: 2, appointmentsExtracted: 5, byStatus: [{ status: 'completed', count: 9 }, { status: 'consent_declined', count: 1 }], byLanguage: [{ language: 'en', count: 10 }] });
    render(<POSAIVoiceTranscriptionScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Voice Transcription' })).toBeInTheDocument();
    expect(screen.getByText('Appointments Extracted')).toBeInTheDocument();
    expect(screen.getByText('Consent declined')).toBeInTheDocument();
  });
  it('empty state', async () => {
    m.overview.mockResolvedValue({ total: 0, completed: 0, withUnresolved: 0, appointmentsExtracted: 0, byStatus: [], byLanguage: [] });
    render(<POSAIVoiceTranscriptionScreen />);
    expect(await screen.findByText(/No calls transcribed yet/i)).toBeInTheDocument();
  });
});

describe('History', () => {
  it('lists calls with a link to detail', async () => {
    m.list.mockResolvedValue({ items: [{ id: 'tr1', provider: 'retell', providerCallId: 'c1', direction: 'inbound', handler: 'ai', status: 'completed', primaryLanguage: 'en', durationSeconds: 65, segmentCount: 4, createdAt: '2026-07-07T00:00:00Z' }] });
    render(<POSAIVoiceTranscriptionHistoryScreen />);
    expect(await screen.findByText('1:05')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/tenant/ai/voice-transcription/transcripts/tr1');
  });
});

describe('Search', () => {
  it('searches and shows redacted snippets', async () => {
    m.search.mockResolvedValue({ items: [{ header: { id: 'tr1', direction: 'inbound', status: 'completed', createdAt: '2026-07-07T00:00:00Z' }, snippet: '…book a gel manicure…', matchedIn: ['transcript'] }] });
    render(<POSAIVoiceTranscriptionSearchScreen />);
    fireEvent.change(screen.getByLabelText('Search transcripts'), { target: { value: 'manicure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(m.search).toHaveBeenCalledWith({ q: 'manicure' }));
    expect(await screen.findByText(/book a gel manicure/)).toBeInTheDocument();
  });
});

describe('Detail', () => {
  it('renders redacted transcript + intelligence + generates a summary', async () => {
    m.detail.mockResolvedValue({ header: { id: 'tr1', status: 'completed', direction: 'inbound', handler: 'ai', primaryLanguage: 'en', mixedLanguage: false, redactionStatus: 'completed', confidence: 0.9, durationSeconds: 60 }, segments: [{ seq: 0, speakerRole: 'ai_receptionist', text: 'Thanks for calling', startMs: 0 }, { seq: 1, speakerRole: 'customer', text: 'book a gel manicure', startMs: 1 }] });
    m.intelligence.mockResolvedValue({ quickSummary: 'Customer call regarding new booking.', detailedSummary: null, detailedSource: null, intents: [{ intent: 'new_booking' }], appointment: { requestedServices: ['Gel Manicure'], preferredDate: 'saturday' }, unresolved: [] });
    m.generateSummary.mockResolvedValue({ summary: 'Customer wants a gel manicure Saturday.', source: 'ai' });
    render(<POSAIVoiceTranscriptionDetailScreen />);
    expect(await screen.findByText('book a gel manicure')).toBeInTheDocument();
    expect(screen.getByText(/Customer call regarding new booking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate detailed summary' }));
    await waitFor(() => expect(m.generateSummary).toHaveBeenCalledWith('tr1'));
    expect(await screen.findByText(/wants a gel manicure Saturday/)).toBeInTheDocument();
  });
});

import { POSAIVoiceTranscriptionUnresolvedScreen } from './POSAIVoiceTranscriptionUnresolvedScreen';
describe('Follow-ups', () => {
  it('lists calls with open items + priority + link', async () => {
    (m as any).unresolved = (m as any).unresolved || vi.fn();
    (m as any).unresolved.mockResolvedValue({ items: [{ header: { id: 'tr9', direction: 'inbound', status: 'completed', createdAt: '2026-07-07T00:00:00Z' }, quickSummary: 'Customer call regarding complaint.', unresolved: [{ type: 'health_safety', description: 'Possible health or safety concern raised — requires human review.', priority: 'high' }] }] });
    render(<POSAIVoiceTranscriptionUnresolvedScreen />);
    expect(await screen.findByText(/health or safety concern/)).toBeInTheDocument();
    expect(screen.getByText('[High]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open call' })).toHaveAttribute('href', '/tenant/ai/voice-transcription/transcripts/tr9');
  });
});

import { POSAIVoiceTranscriptionSettingsScreen } from './POSAIVoiceTranscriptionSettingsScreen';
describe('Settings', () => {
  it('loads, edits retention, and saves', async () => {
    (m as any).getSettings.mockResolvedValue({ transcriptionEnabled: true, retentionDays: 365, retainRaw: false, consentAnnouncementVersion: 'v1' });
    (m as any).updateSettings.mockResolvedValue({ transcriptionEnabled: true, retentionDays: 90, retainRaw: false, consentAnnouncementVersion: 'v1' });
    render(<POSAIVoiceTranscriptionSettingsScreen />);
    const input = await screen.findByDisplayValue('365');
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect((m as any).updateSettings).toHaveBeenCalledWith(expect.objectContaining({ retentionDays: 90 })));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });
});
