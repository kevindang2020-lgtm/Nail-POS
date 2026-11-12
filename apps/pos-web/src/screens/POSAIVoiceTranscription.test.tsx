import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
const m = vi.hoisted(() => ({ overview: vi.fn(), detail: vi.fn(), intelligence: vi.fn(), generateSummary: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn() }));
const c = vi.hoisted(() => ({ summary: vi.fn(), records: vi.fn(), check: vi.fn() }));   // the settings page's read side (guide, Nov 2026)
// Voice Transcription Follow-Ups guide (Nov 2026): the review queue (replaces GET unresolved — the client method is gone)
const fu = vi.hoisted(() => ({ summary: vi.fn(), items: vi.fn(), history: vi.fn(), task: vi.fn(), dismiss: vi.fn(), reopen: vi.fn(), check: vi.fn() }));
const staff = vi.hoisted(() => ({ staff: vi.fn() }));
// Search + Call History guides (Nov 3 2026): one calls center — the old list / search client methods are gone
const vc = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn(), detail: vi.fn(), check: vi.fn() }));
vi.mock('../api/posAIVoiceTranscriptionApi', () => ({ posAIVoiceTranscriptionApi: { ...m, center: c, followUps: fu, calls: vc } }));
vi.mock('../api/posAiFollowUpsApi', () => ({ posAiFollowUpsApi: staff }));
const perm = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perm.deny.has(p) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await (orig() as any)), useParams: () => ({ id: 'tr1' }) }));
import { POSAIVoiceTranscriptionScreen } from './POSAIVoiceTranscriptionScreen';
import { POSAIVoiceTranscriptionHistoryScreen } from './POSAIVoiceTranscriptionHistoryScreen';
import { POSAIVoiceTranscriptionSearchScreen } from './POSAIVoiceTranscriptionSearchScreen';
import { POSAIVoiceTranscriptionDetailScreen } from './POSAIVoiceTranscriptionDetailScreen';
beforeEach(() => { for (const g of [m, c, fu, staff, vc] as Record<string, any>[]) Object.values(g).forEach((f: any) => f.mockReset()); });

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

const vcSum = (o: any = {}) => ({ counters: { calls: 3, calls7d: 2, processing: 0, failed7d: 0, notTranscribed: 0 }, emptyReason: null, customersVisible: true, ...o });
const vcRow = (o: any = {}) => ({ id: 'tr1', callRef: 'c1', callAt: '2026-11-02T15:00:00Z', direction: 'inbound', durationSeconds: 65, statusGroup: 'completed', hasSummary: true,
  customer: 'Linh Pham', customerLinked: true, phoneLast4: '0142', matchType: null, excerpt: null, intents: ['new_booking'], followUp: { state: 'open', open: 1, inTask: 0, items: 1 }, ...o });
