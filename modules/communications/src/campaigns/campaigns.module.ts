// campaigns.module.ts — Campaign Center. Kysely-backed when Postgres is present, else in-memory (dev/offline/tests).
// AuditService is global (injected for durable audit of mutations). Exports the service for cross-module reuse.
import { Module } from '@nestjs/common';
import { CampaignsController, SuperAdminCampaignsController } from './campaigns.controller';
import { CampaignCenter } from './campaign-center';
import { CampaignCenterController, CAMPAIGN_CENTER } from './campaign-center.controller';
import { CampaignsService } from './campaigns.service';
import { InMemoryCampaignsRepository, type CampaignsRepositoryPort } from './campaigns.repository';
import { KyselyCampaignsRepository } from './campaigns.kysely.repository';
import { InMemoryAnnouncementRepo, type AnnouncementRepo } from './platform-announcements.repository';
import { KyselyAnnouncementRepo } from './platform-announcements.kysely.repository';
import { PlatformAnnouncementsService } from './platform-announcements.service';
import { InMemoryComplianceRepo, type ComplianceRepo } from './campaign-compliance.repository';
import { KyselyComplianceRepo } from './campaign-compliance.kysely.repository';
import { CampaignComplianceService } from './campaign-compliance.service';
import { InMemoryDeliveryRepo, type DeliveryRepo } from './campaign-delivery.repository';
import { KyselyDeliveryRepo } from './campaign-delivery.kysely.repository';
import { CampaignDeliveryService } from './campaign-delivery.service';
import { InMemoryTemplateRepo, type TemplateRepo } from './campaign-templates.repository';
import { KyselyTemplateRepo } from './campaign-templates.kysely.repository';
import { CampaignTemplatesService } from './campaign-templates.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { sql } from 'kysely';

const ANNOUNCEMENT_REPO = Symbol('ANNOUNCEMENT_REPO');
const COMPLIANCE_REPO = Symbol('COMPLIANCE_REPO');
const DELIVERY_REPO = Symbol('DELIVERY_REPO');
const TEMPLATE_REPO = Symbol('TEMPLATE_REPO');

@Module({
  controllers: [CampaignsController, SuperAdminCampaignsController, CampaignCenterController],
  providers: [
    { provide: 'CampaignsRepositoryPort', useFactory: (db: AppDatabase): CampaignsRepositoryPort => (db ? new KyselyCampaignsRepository(db) : new InMemoryCampaignsRepository()), inject: [DATABASE] },
    { provide: ANNOUNCEMENT_REPO, useFactory: (db: AppDatabase): AnnouncementRepo => (db ? new KyselyAnnouncementRepo(db) : new InMemoryAnnouncementRepo()), inject: [DATABASE] },
    {
      provide: PlatformAnnouncementsService,
      useFactory: (repo: AnnouncementRepo, db: AppDatabase) => new PlatformAnnouncementsService(repo, async () => {
        if (!db) return 0;
        try { const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM tenants`.execute(db); return Number(r.rows[0]?.n ?? 0); } catch { return 0; }
      }),
      inject: [ANNOUNCEMENT_REPO, DATABASE],
    },
    { provide: COMPLIANCE_REPO, useFactory: (db: AppDatabase): ComplianceRepo => (db ? new KyselyComplianceRepo(db) : new InMemoryComplianceRepo()), inject: [DATABASE] },
    { provide: CampaignComplianceService, useFactory: (repo: ComplianceRepo) => new CampaignComplianceService(repo), inject: [COMPLIANCE_REPO] },
    { provide: DELIVERY_REPO, useFactory: (db: AppDatabase): DeliveryRepo => (db ? new KyselyDeliveryRepo(db) : new InMemoryDeliveryRepo()), inject: [DATABASE] },
    { provide: CampaignDeliveryService, useFactory: (repo: DeliveryRepo) => new CampaignDeliveryService(repo), inject: [DELIVERY_REPO] },
    { provide: TEMPLATE_REPO, useFactory: (db: AppDatabase): TemplateRepo => (db ? new KyselyTemplateRepo(db) : new InMemoryTemplateRepo()), inject: [DATABASE] },
    { provide: CampaignTemplatesService, useFactory: (repo: TemplateRepo) => new CampaignTemplatesService(repo), inject: [TEMPLATE_REPO] },
    // Campaign Center guide (739): raw-SQL read model + draft / approval / launch over the same campaigns rows; the limits
    // pre-check on Launch is the CampaignsService's own (one policy).
    { provide: CAMPAIGN_CENTER, useFactory: (db: AppDatabase, svc: CampaignsService) => (db ? new CampaignCenter(db, (ctx, id) => svc.preflightLimits(ctx, id)) : null), inject: [DATABASE, CampaignsService] },
    { provide: CampaignsService, useFactory: (repo: CampaignsRepositoryPort, audit: AuditService, ann: PlatformAnnouncementsService, comp: CampaignComplianceService, del: CampaignDeliveryService) => new CampaignsService(repo, audit, ann, comp, del), inject: ['CampaignsRepositoryPort', AuditService, PlatformAnnouncementsService, CampaignComplianceService, CampaignDeliveryService] },
  ],
  exports: [CampaignsService, PlatformAnnouncementsService, CampaignComplianceService, CampaignDeliveryService, CampaignTemplatesService],
})
export class CampaignsModule {}
