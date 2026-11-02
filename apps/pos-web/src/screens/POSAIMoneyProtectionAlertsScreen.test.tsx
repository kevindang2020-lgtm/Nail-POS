import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
const { alertsMock, explainMock } = vi.hoisted(() => ({ alertsMock: vi.fn(), explainMock: vi.fn() }));
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: { alerts: alertsMock, explainAlert: explainMock, state: vi.fn() } }));
import { POSAIMoneyProtectionAlertsScreen } from './POSAIMoneyProtectionAlertsScreen';
beforeEach(() => { alertsMock.mockReset(); explainMock.mockReset(); });

const alert = {
  id: 'mpa_1', severity: 'CRITICAL', alertType: 'duplicate_charge_exact', status: 'NEW', amountCents: 5000,
  riskScore: 95, confidence: 'high', createdAt: '2026-07-07T00:00:00Z', branchId: 'b1',
  evidence: { summary: 'Potential duplicate — requires review.', triggeredRules: ['MP_DUP_CHARGE_EXACT'], recommendedReview: ['Open both transactions and compare.'], alternativeExplanations: ['A duplicate webhook recorded one payment twice.'] },
  related: { transactionIds: ['p1', 'p2'], ticketIds: ['t1'] },
};

describe('POSAIMoneyProtectionAlertsScreen', () => {
  it('lists alerts and opens evidence detail with an advisory explanation', async () => {
    alertsMock.mockResolvedValue({ items: [alert] });
    explainMock.mockResolvedValue({ summary: 'This is a possible anomaly requiring review.', source: 'ai', disclaimer: 'Advisory only — not proof of misconduct.' });
    render(<POSAIMoneyProtectionAlertsScreen />);
    expect(await screen.findByText('Duplicate charge (exact)')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: 'Alert detail' })).toBeInTheDocument();
    expect(screen.getByText(/Possible benign explanations/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate webhook recorded one payment twice/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Explain this alert/i }));
    await waitFor(() => expect(screen.getByText(/possible anomaly requiring review/i)).toBeInTheDocument());
    expect(screen.getByText(/Advisory only/i)).toBeInTheDocument();
    expect(explainMock).toHaveBeenCalledWith('mpa_1');
  });

  it('shows an empty state when there are no alerts', async () => {
    alertsMock.mockResolvedValue({ items: [] });
    render(<POSAIMoneyProtectionAlertsScreen />);
    expect(await screen.findByText(/Nothing needs review right now/i)).toBeInTheDocument();
  });
});

// Vietnamese POS leftover (Oct 27 2026): the evidence's fixed English and the deterministic fallback explanation read in
// Vietnamese (re-coded with mpTextCoded / summaryCoded); an AI-written explanation is labelled as English.
import { act } from '@testing-library/react';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
describe('POSAIMoneyProtectionAlertsScreen in Vietnamese', () => {
  const real = { ...alert, evidence: { summary: 'Potential duplicate — requires review. The same processor transaction is attached to 2 captured payments.', triggeredRules: ['MP_DUP_CHARGE_EXACT'],
    recommendedReview: ['Open both transactions and compare processor state, ticket state, and receipts.'], alternativeExplanations: ['A single legitimate payment recorded twice by a duplicate webhook.', 'Something a newer server wrote.'] } };
  it('evidence + fallback explanation in Vietnamese; unknown sentence as stored; switching back shows the server English', async () => {
    alertsMock.mockResolvedValue({ items: [real] });
    explainMock.mockResolvedValue({ summary: 'English fallback text', source: 'fallback', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.',
      summaryCoded: [{ code: 'MP.SUM.DUP_EXACT_PTX', vars: { n: '2' } }, { code: 'MP.FALLBACK.RULES', vars: { rules: 'MP_DUP_CHARGE_EXACT', dollars: '50.00' } }, { code: 'MP.FALLBACK.NOT_PROOF' }], disclaimerCoded: { code: 'MP.DISCLAIMER' } });
    await setLanguage('vi');
    function Live() { useLanguage(); return <POSAIMoneyProtectionAlertsScreen />; }
    render(<Live />);
    fireEvent.click(await screen.findByRole('button', { name: /Xem|Kiểm tra/ }));
    expect(await screen.findByText('Có thể bị trùng — cần kiểm tra. Cùng một giao dịch của bộ xử lý thanh toán gắn với 2 khoản đã thu.')).toBeInTheDocument();
    expect(screen.getByText('Mở cả hai giao dịch và so sánh trạng thái bên xử lý thanh toán, trạng thái hóa đơn và biên lai.')).toBeInTheDocument();
    expect(screen.getByText('Một khoản hợp lệ bị ghi hai lần do thông báo (webhook) bị gửi trùng.')).toBeInTheDocument();
    expect(screen.getByText('Something a newer server wrote.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button').find((b) => /Giải thích|giải thích/.test(b.textContent || ''))!);
    expect(await screen.findByText(/Quy tắc đã kích hoạt: MP_DUP_CHARGE_EXACT\. Số tiền đang xem xét: \$50\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Chỉ để tham khảo/)).toBeInTheDocument();
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText('English fallback text')).toBeInTheDocument();
    expect(screen.getByText(/Advisory only — possible anomaly/)).toBeInTheDocument();
  });
  it('an AI-written explanation is shown labelled as English in Vietnamese', async () => {
    alertsMock.mockResolvedValue({ items: [real] });
    explainMock.mockResolvedValue({ summary: 'Two captures share one processor id.', source: 'ai', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.', summaryCoded: null });
    await setLanguage('vi');
    render(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Xem|Kiểm tra/ }));
    fireEvent.click(await waitFor(() => screen.getAllByRole('button').find((b) => /Giải thích|giải thích/.test(b.textContent || ''))!));
    const ai = await screen.findByTestId('mp-explain-ai-english');
    expect(ai.textContent).toBe('Giải thích do AI viết (tiếng Anh): Two captures share one processor id.');
    expect(ai.getAttribute('lang')).toBe('en');
    await act(async () => { await setLanguage('en'); });
  });
  it('§120: an AI explanation written in Vietnamese (the gateway asked in the reader\'s language) is shown as is, no label; in English it is labelled Vietnamese', async () => {
    alertsMock.mockResolvedValue({ items: [real] });
    explainMock.mockResolvedValue({ summary: 'Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai', source: 'ai', language: 'vi', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.', summaryCoded: null });
    await setLanguage('vi');
    render(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Xem|Kiểm tra/ }));
    fireEvent.click(await waitFor(() => screen.getAllByRole('button').find((b) => /Giải thích|giải thích/.test(b.textContent || ''))!));
    const ai = await screen.findByTestId('mp-explain-ai');
    expect(ai.textContent).toBe('Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai');
    expect(ai.getAttribute('lang')).toBe('vi');
    expect(screen.queryByTestId('mp-explain-ai-english')).toBeNull();
    // an English screen (the app root re-renders every screen on a switch; here: a fresh render in English)
    cleanup();
    await act(async () => { await setLanguage('en'); });
    render(<POSAIMoneyProtectionAlertsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Review|View|Xem|Kiểm tra/ }));
    fireEvent.click(await waitFor(() => screen.getAllByRole('button').find((b) => /Explain|Giải thích/.test(b.textContent || ''))!));
    const other = await screen.findByTestId('mp-explain-ai-vietnamese');
    expect(other.textContent).toBe('AI explanation (Vietnamese): Hai lần thu cùng một mã giao dịch. Kiểm tra trước tiên: so sánh hai biên lai');
    expect(other.getAttribute('lang')).toBe('vi');
  });
});
