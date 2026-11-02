// OnCallScreen.test — BUILD_PLAN Phase 14 C (Constitution 11 §262–265, §92–95, §114–117, §332): what the On-call screen
// shows, what it sends, and what it refuses to fake.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/onCallApi', () => ({ onCallApi: {
  contacts: vi.fn(), addContact: vi.fn(), updateContact: vi.fn(), removeContact: vi.fn(), alerts: vi.fn(), acknowledge: vi.fn(),
  synthetic: vi.fn(), setSynthetic: vi.fn(), backups: vi.fn(), slos: vi.fn(),
} }));
import { onCallApi } from '../api/onCallApi';
import { OnCallScreen, draftToInput } from './OnCallScreen';

const m = onCallApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const contact = (over: Record<string, unknown> = {}) => ({ id: 'c1', position: 1, role: 'primary', name: 'Kevin', channel: 'sms', destination: '+16095551234', owners: [], quietStart: null, quietEnd: null, timezone: 'America/New_York', active: true, updatedAt: '2026-03-04T14:00:00Z', ...over });
const contacts = (list: unknown[] = [contact()]) => ({ contacts: list, owners: ['platform', 'payments', 'security'], channels: ['email', 'sms', 'push'] });
const alert = (over: Record<string, unknown> = {}) => ({ id: 'a1', title: 'Database is down', severity: 'critical', status: 'unread', owner: 'platform', createdAt: '2026-03-04T14:00:00Z', notifiedAt: '2026-03-04T14:00:00Z', resolvedAt: null, acknowledgedAt: null, acknowledgedVia: null,
  steps: [{ step: 1, contact: 'Kevin', channel: 'sms', outcome: 'sent', notifiedAt: '2026-03-04T14:00:00Z', escalatedAt: null }], ...over });
const synthetic = (over: Record<string, unknown> = {}) => ({ testTenant: null, probes: [
  { probe: 'api_ready', outcome: 'pass', detail: 'http_200', durationMs: 42, consecutiveFailures: 0, ranAt: '2026-03-04T14:00:00Z' },
  { probe: 'kiosk_config', outcome: 'skipped', detail: 'not_configured', durationMs: 0, consecutiveFailures: 0, ranAt: '2026-03-04T14:00:00Z' },
], ...over });
const backups = (over: Record<string, unknown> = {}) => ({ summary: null, evaluation: { status: 'UNKNOWN', reason: 'no_reports', summary: {} }, maxAgeHours: 26, ...over });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.contacts.mockResolvedValue(contacts()); m.alerts.mockResolvedValue({ alerts: [] }); m.synthetic.mockResolvedValue(synthetic()); m.backups.mockResolvedValue(backups());
});

describe('paged alerts', () => {
  it('lists an open alert with the chain it walked, and Acknowledge calls the API then reloads', async () => {
    m.alerts.mockResolvedValueOnce({ alerts: [alert()] }).mockResolvedValue({ alerts: [alert({ status: 'read', acknowledgedAt: '2026-03-04T14:05:00Z', acknowledgedVia: 'screen' })] });
    m.acknowledge.mockResolvedValue({ acknowledged: true });
    render(<OnCallScreen />);
    const row = await screen.findByTestId('alert-a1');
    expect(row).toHaveTextContent(/Database is down[\s\S]*Kevin \(sms\): Sent/);
    fireEvent.click(screen.getByTestId('ack-a1'));
    await waitFor(() => expect(m.acknowledge).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.getByTestId('alert-a1')).toHaveTextContent(/Acknowledged[\s\S]*on this screen/));
    expect(screen.queryByTestId('ack-a1')).toBeNull();
  });
  it('§332 a failed read says so — never "no alerts"', async () => {
    m.alerts.mockRejectedValue(new Error('500'));
    render(<OnCallScreen />);
    expect(await screen.findByTestId('alerts-failed')).toBeTruthy();
    expect(screen.queryByText(/No paged platform alerts/)).toBeNull();
  });
  it('an undeliverable step is named as such, never as sent', async () => {
    m.alerts.mockResolvedValue({ alerts: [alert({ steps: [{ step: 1, contact: 'Kevin', channel: 'push', outcome: 'not_configured', notifiedAt: null, escalatedAt: null }, { step: 2, contact: null, channel: null, outcome: 'chain_exhausted', notifiedAt: null, escalatedAt: null }] })] });
    render(<OnCallScreen />);
    expect(await screen.findByTestId('alert-a1')).toHaveTextContent(/Channel not configured[\s\S]*Nobody left to page/);
  });
});

