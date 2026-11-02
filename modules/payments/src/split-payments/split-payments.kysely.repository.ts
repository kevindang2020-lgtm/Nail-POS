// split-payments.kysely.repository.ts — Kysely adapter. Tenant/branch scoped from ctx. Loads recent
// revenue-bearing payments joined to tickets (number + customer) so the pure builder can group by ticket.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SplitPaymentsContext, RawPayment } from './split-payments.dto';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';
import type { SplitPaymentsRepositoryPort } from './split-payments.repository';

export class KyselySplitPaymentsRepository implements SplitPaymentsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: SplitPaymentsContext): any {
    let q = qb.where('payments.tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('payments.branch_id', '=', ctx.branchId), eb('payments.branch_id', 'is', null)]));
    return q;
  }
  async listPayments(ctx: SplitPaymentsContext): Promise<RawPayment[]> {
    const rows = await this.scoped(
      this.db.selectFrom('payments')
        .leftJoin('tickets', 'tickets.id', 'payments.ticket_id')
        .leftJoin('customers', 'customers.id', 'tickets.customer_id'), ctx,
    )
      .where('payments.status', 'in', REVENUE_BEARING_STATUSES as unknown as string[])
      .select([
        'payments.id as id', 'payments.ticket_id as ticket_id', 'payments.method as method',
        'payments.amount_cents as amount_cents', 'payments.status as status', 'payments.created_at as created_at',
        'tickets.ticket_number as ticket_number', 'customers.full_name as customer_name',
      ])
      .orderBy('payments.created_at', 'desc').limit(2000).execute();   // Split Payments mandate (Oct 29 2026): a read error throws — it used to answer an empty list, which the screen showed as a verified 0
    return (rows as any[]).map((p) => ({
      id: String(p.id), ticketId: p.ticket_id ? String(p.ticket_id) : null,
      ticketNumber: p.ticket_number != null ? String(p.ticket_number) : null,
      customerName: p.customer_name ? String(p.customer_name) : null,
      method: String(p.method || ''), amountCents: Number(p.amount_cents || 0), status: String(p.status || ''),
      createdAt: p.created_at ? new Date(p.created_at).toISOString() : '',
    }));
  }
}
