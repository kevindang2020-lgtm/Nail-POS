/**
 * payroll-paystub.ts — the technician's PAY STUB as a PDF (Weekly Paycheck mandate 17.5, Oct 27 2026; NEXT_STEPS W-3).
 *
 * PURE: no database. The service (payroll-paystub.service.ts) reads the APPROVED, LOCKED pay statement (the immutable
 * snapshot, PAY-YYYY-NNNNNN) and hands its stored figures here; nothing on the stub is recalculated from sales, tickets
 * or the time clock — every money figure is a column of payroll_statements (year to date = the same columns summed over
 * the technician's approved statements of the year), the hours are the locked payroll line's clocked minutes, and the
 * payout lines are payroll_payouts as they stand (check # / cash, with their lifecycle word).
 *
 * The document is a DOWNLOAD (Content-Disposition: attachment) that the technician keeps — it is not the POS printing a
 * schedule, a queue or a service ticket (PRINT_FEATURES_REMOVED.md / check:no-print); no browser print dialog is used.
 *
 * Language: English or Vietnamese (technician = "Thợ", Kevin's ruling). The text is set in Work Sans 2.012 (SIL OFL 1.1,
 * modules/workforce/assets/fonts, the license beside it) — embedded and subset by pdfkit, with full Vietnamese coverage;
 * the PDF standard fonts (Helvetica) cannot draw "ợ", "ầ", "ữ". The bundled files are Work Sans cut down (fontTools
 * subset, Oct 27 2026) to Basic Latin, Latin-1, Latin Extended-A, the Vietnamese letters (ơ ư đ + U+1EA0–1EF9, the
 * combining tone marks), general punctuation, ₫ € ™ and the minus sign, keeping kern / liga / mark — 70 KB instead of
 * 190 KB each, which makes a stub ~3× faster to lay out (the whole font's shaping tables were most of the cost).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { centsToUsd } from '@aipowersalon/money';

export type PayStubLang = 'en' | 'vi';
/** 'vi', 'vi-VN', 'VI' → vi; anything else → en */
export const payStubLang = (v: unknown): PayStubLang => (/^vi\b/i.test(String(v ?? '').trim()) ? 'vi' : 'en');

/** The statement's stored figures (payroll_statements columns) + the locked line's clocked minutes. Integer cents. */
export interface PayStubFigures {
  serviceCommissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number;
  hourlyPayCents: number; salaryPayCents: number; bonusCents: number; guaranteeTopUpCents: number; positiveAdjustmentsCents: number;
  deductionsCents: number; reversalsCents: number; refundReversalCents: number; tipAdjustmentCents: number; retailReversalCents: number;
  grossEarningsCents: number; alreadyPaidCents: number; approvedPayableCents: number; workedMinutes: number;
}
export interface PayStubPayout {
  method: string; amountCents: number; status: string; checkNumber: string | null; checkStatus: string | null;
  cashStatus: string | null; cashSource: string | null; paidAt: string | null;
}
export interface PayStubData {
  salon: { name: string; branchName: string | null; address: string | null };
  technician: { id: string; name: string; reference: string };
  statement: { id: string; number: string; version: number; status: string; approvedAt: string | null; periodLabel: string | null; periodStart: string; periodEnd: string; payDate: string | null };
  figures: PayStubFigures;
  /** the approved statements of the pay period's year up to and including this one; null when there is none to sum */
  ytd: (PayStubFigures & { year: number; statements: number }) | null;
  payouts: PayStubPayout[];
  paidCents: number; unpaidCents: number;
  /** ISO instant the file was made, shown in the salon's time zone */
  generatedAt: string; timeZone: string;
}

