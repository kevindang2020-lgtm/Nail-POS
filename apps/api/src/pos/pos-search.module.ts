// pos-search.module.ts — wires the (previously orphaned) tenant-safe PosSearchService to a real
// tenant-scoped repo + the /pos/search controller. Audit writes only on result-open.
import { Module } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PosSearchService, type PosSearchAuditEntry } from './pos-search.service';
import { PosSearchKyselyRepository } from './pos-search.kysely.repository';
import { PosSearchController } from './pos-search.controller';

@Module({
  controllers: [PosSearchController],
  providers: [
    {
      provide: PosSearchService,
      useFactory: (db: AppDatabase) => new PosSearchService(
        new PosSearchKyselyRepository(db),
        {
          audit: { record: async (a: PosSearchAuditEntry) => { if (!db) return; try {
            await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${a.tenantId}, ${a.branchId ?? null}, ${a.userId}, ${a.role}, ${a.actionType}, ${a.entityType ?? null}, ${a.entityId ?? null}, ${JSON.stringify(a.metadata || {})}::jsonb)`.execute(db as any);
          } catch { /* audit best-effort */ } } },
          clock: { iso: () => new Date().toISOString() },
        },
      ),
      inject: [DATABASE],
    },
  ],
  exports: [PosSearchService],
})
export class PosSearchModule {}
