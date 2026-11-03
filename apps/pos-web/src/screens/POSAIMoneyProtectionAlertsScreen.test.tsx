// POSAIMoneyProtectionAlertsScreen — Money Protection alerts (guides of Nov 3 2026): the list is a server query (status group, severity,
// kind, which date, presets, pages); an alert opens with its evidence (Vietnamese worded from codes), the records it points at and its
// history; acknowledge / dismiss (reason) / reopen go to the center; the advisory explanation keeps its language rules (§120).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
const { mc, api } = vi.hoisted(() => {
  const mc = { summary: vi.fn(), alerts: vi.fn(), alert: vi.fn(), alertAction: vi.fn(), investigations: vi.fn(), timeline: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), history: vi.fn(), runs: vi.fn(), runDetection: vi.fn(), check: vi.fn() };
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
    expect(screen.getByTestId('mpx-d-evidence')).toHaveTextContent('Potential duplicate — requires review.');
    fireEvent.click(screen.getByTestId('mpx-act-dismiss'));
    expect(screen.getByTestId('mpx-act-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('mpx-reason'), { target: { value: 'Webhook retried; one capture voided' } });
    fireEvent.click(screen.getByTestId('mpx-act-go'));
    await waitFor(() => expect(mc.alertAction).toHaveBeenCalledWith({ id: 'mpa_1', action: 'dismiss', reason: 'Webhook retried; one capture voided', expectedStatus: 'NEW' }));
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