// ── text (EN / VI) ─────────────────────────────────────────────────────────────────────────────────────────────────────
const EN = {
  title: 'PAY STUB', statementNo: 'Statement {n}', version: 'Version {n}',
  technician: 'Technician', technicianId: 'Technician ID', payPeriod: 'Pay period', payDate: 'Pay date', status: 'Status', approved: 'Approved',
  'st.locked': 'Approved', 'st.issued': 'Approved · payout in progress', 'st.partially_paid': 'Partially paid', 'st.paid': 'Paid',
  earnings: 'Earnings', hours: 'Hours', thisPeriod: 'This period', ytd: 'Year to date', ytdHours: 'Hours worked this year',
  serviceCommission: 'Service commission', retailCommission: 'Retail commission', cardTips: 'Card tips', cashTips: 'Cash tips', otherTips: 'Other tips',
  hourly: 'Hourly pay', salary: 'Salary', bonus: 'Bonus', guarantee: 'Guarantee top-up', adjustments: 'Adjustments',
  gross: 'Gross earnings', deductions: 'Deductions', reversals: 'Reversals', refundReversal: 'Refund reversal', tipAdjustment: 'Tip correction',
  retailReversal: 'Retail return', otherCorrections: 'Other corrections', net: 'Net pay', alreadyPaid: 'Already paid to you', payable: 'Payable on this statement',
  payouts: 'How it is paid', payout: 'Payout', reference: 'Reference', amount: 'Amount', noPayouts: 'No payout recorded yet.',
  paid: 'Paid', unpaid: 'Still to pay', check: 'Check', cash: 'Cash', checkNo: 'Check #{n}',
  'chk.planned': 'Planned', 'chk.issued': 'Issued', 'chk.delivered': 'Delivered', 'chk.cleared': 'Cleared', 'chk.voided': 'Voided', 'chk.returned': 'Returned by the bank',
  'csh.planned': 'Planned', 'csh.ready_for_handoff': 'Ready for you', 'csh.handed_off': 'Handed over', 'csh.acknowledged': 'Received (confirmed)', 'csh.disputed': 'Disputed', 'csh.canceled': 'Canceled',
  'po.pending': 'Not paid yet', 'po.paid': 'Paid', 'po.canceled': 'Canceled', 'po.failed': 'Failed',
  'src.register_drawer': 'Register drawer', 'src.safe': 'Safe', 'src.bank_withdrawal': 'Bank withdrawal', 'src.other_recorded_source': 'Other recorded source',
  shortfall: 'Earnings were {amount} below what was already paid; that difference is not taken from this stub.',
  immutable: 'These figures come from the approved, locked pay statement and never change. A later correction appears on a later statement.',
  ytdNote: 'Year to date: the {n} approved statement(s) of {year} through this pay period.',
  generated: 'Generated {at}', page: 'Page {n} of {m}',
} as const;
export type PayStubTextKey = keyof typeof EN;
const VI: Record<PayStubTextKey, string> = {
  title: 'PHIẾU LƯƠNG', statementNo: 'Bảng kê {n}', version: 'Phiên bản {n}',
  technician: 'Thợ', technicianId: 'Mã thợ', payPeriod: 'Kỳ lương', payDate: 'Ngày trả lương', status: 'Trạng thái', approved: 'Ngày duyệt',
  'st.locked': 'Đã duyệt', 'st.issued': 'Đã duyệt · đang chi trả', 'st.partially_paid': 'Đã trả một phần', 'st.paid': 'Đã trả đủ',
  earnings: 'Thu nhập', hours: 'Giờ', thisPeriod: 'Kỳ này', ytd: 'Từ đầu năm', ytdHours: 'Số giờ làm trong năm',
  serviceCommission: 'Hoa hồng dịch vụ', retailCommission: 'Hoa hồng bán sản phẩm', cardTips: 'Tiền tip qua thẻ', cashTips: 'Tiền tip tiền mặt', otherTips: 'Tiền tip khác',
  hourly: 'Lương theo giờ', salary: 'Lương cố định', bonus: 'Tiền thưởng', guarantee: 'Bù lương tối thiểu', adjustments: 'Điều chỉnh cộng',
  gross: 'Tổng thu nhập', deductions: 'Khấu trừ', reversals: 'Hoàn trừ', refundReversal: 'Trừ do hoàn tiền cho khách', tipAdjustment: 'Điều chỉnh tiền tip',
  retailReversal: 'Trừ do khách trả hàng', otherCorrections: 'Điều chỉnh khác', net: 'Lương thực nhận', alreadyPaid: 'Đã trả trước cho bạn', payable: 'Số phải trả trong bảng kê này',
  payouts: 'Cách chi trả', payout: 'Khoản chi', reference: 'Tham chiếu', amount: 'Số tiền', noPayouts: 'Chưa có khoản chi nào.',
  paid: 'Đã trả', unpaid: 'Còn phải trả', check: 'Séc', cash: 'Tiền mặt', checkNo: 'Séc số {n}',
  'chk.planned': 'Đã lên kế hoạch', 'chk.issued': 'Đã phát hành', 'chk.delivered': 'Đã giao', 'chk.cleared': 'Ngân hàng đã thanh toán', 'chk.voided': 'Đã hủy', 'chk.returned': 'Ngân hàng trả lại',
  'csh.planned': 'Đã lên kế hoạch', 'csh.ready_for_handoff': 'Sẵn sàng cho bạn', 'csh.handed_off': 'Đã trao', 'csh.acknowledged': 'Đã nhận (đã xác nhận)', 'csh.disputed': 'Đang khiếu nại', 'csh.canceled': 'Đã hủy',
  'po.pending': 'Chưa trả', 'po.paid': 'Đã trả', 'po.canceled': 'Đã hủy', 'po.failed': 'Không thành công',
  'src.register_drawer': 'Ngăn kéo quầy', 'src.safe': 'Két sắt', 'src.bank_withdrawal': 'Rút từ ngân hàng', 'src.other_recorded_source': 'Nguồn khác đã ghi nhận',
  shortfall: 'Thu nhập thấp hơn số đã trả trước {amount}; phần chênh lệch này không bị trừ trong phiếu này.',
  immutable: 'Các số liệu này lấy từ bảng kê lương đã duyệt và đã khóa, không bao giờ thay đổi. Mọi điều chỉnh sau sẽ nằm trong bảng kê sau.',
  ytdNote: 'Từ đầu năm: {n} bảng kê đã duyệt của năm {year} tính đến kỳ lương này.',
  generated: 'Tạo lúc {at}', page: 'Trang {n}/{m}',
};
/** Every string the stub draws, by language (EN is the source; VI is listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md). */
export const PAY_STUB_TEXT: Record<PayStubLang, Record<PayStubTextKey, string>> = { en: EN, vi: VI };
const tx = (lang: PayStubLang, k: PayStubTextKey, vars: Record<string, string | number> = {}) =>
  PAY_STUB_TEXT[lang][k].replace(/\{(\w+)\}/g, (_, v: string) => (vars[v] === undefined ? `{${v}}` : String(vars[v])));
