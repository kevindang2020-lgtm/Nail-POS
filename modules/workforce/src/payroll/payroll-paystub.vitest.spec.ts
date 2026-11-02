// payroll-paystub.vitest — the pure pay-stub pieces (Weekly Paycheck 17.5, Oct 27 2026): the earnings rows reconcile to
// the stored payable, the reversals are itemised, YTD sits beside each row, the payout lines carry check # / cash and
// their status, dates and the generated-at instant read in the salon's zone, and the PDF's own TEXT (read back out of
// the file) is the snapshot's — in English and in Vietnamese with every diacritic.
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { pdfText, pdfPageCount } from '@aipowersalon/testing/pdf-text';
import { payStubRows, payoutText, renderPayStubPdf, stubDay, stubInstant, payStubLang, payStubFilename, PayStubRateLimiter, PAY_STUB_TEXT, type PayStubData, type PayStubFigures } from './payroll-paystub';

const ZERO: PayStubFigures = { serviceCommissionCents: 0, retailCommissionCents: 0, cardTipCents: 0, cashTipCents: 0, tipsCents: 0, hourlyPayCents: 0, salaryPayCents: 0, bonusCents: 0,
  guaranteeTopUpCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0, reversalsCents: 0, refundReversalCents: 0, tipAdjustmentCents: 0, retailReversalCents: 0, grossEarningsCents: 0,
  alreadyPaidCents: 0, approvedPayableCents: 0, workedMinutes: 0 };
// commission 200 + card tips 50 + hourly 310 (16 h clocked) = gross 560; − reversals 12 (refund 10, tip 2) = net 548 = payable
const MIA: PayStubFigures = { ...ZERO, serviceCommissionCents: 20000, cardTipCents: 5000, tipsCents: 5000, hourlyPayCents: 31000, workedMinutes: 960, reversalsCents: 1200, refundReversalCents: 1000,
  tipAdjustmentCents: 200, grossEarningsCents: 56000, approvedPayableCents: 54800 };
