// billing.service.ts — composes the pure aggregator over raw facts + plan prices, and applies subscription updates
// (change plan / set status) through the port. Validation is pure (normalizeSubscriptionUpdate); a missing tenant maps
// to TenantNotFoundError so the controller can return 404.
import { Injectable, Inject } from '@nestjs/common';
import type { BillingDataPort, AuditActor } from './billing.repository';
import { buildBilling, normalizeSubscriptionUpdate } from './billing-core';
import type { BillingResult } from './billing.dto';

export class TenantNotFoundError extends Error {}

@Injectable()
export class SuperAdminBillingService {
  constructor(@Inject('BillingDataPort') private readonly repo: BillingDataPort) {}

  subscriptionsOverview() { return this.repo.subscriptionsOverview(); }
  createInvoice(actor: AuditActor, input: any) { return this.repo.createInvoice(actor, input); }
  finalizeInvoice(actor: AuditActor, invoiceNumber: string) { return this.repo.finalizeInvoice(actor, invoiceNumber); }
  applyCredit(actor: AuditActor, input: { creditId: string; invoiceNumber: string; amountCents: number }) { return this.repo.applyCredit(actor, input); }
  retryPayment(actor: AuditActor, input: { invoiceNumber: string; idempotencyKey: string }) { return this.repo.retryPayment(actor, input); }
  changePlan(actor: AuditActor, input: any) { return this.repo.changePlan(actor, input); }
  changeAddOn(actor: AuditActor, input: any) { return this.repo.changeAddOn(actor, input); }
  extendTrial(actor: AuditActor, input: any) { return this.repo.extendTrial(actor, input); }
  createDiscount(actor: AuditActor, input: any) { return this.repo.createDiscount(actor, input); }
  pauseSubscription(actor: AuditActor, input: any) { return this.repo.pauseSubscription(actor, input); }
  resumeSubscription(actor: AuditActor, input: any) { return this.repo.resumeSubscription(actor, input); }
  cancelSubscription(actor: AuditActor, input: any) { return this.repo.cancelSubscription(actor, input); }
  reviewRequest(actor: AuditActor, input: any) { return this.repo.reviewRequest(actor, input); }
  ingestWebhook(event: any) { return this.repo.ingestWebhook(event); }
  exportReport(actor: AuditActor, input: any) { return this.repo.exportReport(actor, input); }
  tenantBillingProfile(actor: AuditActor, tenantId: string) { return this.repo.tenantBillingProfile(actor, tenantId); }
  createExportJob(actor: AuditActor, input: any) { return this.repo.createExportJob(actor, input); }
  processPendingExportJobs(limit?: number) { return this.repo.processPendingExportJobs(limit); }
  getExportJob(token: string) { return this.repo.getExportJob(token); }
  downloadExportJob(actor: AuditActor, token: string) { return this.repo.downloadExportJob(actor, token); }
  expireStaleExportJobs() { return this.repo.expireStaleExportJobs(); }

  async getBilling(): Promise<BillingResult> {
    const [facts, planPrices] = await Promise.all([this.repo.getFacts(), this.repo.getPlanPrices()]);
    return buildBilling(facts, planPrices);
  }

  // Change a tenant's plan and/or subscription status, then return the refreshed billing snapshot.
  async updateSubscription(tenantId: string, input: { plan?: unknown; status?: unknown }, actor?: AuditActor): Promise<BillingResult> {
    const patch = normalizeSubscriptionUpdate(input); // throws Error on invalid input
    const ok = await this.repo.updateSubscription(tenantId, patch, actor);
    if (!ok) throw new TenantNotFoundError('Tenant not found: ' + tenantId);
    return this.getBilling();
  }
}
