// BUILD_PLAN Phase 12 (#17): payments body validation, route by route on the real controllers — the bodies customer-web,
// owner-web and pos-web send today pass intact; raw card fields are refused; bad bodies are 400s naming the field.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CustomerPaymentsController } from './customer-payments/customer-payments.controller';
import { HardwarePaymentOwnerController } from './hardware-payment/hardware-payment.owner.controller';
import { InvoicesController } from './invoices/invoices.controller';
import { ReconWorkspaceController as W } from './finance-screens/recon-workspace.controller';

const L = '33333333-3333-4333-8333-333333333333';
const CASES: RouteBodyCase[] = [
  { route: 'POST /customer/payment-methods', ctl: CustomerPaymentsController, handler: 'add', today: [
      { token: '9418594164541111', expMonth: 12, expYear: 27 },                                                   // PayScreen: a 2-digit year
      { token: 'tok_abc', brand: 'Card', last4: '1111', expMonth: 4, expYear: 2029, isDefault: true },             // PaymentMethodsScreen
    ], bad: [{ token: 't', cvv: '123' }, 'cvv'] },
  { route: 'POST /customer/wallet/top-up', ctl: CustomerPaymentsController, handler: 'topUp', today: [{ amountCents: 5000, paymentMethodId: L }], bad: [{ amountCents: [50] }, 'amountCents'] },
  { route: 'POST /owner/hardware-payment/payment-method', ctl: HardwarePaymentOwnerController, handler: 'addMethod', today: [{ gatewayPaymentMethodToken: '9418594164541111', brand: 'card', last4: '1111', expMonth: 4, expYear: 2029 }], bad: [{ gatewayPaymentMethodToken: 't', cardNumber: '4111111111111111' }, 'cardNumber'] },
  { route: 'POST /owner/hardware-payment/autopay-consent', ctl: HardwarePaymentOwnerController, handler: 'consent', today: [{ planId: L }], bad: [{ planId: {} }, 'planId'] },
  { route: 'POST /pos/invoices', ctl: InvoicesController, handler: 'create', today: [{ dueDate: '2026-11-01', notes: null, taxCents: 0, lines: [{ description: 'Bridal party', quantity: 4, unitPriceCents: 6500 }] }], bad: [{ lines: 'Bridal' }, 'lines'] },
  { route: 'POST /pos/invoices/:id/status', ctl: InvoicesController, handler: 'setStatus', today: [{ status: 'sent' }], bad: [{ status: ['paid'] }, 'status'] },
  // AI Deposit Reconciliation one-screen (Oct 29 2026): the workspace routes the rebuilt page sends
  { route: 'POST /pos/deposit-reconciliation/workspace/bank-accounts', ctl: W, handler: 'addBankAccount', today: [{ nickname: 'Operating', bankName: 'TD Bank', accountType: 'checking', accountLast4: '4321' }], bad: [{ nickname: 'x', routingNumber: '021000021' }, 'routingNumber'] },
  { route: 'POST /pos/deposit-reconciliation/workspace/deposits', ctl: W, handler: 'recordDeposit', today: [{ bankAccountId: L, amountCents: 125000, depositDate: '2026-10-07', reference: 'DEP-1', idempotencyKey: 'f0510000-0000-4000-9000-000000000001', allowDuplicateReference: false }], bad: [{ bankAccountId: L, amountCents: { v: 1 }, depositDate: '2026-10-07', idempotencyKey: 'f0510000-0000-4000-9000-000000000001' }, 'amountCents'] },
  { route: 'POST /pos/deposit-reconciliation/workspace/allocations', ctl: W, handler: 'allocate', today: [{ settlementId: L, depositId: L, amountCents: 9700, reviewed: true, idempotencyKey: 'f0510000-0000-4000-9000-000000000001' }], bad: [{ settlementId: L, depositId: L, amountCents: 9700, idempotencyKey: 'f0510000-0000-4000-9000-000000000001', cardNumber: '4111111111111111' }, 'cardNumber'] },
  { route: 'POST /pos/deposit-reconciliation/workspace/exceptions/:exceptionId/assign', ctl: W, handler: 'assign', today: [{ assigneeUserId: L }], bad: [{ assigneeUserId: [] }, 'assigneeUserId'] },
  { route: 'POST /pos/deposit-reconciliation/workspace/exceptions/:exceptionId/resolve', ctl: W, handler: 'resolve', today: [{ reason: 'bank fee confirmed' }], bad: [{ reason: 1 }, 'reason'] },
  // Invoices one-screen (Oct 29 2026)
  { route: 'POST /pos/invoices/new', ctl: InvoicesController, handler: 'createInvoice', today: [{ customerId: L, issueDate: '2026-10-29', taxCents: 0, discountCents: 0, lines: [{ description: 'Gel manicure', quantity: 1, unitPriceCents: 4500 }], idempotencyKey: 'f0510000-0000-4000-9000-000000000001', send: false }], bad: [{ customerId: L, lines: [], totalCents: 1 }, 'totalCents'] },
  { route: 'POST /pos/invoices/:id/payments', ctl: InvoicesController, handler: 'recordPayment', today: [{ amountCents: 2000, paidOn: '2026-10-29', method: 'cash', idempotencyKey: 'f0510000-0000-4000-9000-000000000001' }], bad: [{ amountCents: '20', paidOn: '2026-10-29', method: 'cash', idempotencyKey: 'f0510000-0000-4000-9000-000000000001' }, 'amountCents'] },
];
describe('payments — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
