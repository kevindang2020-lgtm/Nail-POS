// seed.mjs — Payments & Money one-screen harness (Deposits & Settlements · AI Deposit Reconciliation · Invoices, Oct 29 2026).
// Seeds a TEST salon into a fresh database. Processor-side rows (payments, settlement batches, refunds) are what the
// processor webhook would have written; every salon-side record goes through the product's own writers: bank accounts,
// recorded deposits and matches (ReconWorkspaceRepository), invoices, sends, payments and voids (InvoicesLedgerRepository).
// Tooling only — never run against production. Customers are invented; phones are 555-01xx test numbers.
//   PILOT  "Pilot Nail Salon (test)"  ~16 weeks of settlements (matched / split / combined / partial / overdue / expected),
//          refunds in every status, 2 bank accounts, unmatched credits (incl. the photo's $1,000 of Sep 16), cases,
//          the photo's two legacy invoices (INV-0001 void, INV-0002 sent, no customer) + ~40 invoices in every state
//   EMPTY  "New Salon (test)"  nothing at all and no processor configured (the empty / disconnected states)
import { ReconWorkspaceRepository } from '../../modules/payments/src/finance-screens/recon-workspace.repository.ts';
import { InvoicesLedgerRepository } from '../../modules/payments/src/invoices/invoices-ledger.repository.ts';

const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0510000', 1), EMPTY = id('f0510000', 2);
export const BRANCH = id('b0610000', 1), BRANCH2 = id('b0610000', 2);
export const OWNER_USER = id('a0610000', 1), MANAGER_USER = id('a0610000', 2), DESK_USER = id('a0610000', 3);
const key = (n) => `f0510000-0000-4000-9000-${hex(n)}`;
const FIRST = ['Linh', 'Mai', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Emily', 'Sarah', 'Jessica', 'Olivia', 'Grace', 'Chloe', 'Nora', 'Ivy', 'Rosa', 'Kim', 'John'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Smith', 'Johnson', 'Garcia', 'Brown', 'Davis', 'Wilson'];
let seedN = 7; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

