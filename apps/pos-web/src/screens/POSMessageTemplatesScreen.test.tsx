// POSMessageTemplatesScreen.test — Message Templates & Automation Center (740). The screen keeps the original New Template form
// (Name, Channel, Message, Create) on the real store, shows the server's numbers, never sends from Create / Save / Preview,
// and shows the permission notice on a 403 (the old .403 test is folded in here).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn(), create: vi.fn(), preview: vi.fn(), usage: vi.fn(), connections: vi.fn(), testSend: vi.fn(), health: vi.fn() }));
vi.mock('../api/posMessageTemplatesApi', () => ({ posMessageTemplatesApi: { ...m, detail: vi.fn(), update: vi.fn(), duplicate: vi.fn(), setStatus: vi.fn(), bind: vi.fn(), unbind: vi.fn() } }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { POSMessageTemplatesScreen } from './POSMessageTemplatesScreen';
import { posMessageTemplatesApi as realApi } from '../api/posMessageTemplatesApi';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-31' };
const summary = { kpis: { total: 1, active: 1, sms: 1, email: 0, archived: 0, drafts: 0, inactive: 0, usedThisMonthMessages: 3, usedThisMonthTemplates: 1 }, month: { from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York' }, checkedAt: '2026-10-31T12:00:00Z',
  categories: [{ key: 'appointment_reminder', messageClass: 'transactional' }, { key: 'general', messageClass: 'conversational' }],
  variables: [{ token: 'customer_first_name', group: 'customer', label: 'Customer first name', source: 'customers.first_name', sample: 'Ava', categories: ['*'], fallback: 'there' }],
  canManage: true, canTest: true, canPreviewCustomer: true };
const row = { id: 'tpl_1', name: 'Confirmation', channel: 'sms', category: null, messageClass: null, subject: null, description: null, branchId: null, branchName: null, status: 'active', version: 1, recordVersion: 1, bodyPreview: 'Hi [name], your visit is confirmed.',
  createdAt: '2026-10-30T12:00:00Z', createdAtKnown: true, updatedAt: '2026-10-30T12:00:00Z', lastUsedAt: null, archivedAt: null, createdByName: 'Kim Owner', updatedByName: 'Kim Owner', usageCount: 3, activeBindings: 0, problems: 0, legacyPlaceholders: true };
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, period, sort: 'newest', basis: 'created', status: 'current' });
const ui = () => render(<MemoryRouter initialEntries={['/tenant/communications/templates']}><POSMessageTemplatesScreen /></MemoryRouter>);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.summary.mockResolvedValue(summary); m.usage.mockResolvedValue({ ...page([]), unlinkedNote: 'x' }); m.connections.mockResolvedValue({ workflows: [], templateId: null, checkedAt: '' });
  m.preview.mockResolvedValue({ templateId: null, name: null, version: null, channel: 'sms', category: null, source: 'sample', sent: false, rendered: { subject: null, text: 'Welcome Ava', html: null, missing: [], used: [], unknown: [], sms: { segments: 1, encoding: 'GSM-7', units: 11, perSegment: 160 } }, validation: { errors: [], warnings: [], tokens: [] }, unresolved: [], note: '' });
});

describe('POSMessageTemplatesScreen', () => {
  it('lists the real store with the server\'s numbers', async () => {
    m.list.mockResolvedValue(page([row]));
    ui();
    expect(await screen.findByText('Confirmation')).toBeInTheDocument();
    expect(screen.getByText(/your visit is confirmed/)).toBeInTheDocument();
    expect(screen.getByTestId('mt-kpi-used')).toHaveTextContent('3');
  });
  it('keeps the original form: Name + Channel + Message + Create → create(activate) — no send', async () => {
    m.list.mockResolvedValue(page([]));
    m.create.mockResolvedValue({ template: { ...row, id: 'tpl_new', name: 'Welcome', body: 'Welcome {customer_first_name}!' }, validation: { errors: [], warnings: [], tokens: [] }, versions: [], bindings: [], tests: [], variables: [] });
    ui();
    await screen.findByText(/No templates yet/);
    fireEvent.change(screen.getByPlaceholderText(/Appointment confirmation/), { target: { value: 'Welcome' } });
    fireEvent.change(screen.getByTestId('mt-f-body'), { target: { value: 'Welcome {customer_first_name}!' } });
    fireEvent.click(screen.getByTestId('mt-create'));
    await waitFor(() => expect(m.create).toHaveBeenCalled());
    expect(m.create.mock.calls[0][0]).toMatchObject({ name: 'Welcome', channel: 'sms', body: 'Welcome {customer_first_name}!', activate: true });
    expect(m.testSend).not.toHaveBeenCalled();
  });
  it('the variable assistant inserts a token into the message', async () => {
    m.list.mockResolvedValue(page([]));
    ui();
    await screen.findByText(/No templates yet/);
    fireEvent.click(await screen.findByTestId('mt-var-customer_first_name'));
    expect((screen.getByTestId('mt-f-body') as HTMLTextAreaElement).value).toBe('{customer_first_name}');
  });
  it('shows the permission notice on a 403', async () => {
    m.summary.mockRejectedValue({ status: 403 }); m.list.mockRejectedValue({ status: 403 });
    ui();
    expect(await screen.findByTestId('mt-forbidden')).toHaveTextContent(/do not have permission/i);
  });
  it('warns (never blocks) when a new draft looks like an existing template', async () => {
    m.list.mockResolvedValue(page([row]));
    ui();
    await screen.findByText('Confirmation');
    fireEvent.change(screen.getByTestId('mt-f-body'), { target: { value: 'Hi [name], your visit is confirmed.' } });
    expect(await screen.findByTestId('mt-dup-warn', {}, { timeout: 2000 })).toHaveTextContent('Confirmation');
    expect(screen.getByTestId('mt-create')).not.toBeDisabled();
  });
  it('restores an earlier version as a NEW version via the audited update path', async () => {
    m.list.mockResolvedValue(page([row]));
    const tpl = { ...row, version: 2, recordVersion: 4, body: 'New text' };
    const v = (n: number, body: string) => ({ version: n, name: 'Confirmation', channel: 'sms', category: null, subject: null, body, variables: [], backfilled: false, createdAt: null, byName: null });
    const det = { template: tpl, validation: { errors: [], warnings: [], tokens: [] }, versions: [v(2, 'New text'), v(1, 'Old text')], bindings: [], tests: [], variables: [] };
    (realApi.detail as any).mockResolvedValue(det);
    (realApi.update as any).mockResolvedValue({ ...det, template: { ...tpl, version: 3, recordVersion: 5, body: 'Old text' } });
    ui();
    fireEvent.click(await screen.findByTestId('mt-row'));
    fireEvent.click(await screen.findByTestId('mt-tab-versions'));
    const btns = await screen.findAllByTestId('mt-restore-version');
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    fireEvent.click(screen.getByTestId('mt-restore-confirm'));
    await waitFor(() => expect(realApi.update).toHaveBeenCalled());
    expect((realApi.update as any).mock.calls[0]).toEqual(['tpl_1', expect.objectContaining({ recordVersion: 4, body: 'Old text', name: 'Confirmation' })]);
    expect(await screen.findByText('Restored v1 as v3.')).toBeInTheDocument();
  });
});
