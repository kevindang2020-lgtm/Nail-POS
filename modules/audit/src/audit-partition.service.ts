// audit-partition.service.ts — keeps upcoming monthly audit_events partitions provisioned. Safe on ANY database: it
// first checks whether audit_events is actually partitioned (pg_partitioned_table); if not (the table hasn't been
// converted via db/maintenance/audit_events_partition.sql), it does nothing. When it is partitioned, it creates the
// current + next N months' partitions with IF NOT EXISTS (idempotent). Runs once on boot and can be called on a
// schedule. Never throws into boot — partition upkeep is best-effort.
import { Injectable, Inject, Optional, Module, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { upcomingMonths, ensurePartitionSql } from './audit-partitions-core';

@Injectable()
export class AuditPartitionService implements OnModuleInit {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async onModuleInit(): Promise<void> { await this.ensureUpcoming(2).catch(() => undefined); }

  async isPartitioned(): Promise<boolean> {
    if (!this.db) return false;
    const res: any = await sql`SELECT 1 FROM pg_partitioned_table pt JOIN pg_class c ON c.oid = pt.partrelid WHERE c.relname = 'audit_events' LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows?.length ?? 0) > 0;
  }

  /** Ensure the current + `ahead` following months exist as partitions. No-op unless audit_events is partitioned. */
  async ensureUpcoming(ahead = 2, now: Date = new Date()): Promise<{ created: string[]; skipped: boolean }> {
    if (!this.db || !(await this.isPartitioned())) return { created: [], skipped: true };
    const created: string[] = [];
    for (const ym of upcomingMonths(now, ahead)) {
      const ddl = ensurePartitionSql(ym);
      await sql`${sql.raw(ddl)}`.execute(this.db as any).catch(() => undefined);
      created.push(ddl.match(/audit_events_\d{4}_\d{2}/)?.[0] ?? '');
    }
    return { created, skipped: false };
  }
}

@Module({ providers: [AuditPartitionService], exports: [AuditPartitionService] })
export class AuditPartitionModule {}
