// POSAISettingsScreen — AI Receptionist Settings guide (Nov 3 2026): the version and where the values come from, honest that the live
// agent does not read them yet, a save carries the version (a stale save is refused, never overwrites), change history with Restore.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { receptionistSettings: vi.fn(), updateReceptionistSettings: vi.fn(), receptionistSettingsHistory: vi.fn(), receptionistSettingsLastCheck: vi.fn(() => Promise.resolve(null)), approveReceptionistConsent: vi.fn(), checkReceptionistSettings: vi.fn(), aiRecommendations: vi.fn(() => Promise.resolve({ items: [], openCount: 0 })), approveAiRecommendation: vi.fn(), rejectAiRecommendation: vi.fn() } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: api }));
import { POSAISettingsScreen } from './POSAISettingsScreen';

const S = { enabled: true, defaultLanguage: 'en', afterHoursBehavior: 'ai_answers', allowInterruptions: true, silenceTimeoutSeconds: 12, maxCallDurationSeconds: 600, recordingEnabled: false,
  recordingConsentMessage: 'This call may be recorded.', meta: { version: 2, source: 'salon', scope: 'salon', appliedToCalls: false } };
const H = { items: [{ version: 2, settings: { ...S }, before: { silenceTimeoutSeconds: 8 }, changedKeys: ['silenceTimeoutSeconds'], actorName: 'Owner Kim', at: '2026-11-03T15:00:00Z' },
  { version: 1, settings: { ...S, silenceTimeoutSeconds: 8 }, before: null, changedKeys: ['enabled'], actorName: 'Owner Kim', at: '2026-11-02T15:00:00Z' }], total: 2, page: 1, pageSize: 10, totalPages: 1 };
const wrap = () => render(<MemoryRouter><POSAISettingsScreen /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); api.receptionistSettings.mockResolvedValue(S); api.receptionistSettingsHistory.mockResolvedValue(H); });

describe('POSAISettingsScreen', () => {
  it('shows the version and source, and says the live agent does not read these yet', async () => {
    wrap();
    expect(await screen.findByTestId('aist-version')).toHaveTextContent('Version 2 · the salon-wide settings');
    expect(screen.getByTestId('aist-not-applied')).toHaveTextContent('does not read them yet');
    expect(await screen.findAllByTestId('aist-version-row')).toHaveLength(2);
  });
  it('a save carries the version; a 409 says someone else saved and offers Reload — never overwrites', async () => {
    api.updateReceptionistSettings.mockRejectedValue({ status: 409 });
    wrap();
    await screen.findByTestId('aist-version');
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(api.updateReceptionistSettings).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2, silenceTimeoutSeconds: 12 })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else saved');
    fireEvent.click(screen.getByTestId('aist-reload'));
    await waitFor(() => expect(api.receptionistSettings).toHaveBeenCalledTimes(2));
  });
  it('Restore puts an older version back in the form as unsaved changes', async () => {
    wrap();
    fireEvent.click((await screen.findAllByTestId('aist-restore'))[0]);
    expect(screen.getByTestId('aist-dirty')).toBeInTheDocument();
    expect((screen.getByDisplayValue('8') as HTMLInputElement).value).toBe('8');
  });
});
