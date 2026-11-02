// PlatformAnnouncementBar — the POS top-bar Platform Announcement (Oct 22 2026 mandate §21–§47, §71–§79, §107–§115,
// §143–§160): renders nothing until the snapshot and nothing when empty, shows the highest priority, offers More for
// several / long messages with the full text in a panel, dismiss / "I understand" are recorded and update in place, a
// non-dismissible notice has no ✕, script text renders as text (never HTML), a failed fetch never breaks the header, a
// realtime signal refetches, and the shared header keeps Search, the clock and the owner controls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const rt = vi.hoisted(() => ({ cb: null as null | ((reason?: string) => unknown) }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: (_k: unknown, cb: (reason?: string) => unknown) => { rt.cb = cb; } }));
vi.mock('../api/posPlatformAnnouncementsApi', () => ({ platformAnnouncementsApi: { active: vi.fn(), dismiss: vi.fn(), acknowledge: vi.fn(), delivered: vi.fn() } }));
import { platformAnnouncementsApi as api } from '../api/posPlatformAnnouncementsApi';
import { PlatformAnnouncementBar } from './PlatformAnnouncementBar';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';

const A = (over: Record<string, unknown> = {}) => ({ id: 'a1', title: null, message: 'Scheduled update tonight 11 PM – 11:15 PM.', titleVi: null, messageVi: null, type: 'update', priority: 'normal', dismissible: true,
  requiresAcknowledgement: false, acknowledged: false, startsAt: null, endsAt: null, version: 2, contentVersion: 1, ...over });
const snap = (announcements: unknown[]) => ({ announcements, serverTime: '2026-10-22T12:00:00.000Z', nextChangeAt: null });
const m = api as any;
beforeEach(() => { vi.clearAllMocks(); m.dismiss.mockResolvedValue({}); m.acknowledge.mockResolvedValue({}); m.delivered.mockResolvedValue({}); m.active.mockResolvedValue(snap([A()])); });

