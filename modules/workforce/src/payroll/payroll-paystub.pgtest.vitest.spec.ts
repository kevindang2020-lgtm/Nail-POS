// payroll-paystub.pgtest — the pay-stub PDF on the REAL schema (PGlite, every migration). Weekly Paycheck mandate 17.5 /
// NEXT_STEPS W-3 (Oct 27 2026):
//   • only an APPROVED (locked) statement has a stub — a draft is 409 PAYROLL_PERIOD_NOT_READY;
//   • the stub's figures are the stored statement row (the immutable snapshot), they reconcile (gross − reversals −
//     deductions − already paid = payable), year to date sums the technician's approved statements of the year;
//   • a later adjustment (next week's bonus, approved) does not change an issued stub — the text read back out of
//     the PDF is the same, line for line, apart from the generated-at stamp;
//   • the technician reaches only her own statement (another technician → 404), a branch-confined manager only her
//     branch's technician, a receptionist nothing, another salon nothing; the download is audited without amounts and
//     rate-limited per person;
//   • Vietnamese (the technician's own language): the text read back out of the file carries every diacritic;
//   • 200 stubs: measured (no document worker needed).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { pdfText } from '@aipowersalon/testing/pdf-text';
import { permissionsFor } from '@aipowersalon/permissions';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';
import { buildPayStub, payStubData, payStubHeaders } from './payroll-paystub.service';
import { payStubRows } from './payroll-paystub';

