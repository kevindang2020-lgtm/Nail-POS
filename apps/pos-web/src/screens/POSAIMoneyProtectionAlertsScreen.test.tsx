// POSAIMoneyProtectionAlertsScreen — Money Protection alerts (guides of Nov 3 2026): the list is a server query (status group, severity,
// kind, which date, presets, pages); an alert opens with its evidence (Vietnamese worded from codes), the records it points at and its
// history; acknowledge / dismiss (reason) / reopen go to the center; the advisory explanation keeps its language rules (§120).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { dl } = vi.hoisted(() => ({ dl: vi.fn() }));
vi.mock('../components/FitKit', async (orig) => ({ ...(await orig<typeof import('../components/FitKit')>()), downloadText: dl }));
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
const { mc, api } = vi.hoisted(() => {
  const mc = { summary: vi.fn(), alerts: vi.fn(), alert: vi.fn(), alertAction: vi.fn(), alertBatch: vi.fn(), investigations: vi.fn(), timeline: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), history: vi.fn(), runs: vi.fn(), runDetection: vi.fn(), check: vi.fn(), exportCsv: vi.fn() };
  return { mc, api: { center: mc, explainAlert: vi.fn(), createInvestigation: vi.fn(), addNote: vi.fn(), assignInvestigation: vi.fn(), setInvestigationStatus: vi.fn(), resolveInvestigation: vi.fn() } };
});
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: api }));
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });
const wrap = (el: any) => render(<MemoryRouter>{el}</MemoryRouter>);

import { POSAIMoneyProtectionAlertsScreen } from './POSAIMoneyProtectionAlertsScreen';

const row = { id: 'mpa_1', ruleId: 'MP_DUP_CHARGE_EXACT', rule: 'Exact duplicate charge', category: 'duplicate_charge', severity: 'CRITICAL', status: 'NEW', group: 'open', amountCents: 5000, eventCount: 1,
  branch: 'Main', firstSeenAt: '2026-11-03T05:00:00Z', lastSeenAt: '2026-11-03T05:00:00Z', investigationId: null };
const detail = (o: any = {}) => ({ alert: { ...row, riskScore: 95, confidence: 'high' }, rule: { id: 'MP_DUP_CHARGE_EXACT', name: 'Exact duplicate charge', description: 'Two captured payments share a processor transaction id.', humanReview: true },
  evidence: { summary: 'Potential duplicate — requires review.', triggeredRules: ['MP_DUP_CHARGE_EXACT'], recommendedReview: ['Open both transactions and compare.'], alternativeExplanations: ['A duplicate webhook recorded one payment twice.'] },
  sources: { tickets: [{ id: 't1', number: 'T-1042', status: 'paid', totalCents: 5000, at: '2026-11-03T05:00:00Z', customer: 'Linh Pham' }], payments: [{ id: 'p1', method: 'card', amountCents: 5000, status: 'approved', at: '2026-11-03T05:00:00Z' }],
    staff: [{ id: 'u2', name: 'Cashier Lan' }], missing: { tickets: 0, payments: 0 } },
  history: [], canAct: true, selfInvolved: false, actions: ['acknowledge', 'dismiss'], ...o });
beforeEach(() => { vi.clearAllMocks(); mc.alerts.mockResolvedValue(page([row])); mc.alert.mockResolvedValue(detail()); });