describe('POS top-bar Platform Announcement', () => {
  it('shows nothing before the snapshot and nothing when there is no announcement (§112–§113)', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    m.active.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PlatformAnnouncementBar />);
    expect(screen.queryByTestId('platform-announcement')).toBeNull();
    await act(async () => { resolve(snap([])); });
    expect(screen.queryByTestId('platform-announcement')).toBeNull();
    expect(screen.queryByText(/Loading/i)).toBeNull();
  });
  it('shows the message with its title, records first delivery, and dismisses for this employee (§33, §36, §117)', async () => {
    m.active.mockResolvedValue(snap([A({ title: 'Update' })]));
    render(<PlatformAnnouncementBar />);
    expect(await screen.findByTestId('platform-announcement-text')).toHaveTextContent('Update: Scheduled update tonight 11 PM – 11:15 PM.');
    await waitFor(() => expect(m.delivered).toHaveBeenCalledWith('a1', 1));
    fireEvent.click(screen.getByLabelText('Dismiss announcement'));
    await waitFor(() => expect(m.dismiss).toHaveBeenCalledWith('a1', 1));
    await waitFor(() => expect(screen.queryByTestId('platform-announcement')).toBeNull());
  });
  it('highest priority first; several active → More opens every message in full without leaving the screen (§29, §42)', async () => {
    const long = 'Card payments are slower than usual. '.repeat(12).trim();
    m.active.mockResolvedValue(snap([A({ id: 'c', priority: 'critical', type: 'urgent', dismissible: false, message: long }), A({ id: 'n' })]));
    render(<PlatformAnnouncementBar />);
    expect(await screen.findByTestId('platform-announcement-text')).toHaveTextContent(/^Card payments/);
    expect(screen.queryByLabelText('Dismiss announcement')).toBeNull();                 // §153: not dismissible
    fireEvent.click(screen.getByText('More (+1)'));
    const panel = screen.getByTestId('platform-announcement-panel');
    expect(panel).toHaveTextContent(long);
    expect(panel).toHaveTextContent('Scheduled update tonight');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('platform-announcement-panel')).toBeNull();
  });
  it('"I understand" records the acknowledgement and stays non-blocking (§39–§40)', async () => {
    m.active.mockResolvedValue(snap([A({ requiresAcknowledgement: true, dismissible: false })]));
    render(<PlatformAnnouncementBar />);
    fireEvent.click(await screen.findByText('I understand'));
    await waitFor(() => expect(m.acknowledge).toHaveBeenCalledWith('a1', 1));
    await waitFor(() => expect(screen.queryByText('I understand')).toBeNull());
  });
  it('script / HTML in a message renders as plain text, never as markup (§155)', async () => {
    m.active.mockResolvedValue(snap([A({ message: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>' })]));
    const { container } = render(<PlatformAnnouncementBar />);
    expect(await screen.findByTestId('platform-announcement-text')).toHaveTextContent('<script>');
    expect(container.querySelector('script, img')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });
  it('a failed snapshot never breaks the header; a later realtime signal brings the message (§114, §158–§160)', async () => {
    m.active.mockRejectedValueOnce(new Error('network'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<PlatformAnnouncementBar />);
    await waitFor(() => expect(m.active).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('platform-announcement')).toBeNull();
    m.active.mockResolvedValue(snap([A({ id: 'late', message: 'Published while you were offline.' })]));
    await act(async () => { await rt.cb?.(); });
    expect(await screen.findByText('Published while you were offline.')).toBeInTheDocument();
    warn.mockRestore();
  });
  it('a pause / expiry signal removes it in place — no reload (§148, §150)', async () => {
    render(<PlatformAnnouncementBar />);
    expect(await screen.findByTestId('platform-announcement')).toBeInTheDocument();
    m.active.mockResolvedValue(snap([]));
    await act(async () => { await rt.cb?.(); });
    expect(screen.queryByTestId('platform-announcement')).toBeNull();
  });
});

// English + Vietnamese POS mandate WP-F (§56): the POS shows the Vietnamese version when it is in Vietnamese and one exists,
// otherwise the English; a language switch flips the text in place without asking the server again.
describe('POS top-bar Platform Announcement — language (WP-F)', () => {
  const VI = { titleVi: 'Bảo trì', messageVi: 'Máy quẹt thẻ bảo trì lúc 3 giờ chiều.' };
  it('Vietnamese POS + a Vietnamese version → the Vietnamese text (marked lang="vi"); the full panel too', async () => {
    await setLanguage('vi');
    try {
      m.active.mockResolvedValue(snap([A({ title: 'Maintenance', ...VI }), A({ id: 'a2', message: 'Second notice in English only.' })]));
      render(<PlatformAnnouncementBar />);
      const el = await screen.findByTestId('platform-announcement-text');
      expect(el).toHaveTextContent('Bảo trì: Máy quẹt thẻ bảo trì lúc 3 giờ chiều.');
      expect(el).toHaveAttribute('lang', 'vi');
      expect(el).not.toHaveTextContent('Scheduled update');
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      const panel = screen.getByTestId('platform-announcement-panel');
      expect(panel).toHaveTextContent('Máy quẹt thẻ bảo trì lúc 3 giờ chiều.');
      expect(panel).toHaveTextContent('Second notice in English only.');          // no Vietnamese version → English
    } finally { await setLanguage('en'); }
  });
  it('Vietnamese POS + no Vietnamese version → the English text', async () => {
    await setLanguage('vi');
    try {
      m.active.mockResolvedValue(snap([A({ title: 'Update' })]));
      render(<PlatformAnnouncementBar />);
      const el = await screen.findByTestId('platform-announcement-text');
      expect(el).toHaveTextContent('Update: Scheduled update tonight 11 PM – 11:15 PM.');
      expect(el).toHaveAttribute('lang', 'en');
    } finally { await setLanguage('en'); }
  });
  it('a language switch flips the text in place — no extra snapshot request, no delivery re-record', async () => {
    m.active.mockResolvedValue(snap([A({ title: 'Maintenance', ...VI })]));
    render(<PlatformAnnouncementBar />);
    expect(await screen.findByTestId('platform-announcement-text')).toHaveTextContent('Maintenance: Scheduled update tonight');
    await waitFor(() => expect(m.delivered).toHaveBeenCalledTimes(1));
    const calls = m.active.mock.calls.length;
    await act(async () => { await setLanguage('vi'); });
    expect(screen.getByTestId('platform-announcement-text')).toHaveTextContent('Bảo trì: Máy quẹt thẻ bảo trì lúc 3 giờ chiều.');
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByTestId('platform-announcement-text')).toHaveTextContent('Maintenance: Scheduled update tonight');
    expect(m.active.mock.calls.length).toBe(calls);
    expect(m.delivered).toHaveBeenCalledTimes(1);
  });
});

// Oct 27 2026 — the INTERNAL PARTIAL rows of the Platform Announcement status file: §72 ordering, §116 failure counters,
// §106 dialog + contrast, §34 icon library.
import { TONE, PANEL_BG } from './PlatformAnnouncementBar';
import { setAnnouncementTelemetryForTests, ANNOUNCEMENT_FAILURE_THROTTLE_MS } from './announcement-telemetry';

const deferred = () => { let resolve: (v: unknown) => void = () => undefined; let reject: (e: unknown) => void = () => undefined; const p = new Promise((res, rej) => { resolve = res; reject = rej; }); return { p, resolve, reject }; };

describe('§72 in-flight snapshot ordering', () => {
  it('an older request answering last is dropped — the newer answer stays on screen', async () => {
    const first = deferred(); const second = deferred();
    m.active.mockReturnValueOnce(first.p).mockReturnValueOnce(second.p);
    render(<PlatformAnnouncementBar />);
    await act(async () => { void rt.cb?.(); });                                 // a realtime refetch overlaps the mount load
    await act(async () => { second.resolve(snap([A({ id: 'new', message: 'Newer answer.' })])); });
    expect(await screen.findByText('Newer answer.')).toBeInTheDocument();
    await act(async () => { first.resolve(snap([A({ id: 'old', message: 'Stale answer.' })])); });
    expect(screen.queryByText('Stale answer.')).toBeNull();
    expect(screen.getByText('Newer answer.')).toBeInTheDocument();
  });
  it('an answer whose serverTime is older than the applied one is dropped', async () => {
    m.active.mockResolvedValueOnce({ ...snap([A({ id: 'n', message: 'Taken at 12:00:05.' })]), serverTime: '2026-10-22T12:00:05.000Z' });
    render(<PlatformAnnouncementBar />);
    expect(await screen.findByText('Taken at 12:00:05.')).toBeInTheDocument();
    m.active.mockResolvedValueOnce({ ...snap([A({ id: 'o', message: 'Taken at 12:00:01.' })]), serverTime: '2026-10-22T12:00:01.000Z' });
    await act(async () => { await rt.cb?.(); });
    expect(screen.queryByText('Taken at 12:00:01.')).toBeNull();
  });
  it('a snapshot requested BEFORE a dismiss cannot bring the dismissed notice back', async () => {
    render(<PlatformAnnouncementBar />);
    await screen.findByTestId('platform-announcement');
    const inflight = deferred();
    m.active.mockReturnValueOnce(inflight.p);
    await act(async () => { void rt.cb?.(); });
    fireEvent.click(screen.getByLabelText('Dismiss announcement'));
    await waitFor(() => expect(screen.queryByTestId('platform-announcement')).toBeNull());
    await act(async () => { inflight.resolve(snap([A()])); });
    expect(screen.queryByTestId('platform-announcement')).toBeNull();
  });
});

describe('§116 failures are counted, not console-only', () => {
  it('snapshot / realtime / receipt failures each post one allow-listed event (no text, no ids), throttled per kind', async () => {
    const sent: Array<{ url: string; body: any }> = [];
    let t = 1_000_000;
    setAnnouncementTelemetryForTests({ send: (url, body) => sent.push({ url, body: JSON.parse(body) }), now: () => t });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      m.active.mockRejectedValue(new Error('network'));
      render(<PlatformAnnouncementBar />);
      await waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0].url).toMatch(/\/client-telemetry\/events$/);
      expect(sent[0].body).toEqual({ app: 'pos', version: expect.any(String), platform: 'web', events: [{ name: 'platform_announcement_snapshot_failed', props: {} }], perf: [] });
      await act(async () => { await rt.cb?.('manual'); });                          // a realtime-triggered refetch fails
      expect(sent.map((s) => s.body.events[0].name)).toEqual(['platform_announcement_snapshot_failed', 'platform_announcement_realtime_failed']);
      await act(async () => { await rt.cb?.('interval'); });                        // same kind inside the minute → not re-sent
      expect(sent).toHaveLength(2);
      t += ANNOUNCEMENT_FAILURE_THROTTLE_MS;
      await act(async () => { await rt.cb?.('interval'); });
      expect(sent).toHaveLength(3);
      m.active.mockResolvedValue(snap([A({ message: 'Secret salon text' })]));
      m.delivered.mockRejectedValue(new Error('500'));
      await act(async () => { await rt.cb?.('manual'); });
      await waitFor(() => expect(sent[sent.length - 1].body.events[0].name).toBe('platform_announcement_receipt_failed'));
      expect(JSON.stringify(sent)).not.toContain('Secret salon text');
      expect(warn).toHaveBeenCalled();                                              // still logged too
    } finally { warn.mockRestore(); setAnnouncementTelemetryForTests(null); }
  });
});

describe('§106 accessibility', () => {
  const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  it('every tone pair meets WCAG AA: message text, type icon and type label ≥ 4.5:1 on the bar and on the panel', () => {
    for (const [k, tn] of Object.entries(TONE)) {
      expect(ratio(tn.ink, tn.bg), `${k} ink/bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tn.strong, tn.bg), `${k} icon+label/bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tn.strong, PANEL_BG), `${k} label/panel`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tn.ink, '#FFFFFF'), `${k} "I understand" on white`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('More opens a modal dialog: focus moves in, Tab and Shift+Tab stay inside, Escape returns focus to More', async () => {
    m.active.mockResolvedValue(snap([A({ id: 'x', dismissible: true }), A({ id: 'y', requiresAcknowledgement: true, dismissible: false })]));
    render(<PlatformAnnouncementBar />);
    const more = await screen.findByText('More (+1)');
    fireEvent.click(more);
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    const buttons = [...panel.querySelectorAll('button')];
    await waitFor(() => expect(document.activeElement).toBe(buttons[0]));
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);                               // wraps forward
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);                           // wraps backward
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('More (+1)')));
  });
});

describe('§34 icons come from the POS icon library', () => {
  it('urgent / maintenance / info use react-icons (Fi) — no hand-drawn paths in the component source', async () => {
    m.active.mockResolvedValue(snap([A({ id: 'u', type: 'urgent', priority: 'high' }), A({ id: 'm', type: 'maintenance', priority: 'normal' })]));
    const { container } = render(<PlatformAnnouncementBar />);
    await screen.findByTestId('platform-announcement');
    expect(container.querySelector('[data-testid="platform-announcement"] svg[data-icon="alert"]')).not.toBeNull();
    // the component's own source text (read from disk, as posLayoutGrid.test does — no untyped ?raw import)
    const src: string = readFileSync(join(__dirname, 'PlatformAnnouncementBar.tsx'), 'utf8');
    expect(src).toContain("from 'react-icons/fi'");
    expect(src).not.toMatch(/<path d=|<circle /);
  });
});