export async function seed(pg, db) {
  const q = (s, p = []) => pg.query(s, p);
  const owner = { tenantId: PILOT, branchId: BRANCH, userId: OWNER_USER, role: 'OWNER', permissions: [] };
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-fin','PFN001','active'), ($2,'New Salon LLC','New Salon','new-fin','NFN001','active')`, [PILOT, EMPTY]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, address, city, state, zip, phone) values ($1,$2,'Cherry Hill','active','America/New_York','2000 Route 38','Cherry Hill','NJ','08002','(856) 555-0100'), ($3,$4,'Main','active','America/New_York',null,null,null,null,null)`, [BRANCH, PILOT, BRANCH2, EMPTY]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$4,'owner@pilot.test','Linh Owner','OWNER','active'), ($2,$4,'manager@pilot.test','Mai Manager','MANAGER','active'), ($3,$4,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active')`, [OWNER_USER, MANAGER_USER, DESK_USER, PILOT]).catch(() => undefined);
  await q(`insert into tenant_payment_config (tenant_id, processor, status) values ($1,'cardpointe','active')`, [PILOT]);

  // ── customers ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const customers = [];
  for (let i = 1; i <= 80; i++) {
    const cid = id('e0610000', i); const f = pick(FIRST), l = pick(LAST);
    const phone = `+1856555${String(1000 + i).slice(-4)}`;
    const display = `(856) 555-${String(1000 + i).slice(-4)}`;
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cid, PILOT, BRANCH, f, l, `${f} ${l}`, phone, display, rnd() < 0.7 ? `${f.toLowerCase()}.${i}@example.com` : null]);
    customers.push({ id: cid, name: `${f} ${l}`, phone });
  }
  // the names the E2E searches for
  await q(`update customers set first_name = 'John', last_name = 'Smith', full_name = 'John Smith', email = 'john.smith@example.com', normalized_phone = '+18565551234', phone_display = '(856) 555-1234' where id = $1`, [customers[0].id]);
  customers[0].name = 'John Smith';

  // ── settlement batches (as the processor webhook writes them) + their payments ────────────────────────────────────
  let tk = 0, pay = 0;
  const batches = [];
  const batch = async (n, daysAgo, payments, opts = {}) => {
    const sid = id('5e710000', n); const ref = opts.ref ?? `CP-${20260000 + n}`;
    let gross = 0; const pids = [];
    for (let k = 0; k < payments; k++) {
      const c = customers[(n * 3 + k) % customers.length]; const amount = 3500 + Math.floor(rnd() * 9000);
      const tid = id('7c710000', ++tk), pid = id('9a710000', ++pay);
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at) values ($1,$2,$3,$4,'paid',$5,$6, now() - make_interval(days => $7) - interval '20 hours')`, [tid, PILOT, BRANCH, c.id, amount, `T-${1000 + tk}`, daysAgo]);
      await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status, processor, processor_transaction_id, settlement_batch_id, card_brand, card_last4, created_at)
        values ($1,$2,$3,$4,'card',$5,'settled','cardpointe',$6,null,'VISA','4242', now() - make_interval(days => $7) - interval '20 hours')`, [pid, PILOT, BRANCH, tid, amount, `TXN-${700000 + pay}`, daysAgo]);
      gross += amount; pids.push(pid);
    }
    const fee = opts.fee ?? Math.round(gross * 0.027 + payments * 10);
    const net = gross - fee - (opts.refundsIn ?? 0) + (opts.adj ?? 0);
    await q(`insert into payment_settlements (id, tenant_id, branch_id, payment_gateway_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, currency, status, settled_at, created_at, transaction_count, refunds_cents, adjustments_cents, event_id)
      values ($1,$2,$3,$2,'cardpointe',$4,$5,$6,$7,'USD',$8, now() - make_interval(days => $9), now() - make_interval(days => $9) - interval '1 hour' + make_interval(secs => $10), $11, $12, $13, $14)`,
      [sid, PILOT, BRANCH, ref, gross, fee, net, opts.status ?? 'settled', daysAgo, n, payments, opts.refundsIn ?? 0, opts.adj ?? 0, `evt_${n}`]);
    await q(`update payments set settlement_batch_id = $1 where id = any($2::uuid[])`, [sid, pids]);
    const b = { id: sid, ref, gross, fee, net, daysAgo, pids }; batches.push(b); return b;
  };
  let n = 0;
  // ~16 weeks of daily-ish batches; the most recent 2 days have no deposit yet (expected), a few older ones are overdue
  for (let d = 110; d >= 0; d -= (d > 40 ? 3 : 1)) await batch(++n, d, 2 + Math.floor(rnd() * 4), { refundsIn: d === 20 ? 1500 : 0, adj: d === 33 ? -250 : 0, status: d === 0 ? 'pending' : 'settled' });

  // ── bank accounts + deposits + matches through the product's writers ─────────────────────────────────────────────
  const ws = new ReconWorkspaceRepository(db, null);
  const op = await ws.createBankAccount(owner, { nickname: 'Operating', bankName: 'TD Bank', accountType: 'checking', accountLast4: '4321' });
  const sv = await ws.createBankAccount(owner, { nickname: 'Savings', bankName: 'TD Bank', accountType: 'savings', accountLast4: '8890' });
  const ymdAgo = async (d) => (await q(`select to_char((now() at time zone 'America/New_York')::date - $1::int, 'YYYY-MM-DD') as d`, [d])).rows[0].d;
  const today = await ymdAgo(0);
  let k = 0;
  const deposit = async (acct, cents, daysAgo, ref, notes) => (await ws.createDeposit(owner, { bankAccountId: acct, amountCents: cents, depositDate: await ymdAgo(daysAgo), reference: ref, notes, idempotencyKey: key(++k) }, today)).deposit;
  const match = async (b, dep, cents) => ws.allocate(owner, { settlementId: b.id, depositId: dep.id, amountCents: cents, reviewed: true, idempotencyKey: key(++k), basis: 'exact_reference', canApprove: true });
  for (const b of batches) {
    if (b.daysAgo <= 2) continue;                                       // not due yet → expected
    if ([9, 10, 23].includes(b.daysAgo) || b.daysAgo === 52) continue;  // overdue / missing
    if (b.daysAgo === 14) {                                              // split payout: two deposits
      const half = Math.floor(b.net / 2);
      await match(b, await deposit(op.id, half, b.daysAgo - 2, `CARDPOINTE ${b.ref} 1/2`), half);
      await match(b, await deposit(op.id, b.net - half, b.daysAgo - 2, `CARDPOINTE ${b.ref} 2/2`), b.net - half); continue;
    }
    if (b.daysAgo === 6) {                                               // partial: deposit short by $12.50
      await match(b, await deposit(op.id, b.net - 1250, b.daysAgo - 2, `CARDPOINTE ${b.ref}`), b.net - 1250); continue;
    }
    if (b.daysAgo === 18) continue;                                      // combined below
    const dep = await deposit(op.id, b.net, Math.max(0, b.daysAgo - 2), `CARDPOINTE ${b.ref}`);
    await match(b, dep, b.net);
  }
  const b18 = batches.find((b) => b.daysAgo === 18), b17 = batches.find((b) => b.daysAgo === 17);
  if (b18 && b17) {                                                     // combined payout: b17's own deposit was not created above? it was; combine b18 + a fee refund credit
    const comb = await deposit(op.id, b18.net, 15, `CARDPOINTE COMBINED ${b18.ref}`);
    await match(b18, comb, b18.net);
  }
  // unmatched credits — the photo's $1,000.00 of September 16 + others
  await deposit(op.id, 100000, Math.max(0, Math.round((Date.now() - Date.parse('2026-09-16T12:00:00-04:00')) / 86_400_000)), 'ACH CREDIT 0916', 'Shown in the Oct 28 photo as unmatched');
  await deposit(op.id, 24850, 3, 'MOBILE DEPOSIT 1031');
  await deposit(sv.id, 5000, 8, 'TRANSFER FROM OPERATING');

  // ── refunds in every status ───────────────────────────────────────────────────────────────────────────────────────
  const RS = ['refunded', 'refunded', 'refunded', 'pending', 'processing', 'failed', 'cancelled', 'voided', 'refunded', 'reserved'];
  for (let i = 0; i < 26; i++) {
    const b = batches[(i * 5) % batches.length]; const pid = b.pids[0];
    await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, status, processor_refund_id, processor_type, reason, created_at, settled_at)
      values ($1,$2,$3,$4,$5,$6,$7,'cardpointe',$8, now() - make_interval(days => $9), case when $6 = 'refunded' then now() - make_interval(days => $9) else null end)`,
      [id('6f710000', i + 1), PILOT, BRANCH, pid, 500 + i * 125, RS[i % RS.length], RS[i % RS.length] === 'cancelled' || RS[i % RS.length] === 'reserved' ? null : `RF-${88000 + i}`, pick(['Customer unhappy', 'Double charge', 'Service not done', 'Price adjustment']), Math.max(0, b.daysAgo - 1)]);
  }

  // ── cases (what the sweep / a person would open) ──────────────────────────────────────────────────────────────────
  const late = batches.find((b) => b.daysAgo === 23);
  for (const [i, kind, sev, title, ref, cents, status] of [
    [1, 'missing_deposit', 'high', `Missing deposit — ${late?.ref}`, `missing_deposit:${late?.id}`, late?.net ?? 0, 'open'],
    [2, 'fee_difference', 'moderate', 'Fee difference — CardPointe', `fee_difference:${batches[30].id}`, 340, 'in_review'],
    [3, 'duplicate', 'moderate', 'Possible duplicate import — TRANSFER FROM OPERATING', 'duplicate:manual', 5000, 'resolved'],
  ]) await q(`insert into reconciliation_exceptions (id, tenant_id, kind, severity, title, detail, amount_cents, status, source_ref, created_at, resolution_note, resolved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(days => $10), $11, $12)`,
    [id('ec710000', i), PILOT, kind, sev, title, 'Raised by the reconciliation sweep (test data).', cents, status, ref, 5 + i * 3, status === 'resolved' ? 'Same credit entered twice; kept the bank import.' : null, status === 'resolved' ? new Date() : null]);

  // ── invoices: the photo's two legacy rows first (no customer — the "—" defect), then the rest through the writer ──
  await q(`insert into invoices (id, tenant_id, branch_id, invoice_number, status, issue_date, due_date, subtotal_cents, total_cents, created_at) values
    ($1,$3,$4,'INV-0001','void','2026-10-20',null,2000,2000, now() - interval '9 days'), ($2,$3,$4,'INV-0002','sent','2026-10-21','2026-10-28',1000,1000, now() - interval '8 days')`, [id('1a710000', 1), id('1a710000', 2), PILOT, BRANCH]);
  await q(`insert into invoice_lines (invoice_id, tenant_id, description, quantity, unit_price_cents, line_total_cents, position) values ($1,$3,'Gift set',1,2000,2000,0), ($2,$3,'Nail art add-on',1,1000,1000,0)`, [id('1a710000', 1), id('1a710000', 2), PILOT]);
  const iv = new InvoicesLedgerRepository(db, null);
  const SV = [['Gel manicure', 4500], ['Spa pedicure', 5500], ['Bridal party package', 32000], ['Acrylic full set', 6500], ['Nail art (per nail)', 500], ['Gift card order', 10000]];
  for (let i = 0; i < 42; i++) {
    const c = customers[(i * 7) % customers.length];
    const lines = [{ description: SV[i % SV.length][0], quantity: 1 + (i % 3), unitPriceCents: SV[i % SV.length][1] }];
    if (i % 4 === 0) lines.push({ description: 'Travel / on-site fee', quantity: 1, unitPriceCents: 2500 });
    const issue = await ymdAgo(Math.max(0, 70 - i * 2)); const due = await ymdAgo(Math.max(-20, 70 - i * 2 - 14));
    const st = i % 7;   // 0 draft · 1 sent · 2 sent overdue · 3 partial · 4 paid · 5 void draft · 6 sent
    const d = await iv.create(owner, { idempotencyKey: key(5000 + i), customerId: c.id, issueDate: issue, dueDate: due, lines, taxCents: i % 2 ? 450 : 0, send: st !== 0 && st !== 5 });
    await q(`update invoices set created_at = now() - make_interval(days => $2) where id = $1`, [d.invoice.id, Math.max(0, 70 - i * 2)]);
    if (st === 3) await iv.recordPayment(owner, d.invoice.id, { amountCents: Math.floor(d.invoice.totalCents / 2), paidOn: await ymdAgo(Math.max(0, 60 - i * 2)), method: 'cash', idempotencyKey: key(6000 + i) });
    if (st === 4) await iv.recordPayment(owner, d.invoice.id, { amountCents: d.invoice.totalCents, paidOn: await ymdAgo(Math.max(0, 60 - i * 2)), method: 'card_external', reference: `AUTH ${30000 + i}`, idempotencyKey: key(6000 + i) });
    if (st === 5) await iv.void(owner, d.invoice.id, 'Customer cancelled the party');
  }
  await q('analyze');
  return { batches: batches.length, customers: customers.length };
}