const textOr = (lang: PayStubLang, k: string, fallback: string) => (k in EN ? tx(lang, k as PayStubTextKey) : fallback);

// ── the earnings rows (pure: what the stub shows, and that it reconciles) ───────────────────────────────────────────────
export interface PayStubRow { key: PayStubTextKey; cents: number; ytdCents: number | null; hours?: string | null; ytdHours?: string | null; indent?: boolean; strong?: boolean; always?: boolean }
const hoursOf = (min: number) => (Number(min) > 0 ? (Math.round((Number(min) / 60) * 100) / 100).toFixed(2) : null);
/**
 * The rows of the earnings table, in order, every figure from the snapshot. Gross = the statement's stored gross; net =
 * gross − deductions − reversals; payable = the statement's stored approved payable. `reconciles` says the stored payable
 * equals max(0, net − already paid) — the same identity the statement was written with; `shortfallCents` is what the
 * technician owed beyond her earnings (payable is never negative — the statement is review-required instead).
 */
export function payStubRows(d: Pick<PayStubData, 'figures' | 'ytd'>): { rows: PayStubRow[]; netCents: number; ytdNetCents: number | null; shortfallCents: number; reconciles: boolean } {
  const f = d.figures, y = d.ytd;
  const otherTips = f.tipsCents - f.cardTipCents - f.cashTipCents;
  const yOtherTips = y ? y.tipsCents - y.cardTipCents - y.cashTipCents : null;
  const otherCorr = f.reversalsCents - f.refundReversalCents - f.tipAdjustmentCents - f.retailReversalCents;
  const yOtherCorr = y ? y.reversalsCents - y.refundReversalCents - y.tipAdjustmentCents - y.retailReversalCents : null;
  const v = (k: keyof PayStubFigures, sign = 1) => ({ cents: sign * f[k], ytdCents: y ? sign * y[k] : null });
  const netCents = f.grossEarningsCents - f.deductionsCents - f.reversalsCents;
  const ytdNetCents = y ? y.grossEarningsCents - y.deductionsCents - y.reversalsCents : null;
  const rows: PayStubRow[] = [
    { key: 'serviceCommission', ...v('serviceCommissionCents') },
    { key: 'retailCommission', ...v('retailCommissionCents') },
    { key: 'cardTips', ...v('cardTipCents') },
    { key: 'cashTips', ...v('cashTipCents') },
    { key: 'otherTips', cents: otherTips, ytdCents: yOtherTips },
    { key: 'hourly', ...v('hourlyPayCents'), hours: hoursOf(f.workedMinutes), ytdHours: y ? hoursOf(y.workedMinutes) : null },
    { key: 'salary', ...v('salaryPayCents') },
    { key: 'bonus', ...v('bonusCents') },
    { key: 'guarantee', ...v('guaranteeTopUpCents') },
    { key: 'adjustments', ...v('positiveAdjustmentsCents') },
    { key: 'gross', ...v('grossEarningsCents'), strong: true, always: true },
    { key: 'deductions', ...v('deductionsCents', -1) },
    { key: 'reversals', ...v('reversalsCents', -1) },
    { key: 'refundReversal', ...v('refundReversalCents', -1), indent: true },
    { key: 'tipAdjustment', ...v('tipAdjustmentCents', -1), indent: true },
    { key: 'retailReversal', ...v('retailReversalCents', -1), indent: true },
    { key: 'otherCorrections', cents: -otherCorr, ytdCents: yOtherCorr == null ? null : -yOtherCorr, indent: true },
    { key: 'net', cents: netCents, ytdCents: ytdNetCents, strong: true, always: true },
    { key: 'alreadyPaid', ...v('alreadyPaidCents', -1) },
    { key: 'payable', ...v('approvedPayableCents'), strong: true, always: true },
  ];
  // the itemised reversals only when there are reversals; any other row only when it carries money (this period or YTD)
  const shown = rows.filter((r) => r.always || r.cents !== 0 || (r.ytdCents ?? 0) !== 0 || !!r.hours)
    .filter((r) => !r.indent || f.reversalsCents !== 0);
  const shortfallCents = Math.max(0, f.alreadyPaidCents - netCents);
  return { rows: shown, netCents, ytdNetCents, shortfallCents, reconciles: Math.max(0, netCents - f.alreadyPaidCents) === f.approvedPayableCents };
}

