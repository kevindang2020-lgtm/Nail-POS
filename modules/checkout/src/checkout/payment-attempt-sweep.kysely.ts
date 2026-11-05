// payment-attempt-sweep.kysely.ts — Postgres side of the stranded-attempt sweep (payment-attempt-sweep.ts). Every write
// is conditional, so concurrent sweepers (several workers) and the live checkout can never both resolve one attempt.
import { sql, type Kysely } from 'kysely';
import { runWithTenant, transitionStatus, InvalidStateTransitionError } from '@aipowersalon/database';
import { PAYMENT_ATTEMPT } from './payment-attempt-machine';
import type { PaymentAttemptSweepStore, Resolution, StrandedCardPayment, StrandedSplitAttempt, SweepAlert } from './payment-attempt-sweep';

const iso = (v: unknown) => new Date(v as any).toISOString();
const dollars = (cents: number) => '$' + (cents / 100).toFixed(2);

export class KyselyPaymentAttemptSweepStore implements PaymentAttemptSweepStore {
  constructor(private readonly db: Kysely<any>) {}

  async strandedSplitAttempts(cutoff: Date, limit: number): Promise<StrandedSplitAttempt[]> {
    const r = await sql<any>`select id, tenant_id, branch_id, ticket_id, amount_cents, idempotency_key, created_at from payment_attempts
      where status = 'processing' and method <> 'tap_to_pay' and created_at < ${cutoff} order by created_at limit ${limit}`.execute(this.db);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, ticketId: x.ticket_id, amountCents: Number(x.amount_cents), idempotencyKey: x.idempotency_key, createdAt: iso(x.created_at) }));
  }

  async strandedCardPayments(cutoff: Date, limit: number): Promise<StrandedCardPayment[]> {
    const r = await sql<any>`select id, tenant_id, branch_id, ticket_id, amount_cents, created_at, stranded_at from payments
      where status = 'processing' and method = 'card' and created_at < ${cutoff} order by created_at limit ${limit}`.execute(this.db);
    return r.rows.map((x: any) => ({ paymentId: x.id, tenantId: x.tenant_id, branchId: x.branch_id, ticketId: x.ticket_id, amountCents: Number(x.amount_cents), createdAt: iso(x.created_at), strandedAt: x.stranded_at ? iso(x.stranded_at) : null }));
  }

  async recordedRetrefs(tenantId: string, ticketId: string): Promise<Set<string>> {
    const r = await runWithTenant(tenantId, () => sql<any>`select processor_transaction_id from payments where tenant_id = ${tenantId} and ticket_id = ${ticketId} and processor_transaction_id is not null`.execute(this.db));
    return new Set(r.rows.map((x: any) => String(x.processor_transaction_id)));
  }

  async resolveSplitAttempt(a: StrandedSplitAttempt, to: { status: 'settled' | 'failed' | 'needs_review'; resolution: Resolution; releaseKey: boolean }): Promise<boolean> {
    // releaseKey: the reservation's UNIQUE(tenant, idempotency_key) would refuse the cashier's re-run of the same split
    // for ever; renaming the key (instead of deleting the row, as the live decline path does) frees it and keeps the
    // attempt as evidence of what the processor said.
    // Phase 12 (#27): through the payment_attempt machine — the same conditional move (only from 'processing')
    try {
      const r = await transitionStatus(this.db as any, PAYMENT_ATTEMPT, { where: { id: a.id, tenant_id: a.tenantId }, from: 'processing', to: to.status, set: {
        resolution: to.resolution, stranded_at: sql`coalesce(stranded_at, now())`, resolved_at: sql`now()`, updated_at: sql`now()`,
        idempotency_key: sql`case when ${to.releaseKey} then idempotency_key || '#released:' || id::text else idempotency_key end`,
      } });
      return r !== null;
    } catch (e) { if (e instanceof InvalidStateTransitionError) return false; throw e; }
  }

  async markCardPaymentStranded(p: StrandedCardPayment): Promise<boolean> {
    const r = await runWithTenant(p.tenantId, () => sql<any>`update payments set stranded_at = now() where id = ${p.paymentId} and tenant_id = ${p.tenantId}
        and status = 'processing' and stranded_at is null returning id`.execute(this.db));
    return r.rows.length === 1;
  }

  async raiseAlert(al: SweepAlert): Promise<void> {
    const what = al.kind === 'split_attempt' ? 'A split card payment' : 'A card payment';
    const body = `${what} of ${dollars(al.amountCents)} needs review: ${al.detail}`;
    const meta = { kind: al.kind, id: al.id, ticketId: al.ticketId, amountCents: al.amountCents, resolution: al.resolution, ...(al.retref ? { processorReference: al.retref } : {}) };
    // The salon's alert (Owner app → Alerts). Alerts never block the sweep.
    await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
      values (${al.tenantId}, ${al.branchId}, 'payment_review', 'high', 'new', 'PAYMENT_NEEDS_REVIEW', ${body}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db).catch(() => undefined);
    // The platform's alert (Super Admin → Alerts, incident-style): one per attempt, whatever happens on later ticks.
    await sql`insert into alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
      select ${al.tenantId}, (select coalesce(display_name, legal_name) from tenants where id = ${al.tenantId}), ${'Payment needs review'}, ${body}, 'payment', 'high', 'unread', 'payments', ${al.id}, ${'payment_review:' + al.id}
      on conflict (dedupe_key) do nothing`.execute(this.db).catch(() => undefined);
  }
}