describe('POSAIMoneyProtectionAlertsScreen', () => {
  it('lists open alerts newest first; filters, presets and pages reach the server', async () => {
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    const r = await screen.findByTestId('mpx-alert-row');
    expect(r).toHaveTextContent('Exact duplicate charge'); expect(r).toHaveTextContent('$50.00'); expect(r).toHaveTextContent('Critical');
    expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'open', sort: 'newest', page: 1, pageSize: 25 }));
    fireEvent.change(screen.getByTestId('mpx-severity'), { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByTestId('mpx-category'), { target: { value: 'refund' } });
    fireEvent.click(screen.getByTestId('mpx-preset-last_30'));
    fireEvent.click(screen.getByTestId('mpx-grp-dismissed'));
    await waitFor(() => expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'HIGH', category: 'refund', preset: 'last_30', status: 'dismissed', page: 1 })));
  });
  it('MONEY PROTECTION ALERTS 14: Export asks the SERVER for the file with the current filters (no page / page size) and saves it; hidden without canExport', async () => {
    mc.alerts.mockResolvedValue(page([row], { canExport: true }));
    mc.exportCsv.mockResolvedValue('Export,AI Money Protection — alerts\r\n');
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    await screen.findByTestId('mpx-alert-row');
    fireEvent.change(screen.getByTestId('mpx-severity'), { target: { value: 'CRITICAL' } });
    fireEvent.click(screen.getByTestId('mpx-preset-last_30'));
    await waitFor(() => expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'CRITICAL', preset: 'last_30' })));
    fireEvent.click(await screen.findByTestId('mpx-export'));
    await waitFor(() => expect(dl).toHaveBeenCalledWith('money-protection-alerts.csv', 'Export,AI Money Protection — alerts\r\n'));
    const sent = mc.exportCsv.mock.calls[0][0];
    expect(sent).toMatchObject({ view: 'alerts', status: 'open', severity: 'CRITICAL', preset: 'last_30', sort: 'newest' });
    expect(sent).not.toHaveProperty('page'); expect(sent).not.toHaveProperty('pageSize');
    expect(screen.getByTestId('mpx-export-note')).toHaveTextContent(/who made it/);
    cleanup();
    mc.alerts.mockResolvedValue(page([row], { canExport: false }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    await screen.findByTestId('mpx-alert-row');
    expect(screen.queryByTestId('mpx-export')).toBeNull();
  });
  it('MONEY PROTECTION ALERTS 14: a refused export says why and saves nothing', async () => {
    mc.alerts.mockResolvedValue(page([row], { canExport: true }));
    mc.exportCsv.mockRejectedValue(Object.assign(new Error('x'), { code: 'PERMISSION_DENIED' }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-export'));
    await waitFor(() => expect(screen.getByTestId('mpx-export-note')).toBeInTheDocument());
    expect(dl).not.toHaveBeenCalled();
  });
  it('MONEY PROTECTION ALERTS 06: the combined search covers the payment reference and each row says which field matched, masked as the server sent it', async () => {
    mc.alerts.mockImplementation(async (q: any) => q.q ? page([{ ...row, match: { field: 'customer_phone', shown: '•••• 0142' } }], { customersVisible: true }) : page([row], { customersVisible: true }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    const box = await screen.findByTestId('mpx-search');
    expect(box).toHaveAttribute('placeholder', expect.stringMatching(/payment reference/));
    expect(screen.queryByTestId('mpx-alert-match')).toBeNull();
    fireEvent.change(box, { target: { value: '5550142' } });
    fireEvent.submit(box.closest('form')!);
    expect(await screen.findByTestId('mpx-alert-match')).toHaveTextContent('Matched on customer phone: •••• 0142');
    expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ q: '5550142' }));
  });
  it('AI MONEY PROTECTION 5 · 13: on page 2, opening and closing an alert keeps the page and returns focus to the row it came from', async () => {
    const rows = [{ ...row, id: 'mpa_1' }, { ...row, id: 'mpa_2' }];
    mc.alerts.mockImplementation(async (q: any) => page(rows, { page: q.page ?? 1, total: 60, totalPages: 3 }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    await screen.findAllByTestId('mpx-alert-row');
    fireEvent.click(screen.getByRole('button', { name: /^Page 2$/ }));
    await waitFor(() => expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    const calls = mc.alerts.mock.calls.length;
    const view = (await screen.findAllByTestId('mpx-alert-view'))[1];
    view.focus();
    fireEvent.click(view);
    await screen.findByTestId('mpx-alert');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('mpx-alert')).toBeNull());
    expect(document.activeElement).toBe(view);
    expect(mc.alerts.mock.calls.length).toBe(calls);                                     // closing re-reads nothing, page 2 stays
    expect(mc.alerts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });
  it('shows an empty state that does not claim "nothing needs review"', async () => {
    mc.alerts.mockResolvedValue(page([]));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    expect(await screen.findByText(/No alerts here\. If detection has never run/)).toBeInTheDocument();
  });
  it('detail: evidence, the hóa đơn / payment / staff it points at; dismiss needs a reason and sends the status it saw', async () => {
    mc.alertAction.mockResolvedValue({ status: 'DISMISSED_FALSE_POSITIVE' });
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect(await screen.findByTestId('mpx-d-sources')).toHaveTextContent('T-1042');
    expect(screen.getByTestId('mpx-d-sources')).toHaveTextContent('Cashier Lan');
    // Source Reconciliation Links: the same ticket / payment opens in Transactions (the owning screen), read-only
    expect(screen.getByTestId('mpx-src-ticket')).toHaveAttribute('href', '/tenant/payments/transactions?ticket=t1');
    expect(screen.getByTestId('mpx-src-payment')).toHaveAttribute('href', '/tenant/payments/transactions?q=p1');
    expect(screen.getByTestId('mpx-d-evidence')).toHaveTextContent('Potential duplicate — requires review.');
    fireEvent.click(screen.getByTestId('mpx-act-dismiss'));
    expect(screen.getByTestId('mpx-act-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('mpx-reason'), { target: { value: 'Webhook retried; one capture voided' } });
    fireEvent.click(screen.getByTestId('mpx-act-go'));
    await waitFor(() => expect(mc.alertAction).toHaveBeenCalledWith({ id: 'mpa_1', action: 'dismiss', reason: 'Webhook retried; one capture voided', expectedStatus: 'NEW' }));
  });
  it('evidence completeness: verified / missing / changed-since per source kind, and what this role cannot see', async () => {
    mc.alert.mockResolvedValue(detail({ completeness: { tickets: { expected: 1, verified: 1, missing: 0, stale: 0 }, payments: { expected: 3, verified: 2, missing: 1, stale: 1 }, staff: { expected: 0, verified: 0, missing: 0, stale: 0 }, customerDetailsLimited: true } }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect((await screen.findByTestId('mpx-cm-payments')).textContent).toMatch(/2 of 3 verified · 1 missing · 1 changed since/);
    expect(screen.queryByTestId('mpx-cm-staff')).toBeNull();
    expect(screen.getByTestId('mpx-cm-limited')).toBeInTheDocument();
  });
  it('an alert about your own activity offers no actions and says why', async () => {
    mc.alert.mockResolvedValue(detail({ canAct: false, selfInvolved: true }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect(await screen.findByTestId('mpx-d-self')).toBeInTheDocument();
    expect(screen.queryByTestId('mpx-act-dismiss')).toBeNull();
  });
});

describe('POSAIMoneyProtectionAlertsScreen in Vietnamese', () => {
  const real = detail({ evidence: { summary: 'Potential duplicate — requires review. The same processor transaction is attached to 2 captured payments.', triggeredRules: ['MP_DUP_CHARGE_EXACT'],
    recommendedReview: ['Open both transactions and compare processor state, ticket state, and receipts.'], alternativeExplanations: ['A single legitimate payment recorded twice by a duplicate webhook.', 'Something a newer server wrote.'] } });
  it('evidence + fallback explanation in Vietnamese; unknown sentence as stored; switching back shows the server English', async () => {
    mc.alert.mockResolvedValue(real);
    api.explainAlert.mockResolvedValue({ summary: 'English fallback text', source: 'fallback', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.',
      summaryCoded: [{ code: 'MP.SUM.DUP_EXACT_PTX', vars: { n: '2' } }, { code: 'MP.FALLBACK.RULES', vars: { rules: 'MP_DUP_CHARGE_EXACT', dollars: '50.00' } }, { code: 'MP.FALLBACK.NOT_PROOF' }], disclaimerCoded: { code: 'MP.DISCLAIMER' } });
    await setLanguage('vi');
    function Live() { useLanguage(); return <POSAIMoneyProtectionAlertsScreen />; }
    wrap(<Live />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect(await screen.findByText('Có thể bị trùng — cần kiểm tra. Cùng một giao dịch của bộ xử lý thanh toán gắn với 2 khoản đã thu.')).toBeInTheDocument();
    expect(screen.getByText('Mở cả hai giao dịch và so sánh trạng thái bên xử lý thanh toán, trạng thái hóa đơn và biên lai.')).toBeInTheDocument();
    expect(screen.getByText('Một khoản hợp lệ bị ghi hai lần do thông báo (webhook) bị gửi trùng.')).toBeInTheDocument();
    expect(screen.getByText('Something a newer server wrote.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mpx-explain'));
    expect(await screen.findByText(/Quy tắc đã kích hoạt: MP_DUP_CHARGE_EXACT\. Số tiền đang xem xét: \$50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Chỉ để tham khảo/)).toBeInTheDocument();
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText('English fallback text')).toBeInTheDocument();
    expect(screen.getByText(/Advisory only — possible anomaly/)).toBeInTheDocument();
  });
  it('an AI-written explanation is shown labelled as English in Vietnamese', async () => {
    mc.alert.mockResolvedValue(real);
    api.explainAlert.mockResolvedValue({ summary: 'Two captures share one processor id.', source: 'ai', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.', summaryCoded: null });
    await setLanguage('vi');
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    fireEvent.click(await screen.findByTestId('mpx-explain'));
    const ai = await screen.findByTestId('mp-explain-ai-english');
    expect(ai.textContent).toBe('Giải thích do AI viết (tiếng Anh): Two captures share one processor id.');
    expect(ai.getAttribute('lang')).toBe('en');
    await act(async () => { await setLanguage('en'); });
  });
  it('§120: an AI explanation written in Vietnamese is shown as is in Vietnamese; in English it is labelled Vietnamese', async () => {
    mc.alert.mockResolvedValue(real);
    api.explainAlert.mockResolvedValue({ summary: 'Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai', source: 'ai', language: 'vi', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.', summaryCoded: null });
    await setLanguage('vi');
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    fireEvent.click(await screen.findByTestId('mpx-explain'));
    const ai = await screen.findByTestId('mp-explain-ai');
    expect(ai.textContent).toBe('Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai');
    expect(ai.getAttribute('lang')).toBe('vi');
    expect(screen.queryByTestId('mp-explain-ai-english')).toBeNull();
    cleanup();
    await act(async () => { await setLanguage('en'); });
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    fireEvent.click(await screen.findByTestId('mpx-explain'));
    const other = await screen.findByTestId('mp-explain-ai-vietnamese');
    expect(other.textContent).toBe('AI explanation (Vietnamese): Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai');
    expect(other.getAttribute('lang')).toBe('vi');
  });
});

describe('Money Protection alerts — offline-safe (extras #15)', () => {
  it('a failed refresh keeps the last-known rows, marked Stale with Retry; Retry that succeeds clears it', async () => {
    mc.alertAction.mockResolvedValue({ status: 'DISMISSED_FALSE_POSITIVE' });
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    await screen.findByTestId('mpx-d-sources');
    mc.alerts.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByTestId('mpx-act-dismiss'));
    fireEvent.change(screen.getByTestId('mpx-reason'), { target: { value: 'Webhook retried; one capture voided' } });
    fireEvent.click(screen.getByTestId('mpx-act-go'));
    const stale = await screen.findByTestId('mpx-alerts-stale');
    expect(stale).toHaveTextContent(/Stale — could not refresh\. Showing the last results loaded at /);
    expect(screen.getAllByTestId('mpx-alert-row')).toHaveLength(1);   // last-known rows stay — never a blank or a zero
    mc.alerts.mockResolvedValue(page([row]));
    fireEvent.click(screen.getByTestId('mpx-alerts-stale-retry'));
    await waitFor(() => expect(screen.queryByTestId('mpx-alerts-stale')).toBeNull());
  });
  it('a failed read for a NEW query (different filter) is an error, not stale old rows', async () => {
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    await screen.findAllByTestId('mpx-alert-row');
    mc.alerts.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByTestId('mpx-preset-week'));
    await waitFor(() => expect(screen.queryAllByTestId('mpx-alert-row')).toHaveLength(0));
    expect(screen.queryByTestId('mpx-alerts-stale')).toBeNull();
  });
});

describe('Money Protection — staff-fairness guardrails on peer-comparison alerts (Rules extras #13)', () => {
  it('a baseline alert shows the sample, the minimum, the peers compared and their range, a small-sample caution and that it is not a conclusion', async () => {
    mc.alert.mockResolvedValue(detail({ evidence: { summary: 'x', currentValues: { reversalRatePct: 30, reversals: 9, capturedTransactions: 30 },
      baselineValues: { peerMeanRatePct: 2.1, peerCount: 4, comparedPeers: 3, minSampleSize: 20, minPeers: 3, peerCapturedMin: 30, peerCapturedMax: 70 } } }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect(await screen.findByTestId('mpx-fair-sample')).toHaveTextContent('9 reversals out of 30 payments (minimum to be compared: 20)');
    expect(screen.getByTestId('mpx-fair-peers')).toHaveTextContent('Compared with 3 staff members who had 30–70 payments each; their average reversal rate is 2.1%');
    expect(screen.getByTestId('mpx-fair-small')).toBeInTheDocument();
    expect(screen.getByTestId('mpx-fair')).toHaveTextContent('not a conclusion');
  });
  it('an older baseline alert without the new fields shows "—", and a non-baseline alert shows no fairness note', async () => {
    mc.alert.mockResolvedValueOnce(detail({ evidence: { summary: 'x', currentValues: { reversals: 15, capturedTransactions: 50 }, baselineValues: { peerMeanRatePct: 2, peerCount: 5 } } }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    expect(await screen.findByTestId('mpx-fair-sample')).toHaveTextContent('(minimum to be compared: —)');
    expect(screen.getByTestId('mpx-fair-peers')).toHaveTextContent('Compared with 4 staff members who had — payments');
    expect(screen.queryByTestId('mpx-fair-small')).toBeNull();
  });
  it('a deterministic alert has no fairness note', async () => {
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-alert-view'));
    await screen.findByTestId('mpx-d-evidence');
    expect(screen.queryByTestId('mpx-fair')).toBeNull();
  });
  it('MONEY PROTECTION ALERTS 13: batch triage previews per alert on the server, needs a confirmation, then reports what changed; hidden without permission', async () => {
    const row2 = { ...row, id: 'mpa_2', status: 'ACKNOWLEDGED' };
    mc.alerts.mockResolvedValue(page([row, row2], { canAct: true }));
    mc.alertBatch.mockImplementation(async (b: any) => b.confirm ? { preview: false, applied: 1, refused: 1, results: [] }
      : { preview: true, needsReason: b.action !== 'acknowledge', counts: { ready: 1, notFound: 0, stateInvalid: 1, ownActivity: 0 }, items: [] });
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    const boxes = await screen.findAllByTestId('mpx-alert-select');
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1]);
    expect(screen.getByTestId('mpx-triage-bar')).toHaveTextContent('2 alert(s) selected');
    fireEvent.click(screen.getByTestId('mpx-triage-open'));
    expect(await screen.findByTestId('mpx-triage-preview')).toHaveTextContent('1 alert(s) will change.');
    expect(screen.getByTestId('mpx-triage-preview')).toHaveTextContent('1 cannot take this action');
    expect(mc.alertBatch).toHaveBeenLastCalledWith({ ids: ['mpa_1', 'mpa_2'], action: 'acknowledge' });
    expect((screen.getByTestId('mpx-triage-apply') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('mpx-triage-action'), { target: { value: 'dismiss' } });
    await waitFor(() => expect(screen.getByTestId('mpx-triage-reason')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mpx-triage-confirm'));
    expect((screen.getByTestId('mpx-triage-apply') as HTMLButtonElement).disabled).toBe(true);   // dismiss needs a reason
    fireEvent.change(screen.getByTestId('mpx-triage-reason'), { target: { value: 'Webhook replay, verified' } });
    fireEvent.click(screen.getByTestId('mpx-triage-apply'));
    expect(await screen.findByTestId('mpx-triage-result')).toHaveTextContent('1 changed · 1 left unchanged');
    expect(mc.alertBatch).toHaveBeenLastCalledWith({ ids: ['mpa_1', 'mpa_2'], action: 'dismiss', reason: 'Webhook replay, verified', confirm: true });
    expect(mc.alertAction).not.toHaveBeenCalled();
    cleanup();
    mc.alerts.mockResolvedValue(page([row], { canAct: false }));
    wrap(<POSAIMoneyProtectionAlertsScreen />);
    await screen.findByTestId('mpx-alert-row');
    expect(screen.queryByTestId('mpx-alert-select')).toBeNull();
  });
});