/** "Check #4812" / "Cash" + the payout's lifecycle word + its reference (check number / where the cash came from) */
export function payoutText(lang: PayStubLang, x: PayStubPayout): { label: string; reference: string; status: string } {
  if (x.method === 'check') {
    return { label: tx(lang, 'check'), reference: x.checkNumber ? `#${x.checkNumber}` : '—', status: textOr(lang, `chk.${x.checkStatus ?? 'planned'}`, String(x.checkStatus ?? x.status)) };
  }
  if (x.method === 'cash') {
    return { label: tx(lang, 'cash'), reference: x.cashSource ? textOr(lang, `src.${x.cashSource}`, x.cashSource) : '—', status: textOr(lang, `csh.${x.cashStatus ?? 'planned'}`, String(x.cashStatus ?? x.status)) };
  }
  const words = x.method.replace(/_/g, ' ');
  return { label: words.charAt(0).toUpperCase() + words.slice(1), reference: '—', status: textOr(lang, `po.${x.status}`, x.status) };
}

// ── dates ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-12 → "Oct 12, 2026" (EN) / "12/10/2026" (VI) */
export function stubDay(ymd: string | null, lang: PayStubLang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  if (!m) return '—';
  return lang === 'vi' ? `${m[3]}/${m[2]}/${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
/** an instant in the salon's zone: "Oct 27, 2026 3:04 PM EDT" (EN) / "27/10/2026 15:04 EDT" (VI) */
export function stubInstant(isoAt: string, timeZone: string, lang: PayStubLang): string {
  const at = new Date(isoAt);
  let zone = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(at); } catch { zone = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
    .formatToParts(at).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const h = Number(parts.hour), min = parts.minute, tz = String(parts.timeZoneName ?? zone).replace(/[  ]/g, ' ');
  return lang === 'vi' ? `${stubDay(ymd, 'vi')} ${String(h).padStart(2, '0')}:${min} ${tz}` : `${stubDay(ymd, 'en')} ${((h + 11) % 12) + 1}:${min} ${h < 12 ? 'AM' : 'PM'} ${tz}`;
}
function periodText(s: PayStubData['statement'], lang: PayStubLang): string {
  return `${stubDay(s.periodStart, lang)} – ${stubDay(s.periodEnd, lang)}`;
}

/** pay-stub-PAY-2026-000123.pdf — the statement number only (no name in a file name that lands in a Downloads folder) */
export const payStubFilename = (statementNumber: string) => `pay-stub-${String(statementNumber).replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;

// ── the PDF ────────────────────────────────────────────────────────────────────────────────────────────────────────────
let fontCache: { regular: Buffer; bold: Buffer } | null = null;
/** Work Sans (SIL OFL 1.1) — read once per process. src/payroll and dist/payroll both sit two levels under the module. */
function fonts(): { regular: Buffer; bold: Buffer } {
  if (!fontCache) {
    const dir = join(__dirname, '..', '..', 'assets', 'fonts');
    fontCache = { regular: readFileSync(join(dir, 'WorkSans-Regular.ttf')), bold: readFileSync(join(dir, 'WorkSans-Bold.ttf')) };
  }
  return fontCache;
}

const INK = '#231C15', MUTED = '#6E6457', LINE = '#DDD3C4', ACCENT = '#9C7A45', BAND = '#F6F1E8';
const PAGE = { w: 612, h: 792, m: 48 };   // US Letter, 2/3-inch margins
const FOOTER_ROOM = 54;

/** Render the stub. Deterministic for the same data (the creation date is `generatedAt`). */
export function renderPayStubPdf(d: PayStubData, lang: PayStubLang): Promise<Buffer> {
  const f = fonts();
  const doc = new PDFDocument({
    size: 'LETTER', margins: { top: PAGE.m, bottom: PAGE.m, left: PAGE.m, right: PAGE.m }, bufferPages: true, autoFirstPage: true, lang: lang === 'vi' ? 'vi-VN' : 'en-US',
    info: { Title: `${tx(lang, 'title')} ${d.statement.number}`, Author: d.salon.name, Subject: `${d.technician.name} · ${periodText(d.statement, lang)}`, Creator: 'AIPowerSalon', Producer: 'AIPowerSalon', CreationDate: new Date(d.generatedAt) },
  });
  doc.registerFont('ws', f.regular);
  doc.registerFont('wsb', f.bold);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('data', (b: Buffer) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const L = PAGE.m, R = PAGE.w - PAGE.m, W = R - L;
  const bottom = PAGE.h - PAGE.m - FOOTER_ROOM;
  /** shorten to fit a column (never wraps; a long salon or technician name ends in "…") */
  const fit = (s: string, w: number) => { let t = String(s ?? ''); if (doc.widthOfString(t) <= w) return t; while (t.length > 1 && doc.widthOfString(t + '…') > w) t = t.slice(0, -1); return t + '…'; };
  const put = (s: string, x: number, y: number, w: number, o: { font?: 'ws' | 'wsb'; size?: number; color?: string; align?: 'left' | 'right' | 'center' } = {}) => {
    doc.font(o.font ?? 'ws').fontSize(o.size ?? 9.5).fillColor(o.color ?? INK);
    doc.text(fit(s, w), x, y, { width: w, align: o.align ?? 'left', lineBreak: false });
  };
  const rule = (y: number, color = LINE, width = 0.75) => { doc.moveTo(L, y).lineTo(R, y).lineWidth(width).strokeColor(color).stroke(); };
  const wrap = (s: string, y: number, o: { size?: number; color?: string } = {}) => {
    doc.font('ws').fontSize(o.size ?? 8.5).fillColor(o.color ?? MUTED);
    doc.text(s, L, y, { width: W });
    return doc.y;
  };
  let y = PAGE.m;
  const ensure = (h: number, onNewPage?: () => void) => { if (y + h > bottom) { doc.addPage(); y = PAGE.m; onNewPage?.(); } };

  // ── header: salon + branch on the left, PAY STUB / statement number / version on the right ──
  put(d.salon.name, L, y, W * 0.6, { font: 'wsb', size: 17 });
  put(tx(lang, 'title'), L + W * 0.6, y + 2, W * 0.4, { font: 'wsb', size: 15, color: ACCENT, align: 'right' });
  y += 24;
  const where = [d.salon.branchName, d.salon.address].filter(Boolean).join(' · ');
  if (where) put(where, L, y, W * 0.62, { size: 9, color: MUTED });
  put(tx(lang, 'statementNo', { n: d.statement.number }), L + W * 0.6, y, W * 0.4, { font: 'wsb', size: 9.5, align: 'right' });
  y += 14;
  put(tx(lang, 'version', { n: d.statement.version }), L + W * 0.6, y, W * 0.4, { size: 8.5, color: MUTED, align: 'right' });
  y += 18;
  rule(y, ACCENT, 1.2);
  y += 12;

  // ── who / when / status: two columns of label + value ──
  const cell = (label: string, value: string, x: number, w: number) => { put(label, x, y, w, { size: 8, color: MUTED }); put(value, x, y + 11, w, { font: 'wsb', size: 10.5 }); };
  const half = W / 2;
  cell(tx(lang, 'technician'), d.technician.name, L, half - 12); cell(tx(lang, 'technicianId'), d.technician.reference, L + half, half);
  y += 30;
  cell(tx(lang, 'payPeriod'), periodText(d.statement, lang), L, half - 12); cell(tx(lang, 'payDate'), stubDay(d.statement.payDate, lang), L + half, half);
  y += 30;
  cell(tx(lang, 'status'), textOr(lang, `st.${d.statement.status}`, d.statement.status), L, half - 12);
  cell(tx(lang, 'approved'), d.statement.approvedAt ? stubDay(d.statement.approvedAt.slice(0, 10), lang) : '—', L + half, half);
  y += 36;

  // ── earnings ──
  const col = { label: L + 8, labelW: 250, hoursX: L + 262, hoursW: 56, curX: L + 322, curW: 92, ytdX: L + 418, ytdW: W - 418 - 8 };
  const showYtd = !!d.ytd;
  const head = (a: string, b: string, c: string, e: string | null) => {
    doc.rect(L, y, W, 18).fill(BAND);
    put(a, col.label, y + 5, col.labelW, { font: 'wsb', size: 8.5, color: MUTED });
    put(b, col.hoursX, y + 5, col.hoursW, { font: 'wsb', size: 8.5, color: MUTED, align: 'right' });
    put(c, col.curX, y + 5, col.curW, { font: 'wsb', size: 8.5, color: MUTED, align: 'right' });
    if (e) put(e, col.ytdX, y + 5, col.ytdW, { font: 'wsb', size: 8.5, color: MUTED, align: 'right' });
    y += 22;
  };
  head(tx(lang, 'earnings'), tx(lang, 'hours'), tx(lang, 'thisPeriod'), showYtd ? tx(lang, 'ytd') : null);
  const { rows, shortfallCents } = payStubRows(d);
  for (const r of rows) {
    ensure(16, () => head(tx(lang, 'earnings'), tx(lang, 'hours'), tx(lang, 'thisPeriod'), showYtd ? tx(lang, 'ytd') : null));
    if (r.strong) { rule(y - 3); }
    const font = r.strong ? 'wsb' : 'ws';
    put(tx(lang, r.key), col.label + (r.indent ? 14 : 0), y, col.labelW - (r.indent ? 14 : 0), { font, size: r.indent ? 8.5 : 9.5, color: r.indent ? MUTED : INK });
    if (r.hours) put(r.hours, col.hoursX, y, col.hoursW, { size: 9.5, align: 'right' });
    put(centsToUsd(r.cents), col.curX, y, col.curW, { font, size: r.indent ? 8.5 : 9.5, color: r.indent ? MUTED : INK, align: 'right' });
    if (showYtd && r.ytdCents != null) put(centsToUsd(r.ytdCents), col.ytdX, y, col.ytdW, { font, size: r.indent ? 8.5 : 9.5, color: MUTED, align: 'right' });
    y += r.strong ? 18 : 15;
    if (showYtd && r.ytdHours) {   // the year's clocked hours under the hourly line, in the year-to-date column
      put(tx(lang, 'ytdHours'), col.label + 14, y, col.labelW - 14, { size: 8.5, color: MUTED });
      put(`${r.ytdHours} h`, col.ytdX, y, col.ytdW, { size: 8.5, color: MUTED, align: 'right' });
      y += 15;
    }
  }
  if (shortfallCents > 0) { ensure(26); y = wrap(tx(lang, 'shortfall', { amount: centsToUsd(shortfallCents) }), y + 2, { color: '#A0412B' }) + 4; }
  y += 14;

  // ── payouts: check # / cash, each with its status ──
  const pc = { label: L + 8, labelW: 140, refX: L + 152, refW: 130, stX: L + 286, stW: 140, amtX: L + 430, amtW: W - 430 - 8 };
  const payoutHead = () => {
    doc.rect(L, y, W, 18).fill(BAND);
    put(tx(lang, 'payouts'), pc.label, y + 5, pc.labelW, { font: 'wsb', size: 8.5, color: MUTED });
    put(tx(lang, 'reference'), pc.refX, y + 5, pc.refW, { font: 'wsb', size: 8.5, color: MUTED });
    put(tx(lang, 'status'), pc.stX, y + 5, pc.stW, { font: 'wsb', size: 8.5, color: MUTED });
    put(tx(lang, 'amount'), pc.amtX, y + 5, pc.amtW, { font: 'wsb', size: 8.5, color: MUTED, align: 'right' });
    y += 22;
  };
  ensure(60); payoutHead();
  if (!d.payouts.length) { put(tx(lang, 'noPayouts'), pc.label, y, W - 16, { color: MUTED }); y += 15; }
  for (const x of d.payouts) {
    ensure(16, payoutHead);
    const t = payoutText(lang, x);
    const dead = x.status === 'canceled' || x.status === 'failed';
    put(t.label, pc.label, y, pc.labelW, { color: dead ? MUTED : INK });
    put(t.reference, pc.refX, y, pc.refW, { color: dead ? MUTED : INK });
    put(t.status, pc.stX, y, pc.stW, { color: dead ? MUTED : INK });
    put(centsToUsd(x.amountCents), pc.amtX, y, pc.amtW, { color: dead ? MUTED : INK, align: 'right' });
    y += 15;
  }
  ensure(40);
  rule(y - 3);
  put(tx(lang, 'paid'), pc.label, y, 200, { font: 'wsb' }); put(centsToUsd(d.paidCents), pc.amtX, y, pc.amtW, { font: 'wsb', align: 'right' }); y += 15;
  put(tx(lang, 'unpaid'), pc.label, y, 200, { font: 'wsb' }); put(centsToUsd(d.unpaidCents), pc.amtX, y, pc.amtW, { font: 'wsb', align: 'right' }); y += 24;

  // ── notes ──
  ensure(50);
  y = wrap(tx(lang, 'immutable'), y) + 3;
  if (d.ytd) y = wrap(tx(lang, 'ytdNote', { n: d.ytd.statements, year: d.ytd.year }), y) + 3;

  // ── footer on every page: statement · version · generated at · page n of m (margin lifted so it never adds a page) ──
  const range = doc.bufferedPageRange();
  const generated = tx(lang, 'generated', { at: stubInstant(d.generatedAt, d.timeZone, lang) });
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = PAGE.h - PAGE.m - 14;
    doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    put(`${d.statement.number} · ${tx(lang, 'version', { n: d.statement.version })} · ${generated}`, L, fy, W * 0.75, { size: 7.5, color: MUTED });
    put(tx(lang, 'page', { n: i - range.start + 1, m: range.count }), L + W * 0.75, fy, W * 0.25, { size: 7.5, color: MUTED, align: 'right' });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

/**
 * The per-person download budget (Constitution 12 §57 "rate-limited"): a sliding window per (salon, user) in this API
 * process — a stolen session cannot pull a salon's pay stubs as fast as it can ask. Generous for a person (a manager
 * downloading a whole week's stubs one by one stays inside it); a Redis-shared window can replace it like the kiosk PIN
 * limiter's.
 */
export class PayStubRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max = 60, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}
  /** record one download for `key`; false when the window is already full (the download is refused, not counted) */
  take(key: string): boolean {
    const t = this.now();
    const live = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (live.length >= this.max) { this.hits.set(key, live); return false; }
    live.push(t);
    this.hits.delete(key); this.hits.set(key, live);   // most recent last, so the oldest keys are the ones dropped
    if (this.hits.size > 5000) for (const k of [...this.hits.keys()].slice(0, 1000)) this.hits.delete(k);
    return true;
  }
}
