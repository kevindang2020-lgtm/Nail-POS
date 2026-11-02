import { describe, it, expect } from 'vitest';
import { HardwarePaymentService } from './hardware-payment.service';
import { InMemoryHardwarePaymentRepository } from './hardware-payment.repository';

function harness(chargeOk = true) {
  const repo = new InMemoryHardwarePaymentRepository();
  const charges: any[] = [];
  const charge = { charge: async (i: any) => { charges.push(i); return chargeOk ? { ok: true, retref: 'R1', respstat: 'A', respText: 'Approved' } : { ok: false, respstat: 'D', respText: 'Declined' }; } };
  const alerts: any[] = []; const audits: any[] = [];
  const svc = new HardwarePaymentService(repo, charge as any, { raise: (a: any) => { alerts.push(a); } } as any, { log: (a: any) => { audits.push(a); } } as any);
  return { repo, svc, charges, alerts, audits };
}
async function activePlan(svc: HardwarePaymentService, tenant: string, monthlyCents: number) {
  return svc.createPlan(tenant, { status: 'active', monthlyPaymentCents: monthlyCents, totalHardwareCostCents: 300000, downPaymentCents: 0 });
}

describe('Hardware Payment Recovery — service (build doc §10, §17, §19)', () => {
  it('charges ONLY the shortfall when the credit is not enough ($50k vol, $250 due → $152.50)', async () => {
    const { svc, charges, audits } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok_visa', brand: 'visa', last4: '4242' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'owner1' });
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.shortfallCents).toBe(15_250);
    expect(out.autoChargedCents).toBe(15_250);
    expect(out.invoice.status).toBe('paid');
    expect(charges).toHaveLength(1);
    expect(charges[0].amountCents).toBe(15_250);               // ONLY the shortfall
    expect(audits.some((a) => a.action === 'hardware_shortfall_charged')).toBe(true);
  });

  it('does NOT double-charge when the month is reconciled again (idempotent re-run)', async () => {
    const { svc, charges } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok_visa', brand: 'visa', last4: '4242' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'owner1' });
    const first = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(first.invoice.status).toBe('paid');
    expect(charges).toHaveLength(1);
    // Re-run the same month (e.g. admin "recalculate month" / scheduler retry) — must not charge again.
    const second = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(second.invoice.status).toBe('paid');
    expect(second.autoChargedCents).toBe(0);
    expect(charges).toHaveLength(1);                            // STILL one charge, not two
    // Manual charge on an already-paid month is refused.
    await expect(svc.chargeShortfallNow('tA', plan.id, '2026-06')).rejects.toThrow();
    expect(charges).toHaveLength(1);
  });

  it('REJECTS a corrected-volume re-run on a settled (paid) month — money is never silently recomputed', async () => {
    const { svc, charges, audits } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok_visa', brand: 'visa', last4: '4242' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'owner1' });
    const first = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(first.invoice.status).toBe('paid');
    expect(charges).toHaveLength(1);
    // A DIFFERENT volume on a settled month is refused (month_settled) and audited — nothing is re-charged.
    await expect(svc.reconcile('tA', plan.id, '2026-06', 9_000_000)).rejects.toThrow(/settled/i);
    expect(charges).toHaveLength(1);
    expect(audits.some((a) => a.action === 'hardware_recalc_rejected_month_settled')).toBe(true);
    // The SAME volume still returns idempotently (scheduler retry / no-op recalc) — no throw, no new charge.
    const same = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(same.invoice.status).toBe('paid');
    expect(charges).toHaveLength(1);
  });

  it('re-running an UNPAID month does not double-reduce principal or duplicate the reconciliation ledger', async () => {
    const { svc, repo } = harness(true);
    // Plan routes extra credit to principal; no payment method/consent so nothing is charged — the month stays unpaid.
    const plan = await svc.createPlan('tA', { status: 'active', monthlyPaymentCents: 1_000, totalHardwareCostCents: 300_000, downPaymentCents: 0, extraCreditHandling: 'apply_to_principal_balance' });
    const startBalance = (await repo.getPlan('tA', plan.id))!.remainingBalanceCents;

    // First reconcile: $50k volume → credit exceeds the tiny due → extra credit reduces principal; no shortfall → unpaid.
    const first = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(first.invoice.status).not.toBe('paid');
    const afterFirst = (await repo.getPlan('tA', plan.id))!.remainingBalanceCents;
    expect(afterFirst).toBeLessThan(startBalance);                              // principal reduced once
    const reconLedgerFirst = (await repo.listLedger('tA', first.invoice.id!)).filter((l: any) => l.source === 'reconciliation').length;

    // Re-run SAME month + SAME volume (scheduler retry / admin "recalculate month") — no second reduction, no duplicate ledger.
    const second = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect((await repo.getPlan('tA', plan.id))!.remainingBalanceCents).toBe(afterFirst);   // idempotent
    const reconLedgerSecond = (await repo.listLedger('tA', second.invoice.id!)).filter((l: any) => l.source === 'reconciliation').length;
    expect(reconLedgerSecond).toBe(reconLedgerFirst);                          // reconciliation rows not duplicated

    // Re-run at a CORRECTED (higher) volume — principal must reflect ONE 8M reduction from the original baseline, not a stack.
    const ref = await svc.createPlan('tB', { status: 'active', monthlyPaymentCents: 1_000, totalHardwareCostCents: 300_000, downPaymentCents: 0, extraCreditHandling: 'apply_to_principal_balance' });
    const refStart = (await repo.getPlan('tB', ref.id))!.remainingBalanceCents;
    await svc.reconcile('tB', ref.id, '2026-06', 8_000_000);
    const refReduction = refStart - (await repo.getPlan('tB', ref.id))!.remainingBalanceCents;
    await svc.reconcile('tA', plan.id, '2026-06', 8_000_000);
    expect((await repo.getPlan('tA', plan.id))!.remainingBalanceCents).toBe(startBalance - refReduction);
  });

  it('does NOT charge when the credit covers the monthly due', async () => {
    const { svc, charges } = harness(true);
    const plan = await activePlan(svc, 'tA', 9_000);            // $90 due < $97.50 credit
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1111' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'o' });
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.shortfallCents).toBe(0);
    expect(out.invoice.status).toBe('credit_applied');
    expect(charges).toHaveLength(0);
  });

  it('a missing payment method blocks the charge and raises an alert', async () => {
    const { svc, charges, alerts } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'o' });  // consent but no method
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.invoice.status).toBe('payment_method_required');
    expect(charges).toHaveLength(0);
    expect(alerts.some((a) => a.code === 'hardware_payment_method_required')).toBe(true);
  });

  it('a missing autopay consent blocks the charge', async () => {
    const { svc, charges } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' }); // method but no consent
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.invoice.status).toBe('payment_method_required');
    expect(charges).toHaveLength(0);
  });

  it('a failed charge marks the invoice payment_failed and raises a critical alert', async () => {
    const { svc, alerts } = harness(false);                    // charge port declines
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'o' });
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.invoice.status).toBe('payment_failed');
    expect(alerts.some((a) => a.severity === 'critical' && a.code === 'hardware_shortfall_charge_failed')).toBe(true);
  });

  it('writes ledger entries whose platform + fiserv shares sum to net margin', async () => {
    const { svc } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'o' });
    await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    const ledger = await svc.adminLedger('tA');
    const get = (t: string) => ledger.find((l) => l.entryType === t)?.amountCents ?? 0;
    expect(get('platform_share') + get('fiserv_share')).toBe(get('net_margin'));
    expect(ledger.some((l) => l.entryType === 'shortfall_charge')).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    const { svc } = harness(true);
    const planA = await activePlan(svc, 'tA', 25_000);
    await activePlan(svc, 'tB', 25_000);
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' });
    await svc.recordAutopayConsent('tA', planA.id, { userId: 'o' });
    await svc.reconcile('tA', planA.id, '2026-06', 5_000_000);
    expect((await svc.adminInvoices('tB'))).toHaveLength(0);          // tA's invoice never appears under tB
    await expect(svc.getPlan('tB', planA.id)).rejects.toThrow(/not found/i); // can't read tA's plan as tB
  });

  it('a per-tenant split override changes the math (Super-Admin only)', async () => {
    const { svc } = harness(true);
    const plan = await activePlan(svc, 'tA', 25_000);
    await svc.updateTenantSettings('tA', { salonHardwareCreditPercentOfPlatformShare: 50 }); // double the credit
    await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: 'tok', last4: '1' });
    await svc.recordAutopayConsent('tA', plan.id, { userId: 'o' });
    const out = await svc.reconcile('tA', plan.id, '2026-06', 5_000_000);
    expect(out.breakdown.salonHardwareCreditCents).toBe(19_500);  // 50% of $390 = $195
    expect(out.shortfallCents).toBe(5_500);                       // $250 - $195
  });

  it('rejects raw card data — tokenized only (§11)', async () => {
    const { svc } = harness(true);
    await expect(svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: '4111111111111111' })).rejects.toThrow(/raw card/i);
    // …while a CardSecure token (16 digits beginning with 9) IS accepted — the old /^\d{13,19}$/ guard refused it too
    const { svc: svc2, repo } = harness(true);
    const ok = await svc2.addPaymentMethod('tA', { gatewayPaymentMethodToken: '9418594164541111', brand: 'visa', last4: '1111' });
    expect((await repo.getActivePaymentMethod('tA'))?.gatewayPaymentMethodToken).toBe('9418594164541111');   // stored for the autopay charge
    expect(ok).toMatchObject({ brand: 'visa', last4: '1111', status: 'active' });
  });

  it('Phase 12 #19: the add-card RESPONSE never echoes the gateway token (the owner screen reads nothing from it)', async () => {
    const { svc } = harness(true);
    const res = await svc.addPaymentMethod('tA', { gatewayPaymentMethodToken: '9418594164541111', brand: 'visa', last4: '1111', expMonth: 12, expYear: 2029 });
    expect(JSON.stringify(res)).not.toContain('9418594164541111');
    expect(Object.keys(res).sort()).toEqual(['brand', 'expMonth', 'expYear', 'id', 'last4', 'status']);
  });
});
