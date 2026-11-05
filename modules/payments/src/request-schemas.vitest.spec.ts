// BUILD_PLAN Phase 12 (#17): payments body validation, route by route on the real controllers — the bodies customer-web,
// owner-web and pos-web send today pass intact; raw card fields are refused; bad bodies are 400s naming the field.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CustomerPaymentsController } from './customer-payments/customer-payments.controller';
import { HardwarePaymentOwnerController } from './hardware-payment/hardware-payment.owner.controller';
import { InvoicesController } from './invoices/invoices.controller';
import { DepositReconciliationController as D } from './deposit-reconciliation/deposit-reconciliation.controller';

const L = '33333333-3333-4333-8333-333333333333';
const CASES: RouteBodyCase[] = [
  { route: 'POST /customer/payment-methods', ctl: CustomerPaymentsController, handler: 'add', today: [
      { token: '9418594164541111', expMonth: 12, expYear: 27 },                                                   // PayScreen: a 2-digit year
      { token: 'tok_abc', brand: 'Card', last4: '1111', expMonth: 4, expYear: 2029, isDefault: true, cardholderName: 'Jane Doe', zipCode: '90210' },             // PaymentMethodsScreen
    ], bad: [{ token: 't', cvv: '123' }, 'cvv'] },
  { route: 'POST /customer/wallet/top-up', ctl: CustomerPaymentsController, handler: 'topUp', today: [{ amountCents: 5000, paymentMethodId: L }], bad: [{ amountCents: [50] }, 'amountCents'] },
  { route: 'POST /owner/hardware-payment/payment-method', ctl: HardwarePaymentOwnerController, handler: 'addMethod', today: [{ gatewayPaymentMethodToken: '9418594164541111', brand: 'card', last4: '1111', expMonth: 4, expYear: 2029 }], bad: [{ gatewayPaymentMethodToken: 't', cardNumber: '4111111111111111' }, 'cardNumber'] },
  { route: 'POST /owner/hardware-payment/autopay-consent', ctl: HardwarePaymentOwnerController, handler: 'consent', today: [{ planId: L }], bad: [{ planId: {} }, 'planId'] },
  { route: 'POST /pos/invoices', ctl: InvoicesController, handler: 'create', today: [{ dueDate: '2026-11-01', notes: null, taxCents: 0, lines: [{ description: 'Bridal party', quantity: 4, unitPriceCents: 6500 }] }], bad: [{ lines: 'Bridal' }, 'lines'] },
  { route: 'POST /pos/invoices/:id/status', ctl: InvoicesController, handler: 'setStatus', today: [{ status: 'sent' }], bad: [{ status: ['paid'] }, 'status'] },
  { route: 'POST /pos/deposit-reconciliation/bank-accounts', ctl: D, handler: 'createBank', today: [{ nickname: 'Operating', bankName: 'TD', accountType: 'checking', accountLast4: '4321' }], bad: [{ nickname: 'x', routingNumber: '021000021' }, 'routingNumber'] },
  { route: 'POST /pos/deposit-reconciliation/deposits', ctl: D, handler: 'createDeposit', today: [{ bankAccountId: L, amountCents: 125000, depositDate: '2026-10-07', reference: 'DEP-1' }], bad: [{ bankAccountId: L, amountCents: { v: 1 } }, 'amountCents'] },
  { route: 'POST /pos/deposit-reconciliation/deposits/:id/link', ctl: D, handler: 'link', today: [{ settlementId: L }, { settlementId: null }], bad: [{ settlementId: 5 }, 'settlementId'] },
  { route: 'POST /pos/deposit-reconciliation/exceptions/:id/assign', ctl: D, handler: 'assignException', today: [{ assigneeUserId: L }], bad: [{ assigneeUserId: [] }, 'assigneeUserId'] },
  { route: 'POST /pos/deposit-reconciliation/exceptions/:id/resolve', ctl: D, handler: 'resolveException', today: [{ note: 'bank fee confirmed' }], bad: [{ note: 1 }, 'note'] },
];
describe('payments — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
