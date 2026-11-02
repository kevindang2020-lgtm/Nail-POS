// ticket-removal.module.ts — wires the high-risk TicketRemovalService over the platform DB, with an audit sink that
// writes to audit_logs (best-effort; the atomic ticket_removed revision is the authoritative record). Behind SuperAdminGuard.
import { SECRET_SEALERS, type SecretSealers } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TicketRemovalService, type RemovalAuditSink } from './ticket-removal.service';
import { TicketRemovalKyselyRepository } from './ticket-removal.kysely.repository';
import { TicketRemovalController } from './ticket-removal.controller';

@Module({
  controllers: [TicketRemovalController],
  providers: [
    {
      provide: TicketRemovalService,
      useFactory: (db: AppDatabase, sealers: SecretSealers) => {
        const audit: RemovalAuditSink = {
          record: async (a) => {
            if (!db) return;
            try {
              await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
                VALUES (${null}, ${null}, ${a.userId ?? null}, ${'SUPER_ADMIN'}, ${a.actionType}, ${a.entityType ?? null}, ${a.entityId ?? null}, ${a.ip ?? null}::inet, ${JSON.stringify(a.metadata || {})}::jsonb)`.execute(db);
            } catch { /* audit best-effort; the ticket_removed revision is the atomic record */ }
          },
        };
        return new TicketRemovalService(new TicketRemovalKyselyRepository(db), audit, sealers.forPurpose('ticket_deletion'));
      },
      inject: [DATABASE, SECRET_SEALERS],
    },
  ],
  exports: [TicketRemovalService],
})
export class TicketRemovalModule {}