const data = (over: Partial<PayStubData> = {}): PayStubData => ({
  salon: { name: 'Hằng Nails & Spa', branchName: 'Main', address: '12 Maple Ave, Merchantville, NJ 08109' },
  technician: { id: 'c10e0000-0000-4000-8000-000000000020', name: 'Nguyễn Thị Hằng', reference: 'T-C10E0000' },
  statement: { id: 's1', number: 'PAY-2026-000128', version: 4, status: 'partially_paid', approvedAt: '2026-10-21T16:00:00.000Z', periodLabel: 'Week of Oct 12', periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23' },
  figures: MIA,
  ytd: { ...MIA, serviceCommissionCents: 520000, cardTipCents: 90000, tipsCents: 90000, hourlyPayCents: 310000, workedMinutes: 9600, grossEarningsCents: 920000, reversalsCents: 1200,
    approvedPayableCents: 918800, year: 2026, statements: 10 },
  payouts: [
    { method: 'check', amountCents: 27400, status: 'pending', checkNumber: '4812', checkStatus: 'issued', cashStatus: null, cashSource: null, paidAt: null },
    { method: 'cash', amountCents: 27400, status: 'paid', checkNumber: null, checkStatus: null, cashStatus: 'acknowledged', cashSource: 'safe', paidAt: '2026-10-23T18:00:00.000Z' },
  ],
  paidCents: 27400, unpaidCents: 27400, generatedAt: '2026-10-27T19:04:00.000Z', timeZone: 'America/New_York', ...over,
});

describe('pay stub rows (pure)', () => {
  it('the earnings rows come from the snapshot and reconcile: gross − reversals − deductions − already paid = the stored payable', () => {
    const r = payStubRows(data());
    expect(r.reconciles).toBe(true);
    expect(r.netCents).toBe(54800);
    expect(r.shortfallCents).toBe(0);
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    expect(by.serviceCommission.cents).toBe(20000);
    expect(by.hourly).toMatchObject({ cents: 31000, hours: '16.00', ytdHours: '160.00' });
    expect(by.gross).toMatchObject({ cents: 56000, ytdCents: 920000, strong: true });
    expect(by.reversals.cents).toBe(-1200);
    expect(by.refundReversal).toMatchObject({ cents: -1000, indent: true });
    expect(by.tipAdjustment.cents).toBe(-200);
    expect(by.payable).toMatchObject({ cents: 54800, ytdCents: 918800 });
    // rows with no money (this period and YTD) are not shown; nothing invented
    expect(by.salary).toBeUndefined(); expect(by.bonus).toBeUndefined(); expect(by.retailReversal).toBeUndefined(); expect(by.otherCorrections).toBeUndefined();
    // the cents shown above the gross line add up to the stored gross
    const above = r.rows.slice(0, r.rows.findIndex((x) => x.key === 'gross'));
    expect(above.reduce((a, x) => a + x.cents, 0)).toBe(56000);
  });
  it('salary, bonus, guarantee, adjustments, deductions, already paid; a shortfall is stated, never a negative payable', () => {
    const f = { ...ZERO, salaryPayCents: 50000, bonusCents: 2000, guaranteeTopUpCents: 3000, positiveAdjustmentsCents: 1500, deductionsCents: 4000, grossEarningsCents: 56500, alreadyPaidCents: 10000, approvedPayableCents: 42500 };
    const r = payStubRows({ figures: f, ytd: null });
    expect(r.rows.map((x) => x.key)).toEqual(['salary', 'bonus', 'guarantee', 'adjustments', 'gross', 'deductions', 'net', 'alreadyPaid', 'payable']);
    expect(r.reconciles).toBe(true);
    expect(r.rows.find((x) => x.key === 'alreadyPaid')!.cents).toBe(-10000);
    const owes = payStubRows({ figures: { ...ZERO, serviceCommissionCents: 1000, grossEarningsCents: 1000, alreadyPaidCents: 3000, approvedPayableCents: 0 }, ytd: null });
    expect(owes).toMatchObject({ shortfallCents: 2000, reconciles: true });
    // a legacy tips total with no card / cash split shows as "other tips"; reversals beyond the itemised ones are "other corrections"
    const odd = payStubRows({ figures: { ...ZERO, tipsCents: 700, cardTipCents: 200, grossEarningsCents: 700, reversalsCents: 500, refundReversalCents: 100, approvedPayableCents: 200 }, ytd: null });
    expect(odd.rows.find((x) => x.key === 'otherTips')!.cents).toBe(500);
    expect(odd.rows.find((x) => x.key === 'otherCorrections')!.cents).toBe(-400);
    expect(payStubRows({ figures: { ...MIA, approvedPayableCents: 99 }, ytd: null }).reconciles).toBe(false);
  });
  it('payout lines: check # and its lifecycle, cash with its source and status, in both languages', () => {
    const d = data();
    expect(payoutText('en', d.payouts[0])).toEqual({ label: 'Check', reference: '#4812', status: 'Issued' });
    expect(payoutText('en', d.payouts[1])).toEqual({ label: 'Cash', reference: 'Safe', status: 'Received (confirmed)' });
    expect(payoutText('vi', d.payouts[0])).toEqual({ label: 'Séc', reference: '#4812', status: 'Đã phát hành' });
    expect(payoutText('vi', d.payouts[1])).toEqual({ label: 'Tiền mặt', reference: 'Két sắt', status: 'Đã nhận (đã xác nhận)' });
    expect(payoutText('en', { ...d.payouts[0], method: 'direct_deposit', status: 'paid' })).toMatchObject({ label: 'Direct deposit', status: 'Paid' });
  });
  it('dates, the generated-at instant in the salon zone, language, file name, the EN / VI key sets', () => {
    expect(stubDay('2026-10-12', 'en')).toBe('Oct 12, 2026');
    expect(stubDay('2026-10-12', 'vi')).toBe('12/10/2026');
    expect(stubDay(null, 'en')).toBe('—');
    expect(stubInstant('2026-10-27T19:04:00.000Z', 'America/New_York', 'en')).toBe('Oct 27, 2026 3:04 PM EDT');
    expect(stubInstant('2026-10-27T19:04:00.000Z', 'America/New_York', 'vi')).toBe('27/10/2026 15:04 EDT');
    expect(stubInstant('2026-10-27T19:04:00.000Z', 'Not/AZone', 'en')).toBe('Oct 27, 2026 7:04 PM UTC');
    expect([payStubLang('vi'), payStubLang('vi-VN'), payStubLang('en-US'), payStubLang(null), payStubLang('fr')]).toEqual(['vi', 'vi', 'en', 'en', 'en']);
    expect(payStubFilename('PAY-2026-000128')).toBe('pay-stub-PAY-2026-000128.pdf');
    expect(Object.keys(PAY_STUB_TEXT.vi).sort()).toEqual(Object.keys(PAY_STUB_TEXT.en).sort());
    expect(PAY_STUB_TEXT.vi.technician).toBe('Thợ');   // Kevin's ruling
    const same = Object.keys(PAY_STUB_TEXT.en).filter((k) => (PAY_STUB_TEXT.en as Record<string, string>)[k] === (PAY_STUB_TEXT.vi as Record<string, string>)[k]);
    expect(same).toEqual([]);
  });
  it('the download budget: N per window per person, then refused until the window moves', () => {
    let t = 0; const lim = new PayStubRateLimiter(3, 1000, () => t);
    expect([lim.take('a'), lim.take('a'), lim.take('a'), lim.take('a')]).toEqual([true, true, true, false]);
    expect(lim.take('b')).toBe(true);   // per person
    t = 1001; expect(lim.take('a')).toBe(true);
  });
});

describe('pay stub PDF (the text read back out of the file)', () => {
  it('English: salon, branch, technician + ID, period, statement + version, every line, YTD, payouts, paid / unpaid, generated-at', async () => {
    const pdf = await renderPayStubPdf(data(), 'en');
    if (process.env.PAYSTUB_SAMPLE_DIR) writeFileSync(`${process.env.PAYSTUB_SAMPLE_DIR}/pay-stub-en.pdf`, pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBe(1);
    const text = pdfText(pdf);
    for (const s of ['Hằng Nails & Spa', 'Main · 12 Maple Ave, Merchantville, NJ 08109', 'PAY STUB', 'Statement PAY-2026-000128', 'Version 4', 'Nguyễn Thị Hằng', 'T-C10E0000',
      'Oct 12, 2026 – Oct 18, 2026', 'Oct 23, 2026', 'Partially paid', 'Service commission', '$200.00', '$5,200.00', 'Card tips', '$50.00', 'Hourly pay', '16.00', '$310.00', 'Hours worked this year', '160.00 h',
      'Gross earnings', '$560.00', '$9,200.00', 'Refund reversal', '−$10.00', 'Tip correction', '−$2.00', 'Net pay', '$548.00', 'Payable on this statement', '$9,188.00',
      'Check', '#4812', 'Issued', '$274.00', 'Cash', 'Safe', 'Received (confirmed)', 'Paid', 'Still to pay', 'Generated Oct 27, 2026 3:04 PM EDT', 'Page 1 of 1',
      'never change', 'the 10 approved statement(s) of 2026']) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toMatch(/\$NaN|undefined|null/);
  });
  it('Vietnamese: the same stub with every diacritic intact (Thợ, Phiếu lương, Đã trả …) — the embedded font draws them', async () => {
    const pdf = await renderPayStubPdf(data(), 'vi');
    if (process.env.PAYSTUB_SAMPLE_DIR) writeFileSync(`${process.env.PAYSTUB_SAMPLE_DIR}/pay-stub-vi.pdf`, pdf);
    const text = pdfText(pdf);
    for (const s of ['PHIẾU LƯƠNG', 'Bảng kê PAY-2026-000128', 'Phiên bản 4', 'Thợ', 'Mã thợ', 'Nguyễn Thị Hằng', 'Kỳ lương', '12/10/2026 – 18/10/2026', 'Ngày trả lương', '23/10/2026',
      'Đã trả một phần', 'Hoa hồng dịch vụ', 'Tiền tip qua thẻ', 'Lương theo giờ', 'Số giờ làm trong năm', 'Tổng thu nhập', 'Hoàn trừ', 'Trừ do hoàn tiền cho khách', 'Điều chỉnh tiền tip', 'Lương thực nhận',
      'Số phải trả trong bảng kê này', 'Cách chi trả', 'Séc', 'Đã phát hành', 'Tiền mặt', 'Két sắt', 'Đã nhận (đã xác nhận)', 'Đã trả', 'Còn phải trả', 'Tạo lúc 27/10/2026 15:04 EDT',
      'Trang 1/1', 'không bao giờ thay đổi', 'Từ đầu năm']) {
      expect(text, s).toContain(s);
    }
    // the font is embedded (a Type0 / CIDFontType2 subset), never the WinAnsi standard font that drops "ợ"
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/FontFile2/);
    expect(raw).not.toMatch(/\/BaseFont\s*\/Helvetica/);
  });
  it('a long payout history flows onto a second page with the table head again and "Page n of m" on each', async () => {
    const many = Array.from({ length: 48 }, (_, i) => ({ method: 'check', amountCents: 100, status: 'canceled', checkNumber: String(9000 + i), checkStatus: 'voided', cashStatus: null, cashSource: null, paidAt: null }));
    const pdf = await renderPayStubPdf(data({ payouts: many }), 'en');
    expect(pdfPageCount(pdf)).toBe(2);
    const [p1, p2] = pdfText(pdf).split('\f');
    expect(p1).toContain('Page 1 of 2'); expect(p2).toContain('Page 2 of 2');
    expect(p2).toContain('Reference');   // the payout head repeated
    expect(p2).toContain('#9047');
  });
  it('no year-to-date column when there is none; no payouts yet is said plainly', async () => {
    const text = pdfText(await renderPayStubPdf(data({ ytd: null, payouts: [], paidCents: 0, unpaidCents: 54800 }), 'en'));
    expect(text).not.toContain('Year to date');
    expect(text).toContain('No payout recorded yet.');
  });
});