const U = (n: number) => `5ab00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), B2 = U(3), OWNER = U(4), MGR = U(5), BM = U(6), REC = U(7), T2 = U(8);
const MIA = U(20), NOA = U(21), MIA_USER = U(30), NOA_USER = U(31);
const P0 = U(40), P1 = U(41), P2 = U(42);
let pg: any; let db: any; let wf: PayrollWorkflowService; let svc: PayrollPaycheckService;
const audits: Array<{ action: string; resourceId: string; metadata: any }> = [];
let clock = new Date('2026-10-21T15:00:00Z');
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
const branchManager = () => ({ tenantId: T, branchId: B2, userId: BM, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
const reception = () => ({ tenantId: T, branchId: B, userId: REC, role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] }) as any;
const otherSalonOwner = () => ({ tenantId: T2, branchId: null, userId: U(9), role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const tech = (userId: string) => ({ tenantId: T, userId, role: 'TECHNICIAN', permissions: [] }) as any;
const stmtOf = async (techId: string, period: string) => (await q(`select * from payroll_statements where period_id = $1 and technician_id = $2 and status <> 'voided'`, [period, techId]))[0];
/** the stub's text without the generated-at stamp (the one thing that is allowed to differ between two downloads) */
const body = (text: string) => text.split('\n').map((l) => l.replace(/ · (Generated|Tạo lúc) .*$/, '')).join('\n');
const run = async (period: string) => { await svc.calculate(manager(), period); await svc.submit(manager(), period); await svc.approve(owner(), period); };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values ($1,'Hằng Nails LLC','Hằng Nails & Spa','hang-stub','STUB01','active',$2)`, [T, OWNER]);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Other Salon LLC','Other Salon','other-stub','STUB02','active')`, [T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, address, city, state, zip) values ($1,$2,'Main','active','America/New_York','12 Maple Ave','Merchantville','NJ','08109'), ($3,$2,'Second','active','America/New_York',null,null,null,null)`, [B, T, B2]);
  for (const [id, email, name, role, lang] of [[OWNER, 'owner', 'Olga Owner', 'OWNER', null], [MGR, 'mgr', 'Max Floor', 'MANAGER', null], [BM, 'bm', 'Bea Branch', 'MANAGER', null], [REC, 'rec', 'Rae Desk', 'FRONT_DESK', null],
    [MIA_USER, 'mia', 'Nguyễn Thị Hằng', 'TECHNICIAN', 'vi'], [NOA_USER, 'noa', 'Noa Pham', 'TECHNICIAN', 'en']]) {
    await q(`insert into users (id, tenant_id, email, full_name, status, role, preferred_language) values ($1,$2,$3,$4,'active',$5,$6)`, [id, T, `${email}@stub.test`, name, role, lang]);
  }
  for (const [id, branch, first, last, user] of [[MIA, B, 'Hằng', 'Nguyễn Thị', MIA_USER], [NOA, B2, 'Noa', 'Pham', NOA_USER]]) {
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, user_id) values ($1,$2,$3,$4,$5,$6,'active',true,$7)`, [id, T, branch, first, last, user === MIA_USER ? 'Nguyễn Thị Hằng' : 'Noa Pham', user]);
  }
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, pay_date, status) values
    ($1,$4,null,'Week of Oct 5','2026-10-05','2026-10-11','2026-10-16','draft'), ($2,$4,null,'Week of Oct 12','2026-10-12','2026-10-18','2026-10-23','draft'), ($3,$4,null,'Week of Oct 19','2026-10-19','2026-10-25','2026-10-30','draft')`, [P0, P1, P2, T]);
  // week 0: Mia commission $100 + card tips $20 = $120; Noa $90
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, tips_cents, card_tip_cents, net_cents, payable_cents) values ($1,$2,$3,10000,2000,2000,12000,12000)`, [T, P0, MIA]);
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values ($1,$2,$3,9000,9000,9000)`, [T, P0, NOA]);
  // week 1: Mia commission $200 + tips $50 (card) + hourly $310 over 960 clocked minutes − a $10 refund reversal − a $2 tip taken back = $548; Noa $100
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, tips_cents, card_tip_cents, hourly_pay_cents, worked_minutes, adjustment_cents, net_cents, payable_cents)
    values ($1,$2,$3,20000,5000,5000,31000,960,-1200,54800,54800)`, [T, P1, MIA]);
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values ($1,$2,$3,10000,10000,10000)`, [T, P1, NOA]);
  for (const [cat, cents, src] of [['refund_reversal', -1000, 'refund'], ['tip_correction', -200, 'manual']] as const) {
    await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, period_id, category, amount_cents, status, reason, source) values ($1,$2,$3,$4,$5,$6,'posted','test',$7)`, [T, B, MIA, P1, cat, cents, src]);
  }
  const outbox = { write: async () => undefined } as any;
  const audit = { record: async (_a: unknown, e: { action: string; resourceId: string; metadata: any }) => { audits.push({ action: e.action, resourceId: e.resourceId, metadata: e.metadata }); } } as any;
  wf = new PayrollWorkflowService(db, { outbox, audit });
  svc = new PayrollPaycheckService(db, { workflow: wf, outbox, audit, now: () => clock });
  wf.paychecks = svc;
}, 240_000);

describe('pay stub 17.5 — from the immutable statement snapshot', () => {
  let issuedText = '';
  it('a statement that is not approved has no stub yet (409 PAYROLL_PERIOD_NOT_READY) — it is an estimate until the owner approves', async () => {
    await svc.calculate(manager(), P0);
    const draft = await stmtOf(MIA, P0);
    expect(draft.status).toBe('draft');
    await expect(svc.payStub(manager(), draft.id, { surface: 'pos', lang: 'en' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY', status: 409 });
    await expect(svc.myPayStub(tech(MIA_USER), MIA, draft.id)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
    await svc.submit(manager(), P0); await svc.approve(owner(), P0);
    await run(P1);
    expect((await stmtOf(MIA, P1)).status).toBe('locked');
  });

  it('the manager\'s stub (English): salon, branch, Mia, the period, statement + version, every figure of the stored row, payouts, YTD — and it reconciles', async () => {
    const s = await stmtOf(MIA, P1);
    const f = await svc.payStub(manager(), s.id, { surface: 'pos', lang: 'en' });
    expect(f).toMatchObject({ filename: `pay-stub-${s.statement_number}.pdf`, contentType: 'application/pdf', language: 'en', statementNumber: s.statement_number, version: Number(s.version) });
    expect(f.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const h = payStubHeaders(f);
    expect(h['Content-Disposition']).toMatch(/^attachment; filename="pay-stub-PAY-2026-\d{6}\.pdf"/);
    expect(h['Cache-Control']).toContain('no-store');
    expect(h['Content-Length']).toBe(String(f.buffer.length));
    const text = pdfText(f.buffer);
    issuedText = text;
    const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    for (const x of ['Hằng Nails & Spa', 'Main · 12 Maple Ave, Merchantville, NJ 08109', 'PAY STUB', `Statement ${s.statement_number}`, `Version ${s.version}`, 'Nguyễn Thị Hằng', `T-${MIA.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      'Oct 12, 2026 – Oct 18, 2026', 'Oct 23, 2026', 'Approved', 'Service commission', usd(Number(s.service_commission_cents)), 'Card tips', usd(Number(s.card_tip_cents)),
      'Hourly pay', '16.00', usd(Number(s.hourly_pay_cents)), 'Gross earnings', usd(Number(s.gross_earnings_cents)), 'Reversals', '−$12.00', 'Refund reversal', '−$10.00', 'Tip correction', '−$2.00',
      'Net pay', 'Payable on this statement', usd(Number(s.approved_payable_cents)), 'Check', 'Cash', 'Planned', 'Still to pay', 'Generated Oct 21, 2026 11:00 AM EDT']) {
      expect(text, x).toContain(x);
    }
    // the stub's numbers ARE the stored row, and they reconcile
    const d = await payStubData(db, manager(), s, { now: clock });
    expect(d.figures).toMatchObject({ serviceCommissionCents: 20000, cardTipCents: 5000, hourlyPayCents: 31000, workedMinutes: 960, reversalsCents: 1200, refundReversalCents: 1000, tipAdjustmentCents: 200,
      grossEarningsCents: Number(s.gross_earnings_cents), approvedPayableCents: Number(s.approved_payable_cents) });
    const r = payStubRows(d);
    expect(r).toMatchObject({ reconciles: true, netCents: 54800, shortfallCents: 0 });
    expect(Number(s.approved_payable_cents)).toBe(54800);
    // payouts as they stand: the default 50 / 50 split, nothing paid yet
    expect(d.payouts.map((x) => [x.method, x.amountCents])).toEqual([['check', 27400], ['cash', 27400]]);
    expect([d.paidCents, d.unpaidCents]).toEqual([0, 54800]);
    // year to date: week 0 + week 1, the stored columns summed
    expect(d.ytd).toMatchObject({ year: 2026, statements: 2, serviceCommissionCents: 30000, cardTipCents: 7000, grossEarningsCents: 12000 + 56000, approvedPayableCents: 12000 + 54800, workedMinutes: 960 });
    expect(text).toContain('$668.00');   // YTD payable
    // audited, without amounts
    const a = audits.filter((x) => x.action === 'pay_stub.downloaded' && x.resourceId === s.id);
    expect(a).toHaveLength(1);
    expect(a[0].metadata).toMatchObject({ statementNumber: s.statement_number, language: 'en', surface: 'pos', technicianId: MIA });
    expect(JSON.stringify(a[0].metadata)).not.toMatch(/Cents|548|274/);
  });

  it('a later adjustment (next week\'s bonus, approved) does not change the issued stub', async () => {
    const s = await stmtOf(MIA, P1);
    // the approved week takes no more adjustments — they go to the next open week
    await expect(wf.createAdjustment(owner(), P1, { technicianId: MIA, category: 'bonus', amountCents: 5000, reasonCode: 'performance_bonus', reason: 'late bonus' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_LOCKED' });
    await wf.createAdjustment(owner(), P2, { technicianId: MIA, category: 'bonus', amountCents: 5000, reasonCode: 'performance_bonus', reason: 'Busy week bonus' });
    await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, bonus_cents, net_cents, payable_cents) values ($1,$2,$3,7000,5000,12000,12000)`, [T, P2, MIA]);
    clock = new Date('2026-10-28T15:00:00Z');
    await run(P2);
    const next = await stmtOf(MIA, P2);
    expect(Number(next.bonus_cents)).toBe(5000);
    clock = new Date('2026-11-02T15:00:00Z');
    const again = pdfText((await svc.payStub(manager(), s.id, { surface: 'pos', lang: 'en' })).buffer);
    expect(body(again)).toBe(body(issuedText));   // the same stub, line for line
    expect(again).not.toBe(issuedText);           // only the generated-at stamp moved
    expect(again).toContain('Generated Nov 2, 2026 10:00 AM EST');
    // and the new week's stub carries the bonus and the YTD through it
    const nextText = pdfText((await svc.payStub(manager(), next.id, { surface: 'pos', lang: 'en' })).buffer);
    expect(nextText).toContain('Bonus');
    expect(nextText).toContain('$50.00');
    expect(nextText).toContain('the 3 approved statement(s) of 2026');
  });

  it('POSLanguage.pdf §11 / §12: the Tech App stub is ENGLISH although Mia\'s POS language is Vietnamese (and even with ?lang=vi) — her name kept exactly', async () => {
    const s = await stmtOf(MIA, P1);
    for (const f of [await svc.myPayStub(tech(MIA_USER), MIA, s.id), await svc.myPayStub(tech(MIA_USER), MIA, s.id, { lang: 'vi' })]) {
      expect(f.language).toBe('en');
      const text = pdfText(f.buffer);
      expect(text).toContain('Nguyễn Thị Hằng');   // Unicode business data is never stripped
      expect(text).not.toContain('PHIẾU LƯƠNG');
    }
    expect(audits.some((a) => a.action === 'pay_stub.downloaded' && a.resourceId === s.id && a.metadata.surface === 'tech' && a.metadata.language === 'en')).toBe(true);
    expect((await svc.payStub(owner(), s.id, { surface: 'owner', lang: 'vi' })).language).toBe('en');   // the Owner App too
  });

  it('the Front Desk POS may print the stub in Vietnamese — every diacritic read back out of the file', async () => {
    const s = await stmtOf(MIA, P1);
    const f = await svc.payStub(manager(), s.id, { surface: 'pos', lang: 'vi' });
    expect(f.language).toBe('vi');
    const text = pdfText(f.buffer);
    for (const x of ['PHIẾU LƯƠNG', `Bảng kê ${s.statement_number}`, 'Thợ', 'Mã thợ', 'Nguyễn Thị Hằng', 'Kỳ lương', '12/10/2026 – 18/10/2026', 'Ngày trả lương', 'Hoa hồng dịch vụ',
      'Tiền tip qua thẻ', 'Lương theo giờ', 'Tổng thu nhập', 'Hoàn trừ', 'Trừ do hoàn tiền cho khách', 'Lương thực nhận', 'Số phải trả trong bảng kê này', 'Cách chi trả', 'Séc', 'Tiền mặt',
      'Còn phải trả', 'Tạo lúc', 'không bao giờ thay đổi']) {
      expect(text, x).toContain(x);
    }
  });

  it('who may download: another technician → 404; a branch manager only her branch; a receptionist nothing; another salon nothing', async () => {
    const mia = await stmtOf(MIA, P1), noa = await stmtOf(NOA, P1);
    await expect(svc.myPayStub(tech(NOA_USER), NOA, mia.id)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND', status: 404 });
    await expect(svc.payStub(branchManager(), mia.id, { surface: 'pos' })).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    const bm = await svc.payStub(branchManager(), noa.id, { surface: 'pos', lang: 'en' });
    expect(pdfText(bm.buffer)).toContain('Noa Pham');
    await expect(svc.payStub(reception(), mia.id, { surface: 'pos' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.payStub(otherSalonOwner(), mia.id, { surface: 'owner' })).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    await expect(svc.payStub(owner(), U(999), { surface: 'owner' })).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    // the owner (salon-wide) reaches both
    expect((await svc.payStub(owner(), mia.id, { surface: 'owner', lang: 'en' })).statementNumber).toBe(mia.statement_number);
  });

  it('rate-limited per person: a full window is 429 RATE_LIMITED for that person only', async () => {
    const s = await stmtOf(NOA, P1);
    for (let i = 0; i < 80; i++) svc.payStubLimiter.take(`${T}:${OWNER}`);   // the owner's window is full
    await expect(svc.payStub(owner(), s.id, { surface: 'owner' })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect((await svc.myPayStub(tech(NOA_USER), NOA, s.id)).statementNumber).toBe(s.statement_number);   // someone else is unaffected
  });

  it('200 stubs: read + render measured (generation is fast enough to serve on request — no document worker)', async () => {
    const rows = await q(`select * from payroll_statements where tenant_id = $1 and status in ('locked','issued','partially_paid','paid')`, [T]);
    const t0 = performance.now();
    let bytes = 0;
    for (let i = 0; i < Number(process.env.PAYSTUB_N ?? 200); i++) bytes += (await buildPayStub(db, manager(), rows[i % rows.length], { now: clock, lang: i % 2 ? 'vi' : 'en' })).buffer.length;
    const ms = performance.now() - t0;
    console.log(`[pay stub] 200 stubs in ${Math.round(ms)} ms — ${(ms / 200).toFixed(1)} ms each, ${Math.round(bytes / 200 / 1024)} KB each`);
    expect(ms / 200).toBeLessThan(400);   // measured Oct 27 2026 on the 2-core build host under load: ~90–120 ms each (read + render)
  }, 120_000);
});