const vcPage = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });
const wrap = (el: any) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('Call History', () => {
  it('SUNMI: Call History has the eight cards, Search the four; cards filter the list', async () => {
    const full = { calls: 12, calls7d: 5, processing: 2, failed7d: 1, notTranscribed: 3, inbound: 9, outbound: 3, missed: 4, transcribed: 6, failed: 1, followUpsOpen: 2 };
    vc.summary.mockResolvedValue(vcSum({ counters: full })); vc.list.mockResolvedValue(vcPage([vcRow()]));
    const h = wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('vcx-kpi-missed')).toHaveTextContent('4'));
    expect(screen.getByTestId('vcx-kpis').children).toHaveLength(8);
    expect(screen.getByTestId('vcx-kpi-calls')).toHaveTextContent(/Total calls.*12.*5 in the last 7 days/);
    expect(screen.getByTestId('vcx-kpi-inbound')).toHaveTextContent('9'); expect(screen.getByTestId('vcx-kpi-outbound')).toHaveTextContent('3');
    expect(screen.getByTestId('vcx-kpi-transcribed')).toHaveTextContent(/Completed transcriptions.*6.*3 not transcribed/);
    expect(screen.getByTestId('vcx-kpi-followups')).toHaveTextContent('2');
    fireEvent.click(screen.getByTestId('vcx-kpi-outbound'));
    await waitFor(() => expect(vc.list).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'outbound' })));
    h.unmount();
    wrap(<POSAIVoiceTranscriptionSearchScreen />);
    await waitFor(() => expect(screen.getByTestId('vcx-kpi-pending')).toHaveTextContent(/3.*2 processing · 1 failed/));
    expect(screen.getByTestId('vcx-kpis').children).toHaveLength(4);
    expect(screen.queryByTestId('vcx-kpi-missed')).toBeNull();
  });
  it('lists calls newest first from the start, with customer, status, follow-up; no old list call', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([vcRow()]));
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    const row = await screen.findByTestId('vcx-row');
    expect(row).toHaveTextContent('Linh Pham'); expect(row).toHaveTextContent('•••0142'); expect(row).toHaveTextContent('Transcribed');
    expect(row).toHaveTextContent('Book'); expect(row).toHaveTextContent('Open');
    expect(vc.list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest', page: 1, pageSize: 25 }));
    expect(screen.getByRole('heading', { name: 'Voice Transcription · Call History' })).toBeInTheDocument();
    // the old list / search (no pages, the browser's branch) are retired from the client
    const actual = await vi.importActual<any>('../api/posAIVoiceTranscriptionApi');
    expect(actual.posAIVoiceTranscriptionApi.search).toBeUndefined();
    expect(actual.posAIVoiceTranscriptionApi.list).toBeUndefined();
    expect(typeof actual.posAIVoiceTranscriptionApi.calls.list).toBe('function');
  });
  it('an empty history says WHY: no calls is not "nothing matches"; a filter that matches nothing says so', async () => {
    vc.summary.mockResolvedValue(vcSum({ counters: { calls: 0, calls7d: 0, processing: 0, failed7d: 0, notTranscribed: 0 }, emptyReason: 'no_calls' })); vc.list.mockResolvedValue(vcPage([]));
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    expect(await screen.findByText(/No calls have been transcribed yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('vcx-direction'), { target: { value: 'outbound' } });
    expect(await screen.findByText('No calls match this search or these filters.')).toBeInTheDocument();
  });
  it('filters, presets, rows and pages reach the server; Status and Direction are still there', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([vcRow()], { total: 60, totalPages: 3 }));
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    await screen.findByTestId('vcx-row');
    fireEvent.change(screen.getByTestId('vcx-status'), { target: { value: 'failed' } });
    fireEvent.change(screen.getByTestId('vcx-intent'), { target: { value: 'refund' } });
    fireEvent.click(screen.getByTestId('vcx-preset-last_30'));
    await waitFor(() => expect(vc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', intent: 'refund', preset: 'last_30', page: 1 })));
    fireEvent.change(screen.getByTestId('vcx-rows'), { target: { value: '50' } });
    await waitFor(() => expect(vc.list).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));
  });
  it('View opens the details overlay: redacted lines with speakers, the request marked "not a booking", follow-ups; Close keeps the list', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([vcRow()]));
    vc.detail.mockResolvedValue({ call: { id: 'tr1', callRef: 'c1', callAt: '2026-11-02T15:00:00Z', direction: 'inbound', durationSeconds: 65, statusGroup: 'completed', language: 'en', branch: 'Main' },
      customer: { linked: true, id: 'cu1', name: 'Linh Pham', phoneLast4: '0142', visible: true },
      transcript: [{ seq: 1, speaker: 'customer', text: 'Can I book a gel manicure Saturday?', uncertain: false }, { seq: 2, speaker: 'ai_receptionist', text: 'Let me check.', uncertain: true }],
      summary: { quick: 'Wants a gel manicure Saturday', detailed: null, generatedAt: '2026-11-02T15:01:00Z' }, intents: [],
      request: { services: ['gel manicure'], date: 'Saturday', time: null, technician: null, state: 'requested_unverified' },
      followUps: [{ type: 'callback_requested', state: 'open', taskId: null }], canWorkFollowUps: true });
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(await screen.findByTestId('vcx-view'));
    const lines = await screen.findAllByTestId('vcx-line');
    expect(vc.detail).toHaveBeenCalledWith('tr1');
    expect(lines[0]).toHaveTextContent('Customer'); expect(lines[1]).toHaveTextContent('unclear speech');
    expect(screen.getByTestId('vcx-call-request')).toHaveTextContent('not a booking');
    expect(screen.getByTestId('vcx-call-follow')).toHaveTextContent('Callback requested');
    fireEvent.click(screen.getByTestId('vcx-call-close'));
    expect(screen.queryByTestId('vcx-call')).toBeNull();
    expect(screen.getByTestId('vcx-row')).toBeInTheDocument();
  });
  it('Extras VCH-05: the booking outcome comes from Booking records (date, time, status, when made); the agent report is labelled; none booked says the request is not a booking', async () => {
    const base = { call: { id: 'tr1', callRef: 'c1', callAt: '2026-11-02T15:00:00Z', direction: 'inbound', durationSeconds: 65, statusGroup: 'completed', language: 'en', branch: 'Main' },
      customer: { linked: true, id: 'cu1', name: 'Linh Pham', phoneLast4: '0142', visible: true }, transcript: [], summary: null, intents: [],
      request: { services: ['gel manicure'], date: 'Saturday', time: null, technician: null, state: 'requested_unverified' }, followUps: [], canWorkFollowUps: false };
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([vcRow()]));
    vc.detail.mockResolvedValueOnce({ ...base, booking: { basis: 'same_customer_within_24h', providerReported: 'booked', appointments: [{ id: 'a1', date: '2026-11-08', startTime: '10:00', status: 'confirmed', source: 'phone', createdAt: '2026-11-02T15:20:00Z' }] } })
      .mockResolvedValueOnce({ ...base, booking: { basis: 'same_customer_within_24h', providerReported: null, appointments: [] } })
      .mockResolvedValueOnce({ ...base, booking: { basis: 'no_linked_customer', providerReported: null, appointments: [] } });
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(await screen.findByTestId('vcx-view'));
    const appt = await screen.findByTestId('vcx-booking-appt');
    expect(appt).toHaveTextContent('2026-11-08 10:00'); expect(appt).toHaveTextContent('Confirmed'); expect(appt).toHaveTextContent('booking record made');
    expect(screen.getByTestId('vcx-call-booking')).toHaveTextContent('matched by customer and time, not by a call id');
    expect(screen.getByTestId('vcx-booking-reported')).toHaveTextContent('The voice agent reported: Booked (provider report, not a booking record)');
    fireEvent.click(screen.getByTestId('vcx-call-close'));
    fireEvent.click(await screen.findByTestId('vcx-view'));
    expect(await screen.findByTestId('vcx-booking-none')).toHaveTextContent('The request above is not a booking');
    expect(screen.queryByTestId('vcx-booking-reported')).toBeNull();
    fireEvent.click(screen.getByTestId('vcx-call-close'));
    fireEvent.click(await screen.findByTestId('vcx-view'));
    expect(await screen.findByTestId('vcx-booking-basis')).toHaveTextContent('not linked to a customer');
  });
  it('Extras VCH-08: Call History states this month\'s usage from the server and never a price', async () => {
    vc.summary.mockResolvedValue(vcSum({ usage: { from: '2026-11-01', to: '2026-11-12', timeZone: 'America/New_York', transcribedCalls: 12, transcribedMinutes: 37.5, aiSummaries: 9, fallbackSummaries: 3, failedJobs: 1,
      retries: null, retriesRecorded: false, subscription: { status: 'trialing', billing: 'trial' }, price: null } }));
    vc.list.mockResolvedValue(vcPage([vcRow()]));
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    const u = await screen.findByTestId('vcx-usage');
    expect(u).toHaveTextContent('This month (2026-11-01 – 2026-11-12): 12 calls transcribed, 37.5 minutes, 9 AI summaries (3 rules-only), 1 failed transcriptions');
    expect(u).toHaveTextContent('package: on trial');
    expect(u).toHaveTextContent('No price is shown here');
    expect(u).toHaveTextContent('Retries are not recorded.');
    expect(u.textContent).not.toMatch(/\$/);
  });
  it('Extras VCH-04: the server\'s transcript-quality flags show with their evidence and an advisory note; no flags → no section', async () => {
    const base = { call: { id: 'tr1', callRef: 'c1', callAt: '2026-11-02T15:00:00Z', direction: 'inbound', durationSeconds: 120, statusGroup: 'completed', language: 'en', branch: 'Main' },
      customer: { linked: false, id: null, name: null, phoneLast4: null, visible: true }, transcript: [{ seq: 1, speaker: 'unknown', text: 'Hola', uncertain: true }], summary: null, intents: [], request: null, followUps: [], canWorkFollowUps: false };
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([vcRow()]));
    vc.detail.mockResolvedValueOnce({ ...base, quality: { advisory: true, flags: [
      { code: 'speaker_attribution', evidence: { unattributedSegments: 1, totalSegments: 2 } },
      { code: 'mixed_language', evidence: { languages: ['en', 'es'], languageConfidence: 0.55, providerMarkedMixed: false } },
      { code: 'incomplete_recording', evidence: { status: 'completed', expectedSegments: 3, storedSegments: 2, coveredSeconds: 30, durationSeconds: 120 } },
      { code: 'uncertain_booking_intent', evidence: { requestConfidence: 0.6, bookingIntentConfidence: null } }] } })
      .mockResolvedValueOnce({ ...base, quality: { advisory: true, flags: [] } });
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(await screen.findByTestId('vcx-view'));
    const box = await screen.findByTestId('vcx-call-quality');
    expect(screen.getByTestId('vcx-q-speaker_attribution')).toHaveTextContent('Speaker unclear');
    expect(screen.getByTestId('vcx-q-speaker_attribution')).toHaveTextContent('1 of 2 lines have no identified speaker.');
    expect(screen.getByTestId('vcx-q-mixed_language')).toHaveTextContent('Languages heard: en, es; language confidence 55%.');
    expect(screen.getByTestId('vcx-q-incomplete_recording')).toHaveTextContent('2 of 3 lines stored; words cover 30s of a 120s call.');
    expect(screen.getByTestId('vcx-q-uncertain_booking_intent')).toHaveTextContent('Request confidence 60%; booking intent confidence —.');
    expect(box).toHaveTextContent('nothing was changed');
    expect(screen.getAllByTestId('vcx-line')[0]).toHaveTextContent('Hola');
    fireEvent.click(screen.getByTestId('vcx-call-close'));
    fireEvent.click(await screen.findByTestId('vcx-view'));
    await screen.findAllByTestId('vcx-line');
    expect(screen.queryByTestId('vcx-call-quality')).toBeNull();
  });
  it('Check Voice Transcription System: every check with its part and last pass; a failed request is an error, never a pass', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([]));
    vc.check.mockResolvedValueOnce({ overall: 'FAILED', checkedAt: '2026-11-03T05:00:00Z', reused: false, checks: [{ key: 'no_card_numbers_searchable', component: 'privacy', state: 'FAILED', count: 1, lastPassedAt: null },
      { key: 'calls_arriving', component: 'ingestion', state: 'PASSED', lastPassedAt: '2026-11-03T05:00:00Z' }] }).mockRejectedValueOnce({ status: 403 });
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(screen.getByTestId('vcx-check'));
    const k = await screen.findByTestId('vcx-chk-no_card_numbers_searchable');
    expect(k).toHaveTextContent('Failed'); expect(k).toHaveTextContent('Part: Privacy'); expect(k).toHaveTextContent('Has not passed yet');
    expect(screen.getByTestId('vcx-chk-calls_arriving')).toHaveTextContent('Last passed:');
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByTestId('vcx-check'));
    expect(await screen.findByText(/cannot view call transcripts/)).toBeInTheDocument();
  });
});