describe('the on-call chain', () => {
  it('an empty chain is a warning, not an empty table', async () => {
    m.contacts.mockResolvedValue(contacts([]));
    render(<OnCallScreen />);
    expect(await screen.findByTestId('chain-empty')).toHaveTextContent(/Nobody is on call/);
  });
  it('adding a contact needs a reason; with one, the typed body is sent', async () => {
    m.addContact.mockResolvedValue(contacts([contact(), contact({ id: 'c2', position: 2, role: 'secondary', name: 'Ops', channel: 'email', destination: 'ops@example.com' })]));
    render(<OnCallScreen />);
    fireEvent.click(await screen.findByTestId('add-contact'));
    fireEvent.change(screen.getByTestId('f-name'), { target: { value: ' Ops ' } });
    fireEvent.change(screen.getByTestId('f-channel'), { target: { value: 'email' } });
    fireEvent.change(screen.getByTestId('f-destination'), { target: { value: 'ops@example.com' } });
    fireEvent.click(screen.getByTestId('save-contact'));
    expect(await screen.findByTestId('chain-error')).toHaveTextContent(/reason is required/);
    expect(m.addContact).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('f-reason'), { target: { value: 'second line' } });
    fireEvent.click(screen.getByTestId('save-contact'));
    await waitFor(() => expect(m.addContact).toHaveBeenCalledWith(expect.objectContaining({ position: 2, role: 'secondary', name: 'Ops', channel: 'email', destination: 'ops@example.com', reason: 'second line', quietStart: null, quietEnd: null })));
    expect(await screen.findByTestId('contact-c2')).toHaveTextContent('Ops');
  });
  it('a refusal from the API (bad number, step-up declined) is shown, and the form stays open', async () => {
    m.updateContact.mockRejectedValue(new Error('SMS needs an E.164 number like +16095551234.'));
    render(<OnCallScreen />);
    fireEvent.click((await screen.findByTestId('contact-c1')).querySelector('button')!);
    fireEvent.change(screen.getByTestId('f-destination'), { target: { value: '6095551234' } });
    fireEvent.change(screen.getByTestId('f-reason'), { target: { value: 'fix number' } });
    fireEvent.click(screen.getByTestId('save-contact'));
    expect(await screen.findByTestId('chain-error')).toHaveTextContent(/E\.164/);
    expect(m.updateContact).toHaveBeenCalledWith('c1', expect.objectContaining({ destination: '6095551234' }));
    expect(screen.getByTestId('contact-form')).toBeTruthy();
  });
  it('removing needs a reason and sends it', async () => {
    m.removeContact.mockResolvedValue(contacts([]));
    render(<OnCallScreen />);
    fireEvent.click(await screen.findByTestId('remove-c1'));
    fireEvent.click(screen.getByTestId('remove-confirm'));
    expect(m.removeContact).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('remove-reason'), { target: { value: 'left the company' } });
    fireEvent.click(screen.getByTestId('remove-confirm'));
    await waitFor(() => expect(m.removeContact).toHaveBeenCalledWith('c1', 'left the company'));
    expect(await screen.findByTestId('chain-empty')).toBeTruthy();
  });
  it('draftToInput: blank quiet hours are null, text is trimmed', () => {
    expect(draftToInput({ position: '3', role: 'incident_commander', name: ' IC ', channel: 'sms', destination: ' +16095551234 ', owners: ['security'], quietStart: '', quietEnd: '', timezone: ' UTC ', active: true }, ' r ')).toEqual(
      { position: 3, role: 'incident_commander', name: 'IC', channel: 'sms', destination: '+16095551234', owners: ['security'], quietStart: null, quietEnd: null, timezone: 'UTC', active: true, reason: 'r' });
  });
});

describe('synthetic monitoring', () => {
  it('§93 no test salon → says the kiosk probe is not configured; a skipped probe reads Skipped, never Pass', async () => {
    render(<OnCallScreen />);
    expect(await screen.findByTestId('test-salon-none')).toHaveTextContent(/not configured/);
    expect(screen.getByTestId('probe-kiosk_config')).toHaveTextContent(/Skipped[\s\S]*Not configured/);
    expect(screen.getByTestId('probe-kiosk_config')).not.toHaveTextContent(/Pass/);
    expect(screen.getByTestId('probe-api_ready')).toHaveTextContent(/Pass[\s\S]*42 ms/);
  });
  it('designating a test salon sends the id and the reason', async () => {
    m.setSynthetic.mockResolvedValue(synthetic({ testTenant: { id: 't1', name: 'Test Salon', reason: 'probe', updatedAt: '2026-03-04T14:00:00Z' } }));
    render(<OnCallScreen />);
    fireEvent.change(await screen.findByTestId('test-salon-id'), { target: { value: 't1' } });
    fireEvent.change(screen.getByTestId('test-salon-reason'), { target: { value: 'probe' } });
    fireEvent.click(screen.getByTestId('test-salon-set'));
    await waitFor(() => expect(m.setSynthetic).toHaveBeenCalledWith('t1', 'probe'));
    expect(await screen.findByTestId('test-salon')).toHaveTextContent('Test Salon');
  });
});

describe('backups', () => {
  it('never reported → says so (not healthy); the rule names its window', async () => {
    render(<OnCallScreen />);
    expect(await screen.findByTestId('backup-status')).toHaveTextContent('No backup report received yet');
    expect(screen.getByTestId('oncall-backups')).toHaveTextContent(/within 26 hours/);
  });
  it('a failed read says so', async () => {
    m.backups.mockRejectedValue(new Error('500'));
    render(<OnCallScreen />);
    expect(await screen.findByTestId('backups-failed')).toBeTruthy();
  });
});
