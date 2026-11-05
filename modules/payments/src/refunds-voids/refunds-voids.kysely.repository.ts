// refunds-voids.kysely.repository.ts — Kysely adapter. Tenant/branch scoping server-derived from ctx.
// Loads reversal payment rows (refunded/voided), joining tickets for the ticket number and users for the
// processor name.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { RefundsVoidsContext, ReversalRow } from './refunds-voids.dto';
import { classifyReversal } from './refunds-voids.dto';
import { REFUND_STATUSES } from '@aipowersalon/api-contracts';
import type { RefundsVoidsRepositoryPort } from './refunds-voids.repository';

export class KyselyRefundsVoidsRepository implements RefundsVoidsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: RefundsVoidsContext): any {
    let q = qb.where('payments.tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('payments.branch_id', '=', ctx.branchId), eb('payments.branch_id', 'is', null)]));
    return q;
  }

  async list(ctx: RefundsVoidsContext): Promise<ReversalRow[]> {
    const rows = await this.scoped(
      this.db.selectFrom('payments')
        .leftJoin('tickets', 'tickets.id', 'payments.ticket_id')
        .leftJoin('users', 'users.id', 'payments.created_by_user_id'), ctx,
    )
      .where('payments.status', 'in', REFUND_STATUSES as unknown as string[])
      .select([
        'payments.id as id', 'payments.status as status', 'payments.method as method', 'payments.amount_cents as amount_cents',
        'payments.ticket_id as ticket_id', 'tickets.ticket_number as ticket_number', 'users.full_name as processed_by_name',
        'payments.created_at as created_at',
      ])
      .orderBy('payments.created_at', 'desc').limit(1000).execute().catch(() => [] as any[]);
    return (rows as any[]).map((p) => ({
      id: String(p.id), kind: classifyReversal(p.status), status: String(p.status || ''), method: String(p.method || ''),
      amountCents: Number(p.amount_cents || 0), ticketId: p.ticket_id ? String(p.ticket_id) : null,
      ticketNumber: p.ticket_number != null ? String(p.ticket_number) : null,
      processedByName: p.processed_by_name ? String(p.processed_by_name) : null,
      createdAt: p.created_at ? new Date(p.created_at).toISOString() : '',
    }));
  }
}