describe('Voice Call History 07 — safe configuration help', () => {
  it('provider not connected: the exact next step, the permission it needs, a link only with that permission, never a key', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockResolvedValue(vcPage([]));
    const res = { overall: 'WARNING', checkedAt: '2026-11-03T05:00:00Z', reused: false, checks: [{ key: 'provider_connection', component: 'provider', state: 'WARNING', count: 0, lastPassedAt: null },
      { key: 'calls_arriving', component: 'ingestion', state: 'PASSED', lastPassedAt: '2026-11-03T05:00:00Z' }] };
    vc.check.mockResolvedValue(res);
    const { unmount } = wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(screen.getByTestId('vcx-check'));
    const help = await screen.findByTestId('vcx-provider-help');
    expect(help).toHaveTextContent('Needs the permission: ai.use');
    expect(help).toHaveTextContent('ask the platform administrator to issue a voice integration key');
    expect(screen.getByTestId('vcx-provider-link').getAttribute('href')).toBe('/tenant/ai/receptionist');
    expect(help.textContent).not.toMatch(/vk_|token|secret/i);
    expect(within(screen.getByTestId('vcx-chk-calls_arriving')).queryByTestId('vcx-provider-help')).toBeNull();   // only where it applies
    unmount();
    perm.deny.add('ai.use');
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    fireEvent.click(screen.getByTestId('vcx-check'));
    expect(await screen.findByTestId('vcx-provider-noaccess')).toHaveTextContent('ask the salon owner');
    expect(screen.queryByTestId('vcx-provider-link')).toBeNull();
    perm.deny.clear();
  });
});

