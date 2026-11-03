import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ overview: vi.fn(), list: vi.fn(), detail: vi.fn(), intelligence: vi.fn(), generateSummary: vi.fn(), search: vi.fn(), unresolved: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn() }));
const c = vi.hoisted(() => ({ summary: vi.fn(), records: vi.fn(), check: vi.fn() }));   // the settings page's read side (guide, Nov 2026)
vi.mock('../api/posAIVoiceTranscriptionApi', () => ({ posAIVoiceTranscriptionApi: { ...m, center: c } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await (orig() as any)), useParams: () => ({ id: 'tr1' }) }));
import { POSAIVoiceTranscriptionScreen } from './POSAIVoiceTranscriptionScreen';
import { POSAIVoiceTranscriptionHistoryScreen } from './POSAIVoiceTranscriptionHistoryScreen';
import { POSAIVoiceTranscriptionSearchScreen } from './POSAIVoiceTranscriptionSearchScreen';
import { POSAIVoiceTranscriptionDetailScreen } from './POSAIVoiceTranscriptionDetailScreen';
beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); Object.values(c).forEach((f) => f.mockReset()); });

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
import { MemoryRouter } from 'react-router-dom';
import { within, act } from '@testing-library/react';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
// Voice Transcription Settings guide (Nov 2 2026): changed fields + version; sensitive changes confirmed with their impact;
// a stale save explained; the status row from real rows; Records; the read-only check.
const saved = { transcriptionEnabled: true, retentionDays: 365, retainRaw: false, consentAnnouncementVersion: 'v1', version: 3, updatedAt: '2026-11-01T10:00:00Z', saved: true };
const summary = { entitled: true, settings: saved, transcription: { state: 'on', lastProcessedAt: '2026-11-02T13:00:00Z', last30d: { calls: 40, transcribed: 35, consentBlocked: 3, policyOff: 0, failed: 2 } },
  redaction: { mandatory: true, stuck: 0, failed: 0 }, raw: { retain: false, stored: 0 },
  retention: { days: 365, overdue: 2, nextDueAt: '2026-12-01T00:00:00Z', legalHolds: 1, lastDeletionAt: '2026-11-01T03:00:00Z', deleted30d: 5, providerUnconfirmed30d: 1, sweepArmedHere: false },
  consent: { configured: 'v1', used30d: [{ version: 'v1', calls: 30 }, { version: 'v0', calls: 4 }], mismatched30d: 4 }, lastCheck: null };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } });
const renderSettings = () => render(<MemoryRouter><POSAIVoiceTranscriptionSettingsScreen /></MemoryRouter>);
const conflict = (code: string, impact?: any) => Object.assign(new Error(code), { status: 409, code, details: impact ? { impact } : {} });
describe('Settings', () => {
  beforeEach(() => {
    (m as any).getSettings.mockResolvedValue(saved);
    c.summary.mockResolvedValue(summary);
    c.records.mockResolvedValue(page([{ kind: 'settings', id: 'h1', at: '2026-11-01T10:00:00Z', what: 'retentionDays', actor: 'Manager Lan', role: 'MANAGER', changes: [{ key: 'retentionDays', before: 730, after: 365 }] },
      { kind: 'deletion', id: 'd1', at: '2026-11-01T03:00:00Z', what: 'retention_expired', actor: 'system:retention', role: null, transcriptId: '12345678-1', providerConfirmed: false, changes: [] }]));
    c.check.mockResolvedValue({ id: 'h', overall: 'FAILED', reused: false, checkedAt: '2026-11-02T14:00:00Z', checks: [{ key: 'retention_sweep', state: 'FAILED', count: 2 }, { key: 'no_side_effects', state: 'PASSED' }] });
  });
  it('a non-sensitive save sends only the changed field + the version it read', async () => {
    (m as any).updateSettings.mockResolvedValue({ ...saved, retentionDays: 400, version: 4 });
    renderSettings();
    fireEvent.change(await screen.findByDisplayValue('365'), { target: { value: '400' } });
    expect(screen.getByTestId('vsx-unsaved').textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect((m as any).updateSettings).toHaveBeenCalledWith({ retentionDays: 400, expectedVersion: 3 }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });
  it('a shorter window asks first with its impact, then resends with confirm', async () => {
    (m as any).updateSettings.mockRejectedValueOnce(conflict('VT_CONFIRM_REQUIRED', { sensitive: ['retention_shortened'], transcripts: 120, dueNow: 30, rawToPurge: 0 }))
      .mockResolvedValueOnce({ ...saved, retentionDays: 90, version: 4 });
    renderSettings();
    fireEvent.change(await screen.findByDisplayValue('365'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const d = await screen.findByTestId('vsx-confirm');
    expect(within(d).getByTestId('vsx-impact').textContent).toContain('120 stored calls');
    expect(within(d).getByTestId('vsx-impact').textContent).toContain('30 are already past it');
    fireEvent.click(within(d).getByTestId('vsx-confirm-yes'));
    await waitFor(() => expect((m as any).updateSettings).toHaveBeenLastCalledWith({ retentionDays: 90, expectedVersion: 3, confirm: true }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });
  it('a stale save is explained and the latest values are loaded', async () => {
    (m as any).updateSettings.mockRejectedValueOnce(conflict('VT_SETTINGS_VERSION_CONFLICT'));
    renderSettings();
    fireEvent.change(await screen.findByDisplayValue('v1'), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Someone else saved these settings/)).toBeInTheDocument();
    await waitFor(() => expect((m as any).getSettings).toHaveBeenCalledTimes(2));
  });
  it('status row and Records come from the server; the check is read-only', async () => {
    renderSettings();
    expect(await screen.findByTestId('vsx-kpi-retention')).toHaveTextContent('2 past their deletion date');
    expect(screen.getByTestId('vsx-consent').textContent).toContain('4 calls played a version other than v1');
    const rows = await within(screen.getByTestId('vsx-records')).findAllByTestId('vsx-row');
    expect(rows[0].textContent).toContain('Retention window: 730 days → 365 days');
    expect(rows[1].textContent).toContain('Not confirmed by the provider');
    expect(rows[1].textContent).toContain('Automatic');
    fireEvent.change(screen.getByTestId('vsx-kind'), { target: { value: 'raw_access' } });
    await waitFor(() => expect(c.records).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'raw_access', page: 1 })));
    fireEvent.click(screen.getByTestId('vsx-check'));
    expect(await screen.findByTestId('vsx-chk-retention_sweep')).toHaveTextContent('Failed');
    expect((m as any).updateSettings).not.toHaveBeenCalled();
  });
  it('is Vietnamese end to end', async () => {
    await setLanguage('vi');
    try {
      const { container } = renderSettings();
      await within(await screen.findByTestId('vsx-records')).findAllByTestId('vsx-row');
      await screen.findByTestId('vsx-kpis');
      expect(leftoverEnglish(container, ['v1', 'v0', 'Manager Lan', 'MANAGER']).join(' | ')).toBe('');
    } finally { await act(async () => { await setLanguage('en'); }); }
  });
});