describe('Search', () => {
  it('keeps the original first state; searches redacted text and shows what matched + the excerpt', async () => {
    vc.summary.mockResolvedValue(vcSum());
    vc.list.mockResolvedValue(vcPage([vcRow({ matchType: 'transcript', excerpt: '…book a gel manicure…' })]));
    wrap(<POSAIVoiceTranscriptionSearchScreen />);
    expect(screen.getByTestId('vcx-not-started')).toHaveTextContent('Enter a search term to find calls.');
    expect(vc.list).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Search transcripts'), { target: { value: 'manicure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(vc.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'manicure', sort: 'best' })));
    expect(await screen.findByTestId('vcx-excerpt')).toHaveTextContent('book a gel manicure');
    expect(screen.getByTestId('vcx-row')).toHaveTextContent('Transcript');
  });
  it('a refused range shows the guide text', async () => {
    vc.summary.mockResolvedValue(vcSum()); vc.list.mockRejectedValue({ status: 400, code: 'VC_INVALID_PERIOD' });
    wrap(<POSAIVoiceTranscriptionHistoryScreen />);
    expect(await screen.findByText(/From date must be on or before the To date/)).toBeInTheDocument();
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
const fuSum = (o: any = {}) => ({ counters: { open: 2, urgent: 1, inTask: 1, overdue: 0, resolved30d: 3 }, pipeline: { calls: 12, processing: 0, errors24h: 0 }, emptyReason: null,
  urgent: [{ transcriptId: 'tr9', type: 'health_safety', priority: 'urgent', callAt: '2026-11-02T13:00:00Z' }], canWork: true, ...o });
const fuRow = (o: any = {}) => ({ transcriptId: 'tr9', type: 'health_safety', priority: 'urgent', state: 'open', callAt: '2026-11-02T13:00:00Z', customer: 'Linh Pham', customerPhoneLast4: '0142', customerLinked: true, review: null, task: null, ...o });
const fuPage = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' }, customersVisible: true });
const renderFu = () => render(<MemoryRouter><POSAIVoiceTranscriptionUnresolvedScreen /></MemoryRouter>);
describe('Follow-ups', () => {
  beforeEach(() => { fu.summary.mockResolvedValue(fuSum()); fu.items.mockResolvedValue(fuPage([fuRow(), fuRow({ transcriptId: 'tr8', type: 'callback_requested', priority: 'high', state: 'in_task', task: { id: 'f1', status: 'assigned', dueAt: null, assignee: 'Desk Mai', overdue: false } })])); staff.staff.mockResolvedValue({ items: [{ id: 'u2', name: 'Desk Mai', role: 'FRONT_DESK' }] }); });
  it('counters, the urgent lane and the review queue with a link to the call', async () => {
    renderFu();
    expect(await screen.findByTestId('vfx-kpi-urgent')).toHaveTextContent('1');
    expect(within(await screen.findByTestId('vfx-urgent')).getByText('Health or safety concern')).toBeInTheDocument();
    const rows = await screen.findAllByTestId('vfx-row');
    expect(rows[0]).toHaveTextContent('Linh Pham');
    expect(within(rows[0]).getByRole('link', { name: 'View call' })).toHaveAttribute('href', '/tenant/ai/voice-transcription/transcripts/tr9');
    expect(rows[1]).toHaveTextContent('Task: assigned · Desk Mai');
    expect(fu.items).toHaveBeenCalledWith(expect.objectContaining({ tab: 'open', sort: 'newest', page: 1 }));
    // GET unresolved is retired from the client (the review queue replaces it)
    const actual = await vi.importActual<any>('../api/posAIVoiceTranscriptionApi');
    expect(actual.posAIVoiceTranscriptionApi.unresolved).toBeUndefined();
  });
  it('Create task sends the item, priority, due and assignee — nothing else; Dismiss needs a reason', async () => {
    fu.task.mockResolvedValue({ followUpId: 'f9', linked: false });
    fu.dismiss.mockResolvedValue({ ok: true });
    renderFu();
    const row = (await screen.findAllByTestId('vfx-row'))[0];
    fireEvent.click(within(row).getByTestId('vfx-act-task'));
    const d = await screen.findByTestId('vfx-task');
    fireEvent.change(within(d).getByTestId('vfx-task-due'), { target: { value: '2026-11-03T10:00' } });
    await waitFor(() => expect(within(d).getByTestId('vfx-task-assignee').querySelectorAll('option').length).toBe(2));
    fireEvent.change(within(d).getByTestId('vfx-task-assignee'), { target: { value: 'u2' } });
    fireEvent.click(within(d).getByTestId('vfx-task-save'));
    await waitFor(() => expect(fu.task).toHaveBeenCalledWith({ transcriptId: 'tr9', type: 'health_safety', priority: 'urgent', dueLocal: '2026-11-03T10:00', assignedUserId: 'u2', note: null }));
    expect(await screen.findByText('Task created on the task board.')).toBeInTheDocument();
    fireEvent.click(within((await screen.findAllByTestId('vfx-row'))[0]).getByTestId('vfx-act-dismiss'));
    const dd = await screen.findByTestId('vfx-dismiss');
    expect(within(dd).getByTestId('vfx-dismiss-save')).toBeDisabled();
    fireEvent.change(within(dd).getByTestId('vfx-dismiss-reason'), { target: { value: 'customer already rebooked' } });
    fireEvent.click(within(dd).getByTestId('vfx-dismiss-save'));
    await waitFor(() => expect(fu.dismiss).toHaveBeenCalledWith({ transcriptId: 'tr9', type: 'health_safety', reason: 'customer already rebooked' }));
  });
  it('an empty list says WHY: no calls is not "every call is resolved"', async () => {
    fu.summary.mockResolvedValue(fuSum({ counters: { open: 0, urgent: 0, inTask: 0, overdue: 0, resolved30d: 0 }, urgent: [], emptyReason: 'no_calls' }));
    fu.items.mockResolvedValue(fuPage([]));
    renderFu();
    expect(await screen.findByText(/No transcribed calls yet/)).toBeInTheDocument();
    expect(screen.queryByText(/every flagged call has been handled/)).toBeNull();
  });
  it('tabs, search and the read-only check', async () => {
    fu.check.mockResolvedValue({ id: 'h', overall: 'FAILED', reused: false, checkedAt: '2026-11-02T14:00:00Z', checks: [{ key: 'urgent_reviewed', state: 'FAILED', count: 1 }] });
    renderFu();
    await screen.findAllByTestId('vfx-row');
    fireEvent.click(screen.getByTestId('vfx-tab-resolved'));
    await waitFor(() => expect(fu.items).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'resolved', page: 1 })));
    fireEvent.change(screen.getByTestId('vfx-search'), { target: { value: '0142' } });
    fireEvent.submit(screen.getByTestId('vfx-search').closest('form')!);
    await waitFor(() => expect(fu.items).toHaveBeenLastCalledWith(expect.objectContaining({ q: '0142' })));
    fireEvent.click(screen.getByTestId('vfx-check'));
    expect(await screen.findByTestId('vfx-chk-urgent_reviewed')).toHaveTextContent('Failed');
  });
  it('is Vietnamese', async () => {
    await setLanguage('vi');
    try {
      const { container } = renderFu();
      await screen.findAllByTestId('vfx-row'); await screen.findByTestId('vfx-urgent');
      expect(leftoverEnglish(container, ['Linh Pham', 'Desk Mai']).join(' | ')).toBe('');
    } finally { await act(async () => { await setLanguage('en'); }); }
  });
});

import { POSAIVoiceTranscriptionSettingsScreen } from './POSAIVoiceTranscriptionSettingsScreen';
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
  it('SUNMI: no subscription is labelled as such (not "no access"); the saved policy shows read-only, records and the check stay reachable', async () => {
    (m as any).getSettings.mockRejectedValue(Object.assign(new Error('AI_VOICE_TRANSCRIPTION_DISABLED'), { status: 403, code: 'PERMISSION_DENIED', body: { message: 'AI_VOICE_TRANSCRIPTION_DISABLED' } }));
    c.summary.mockResolvedValue({ ...summary, entitled: false, transcription: { ...summary.transcription, state: 'subscription_restricted' } });
    renderSettings();
    expect(await screen.findByTestId('vsx-entitlement')).toBeTruthy();
    expect(screen.getByTestId('vsx-plans').getAttribute('href')).toBe('/tenant/ai/plans');
    expect(screen.queryByText(/do not have access/i)).toBeNull();
    expect((screen.getByTestId('vsx-form') as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByTestId('vsx-check')).toBeTruthy();
    await waitFor(() => expect(c.records).toHaveBeenCalled());
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
