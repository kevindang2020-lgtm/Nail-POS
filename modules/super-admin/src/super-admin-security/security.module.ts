import { SECURITY_POSTURE, PLATFORM_LOCKDOWN, type SecurityPosturePort, type PlatformLockdownPort } from '@aipowersalon/security';   // provided by the API (Constitution 13 §94)
import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { InMemorySecurityRepository, type SecurityRepositoryPort } from './security.repository';
import { KyselySecurityRepository } from './security.kysely.repository';
import { SessionRevokeController } from './session-revoke.controller';
import { SessionRevokeService } from './session-revoke.service';
import { InMemorySessionRevokeRepository, type SessionRevokeRepositoryPort } from './session-revoke.repository';
import { KyselySessionRevokeRepository } from './session-revoke.kysely.repository';
import { IpBlockController } from './ip-block.controller';
import { IpBlockService } from './ip-block.service';
import { InMemoryIpBlockRepository, type IpBlockRepositoryPort } from './ip-block.repository';
import { KyselyIpBlockRepository } from './ip-block.kysely.repository';
import { IncidentController } from './incident.controller';
import { IncidentService } from './incident.service';
import { AuditEngineService, AuditEngineScheduler } from './audit-engine.service';
import { AuditEngineController } from './audit-engine.controller';
import type { AuditEngineRepositoryPort } from './audit-engine.repository';
import { InMemoryAuditEngineRepository } from './audit-engine.repository';
import { KyselyAuditEngineRepository } from './audit-engine.kysely.repository';
import { InMemoryIncidentRepository, type IncidentRepositoryPort } from './incident.repository';
import { KyselyIncidentRepository } from './incident.kysely.repository';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { InMemoryPolicyRepository, type PolicyRepositoryPort } from './policy.repository';
import { KyselyPolicyRepository } from './policy.kysely.repository';
import { LockdownController } from './lockdown.controller';
import { LockdownService } from './lockdown.service';
import { InMemoryLockdownRepository, type LockdownRepositoryPort } from './lockdown.repository';
import { KyselyLockdownRepository } from './lockdown.kysely.repository';
import { GrantController } from './grant.controller';
import { GrantService } from './grant.service';
import { InMemoryGrantRepository, type GrantRepositoryPort } from './grant.repository';
import { KyselyGrantRepository } from './grant.kysely.repository';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { InMemoryRetentionRepository, type RetentionRepositoryPort } from './retention.repository';
import { KyselyRetentionRepository } from './retention.kysely.repository';
import { DATABASE, DATABASE_WORKER, type AppDatabase } from '@aipowersalon/database';
import { RetentionExecutorService } from './retention-executor.service';
import { RetentionExecutorScheduler } from './retention-executor.scheduler';

@Module({
  controllers: [SecurityController, SessionRevokeController, IpBlockController, IncidentController, PolicyController, LockdownController, GrantController, RetentionController, AuditEngineController],
  providers: [
    { provide: 'SecurityRepositoryPort', useFactory: (db: AppDatabase): SecurityRepositoryPort => (db ? new KyselySecurityRepository(db) : new InMemorySecurityRepository()), inject: [DATABASE] },
    { provide: SecurityService, useFactory: (repo: SecurityRepositoryPort, posture?: SecurityPosturePort) => new SecurityService(repo, posture), inject: ['SecurityRepositoryPort', { token: SECURITY_POSTURE, optional: true }] },
    { provide: 'SessionRevokeRepositoryPort', useFactory: (db: AppDatabase): SessionRevokeRepositoryPort => (db ? new KyselySessionRevokeRepository(db) : new InMemorySessionRevokeRepository()), inject: [DATABASE] },
    { provide: SessionRevokeService, useFactory: (repo: SessionRevokeRepositoryPort) => new SessionRevokeService(repo), inject: ['SessionRevokeRepositoryPort'] },
    { provide: 'IpBlockRepositoryPort', useFactory: (db: AppDatabase): IpBlockRepositoryPort => (db ? new KyselyIpBlockRepository(db) : new InMemoryIpBlockRepository()), inject: [DATABASE] },
    { provide: IpBlockService, useFactory: (repo: IpBlockRepositoryPort) => new IpBlockService(repo), inject: ['IpBlockRepositoryPort'] },
    { provide: 'AuditEngineRepositoryPort', useFactory: (db: AppDatabase): AuditEngineRepositoryPort => (db ? new KyselyAuditEngineRepository(db) : new InMemoryAuditEngineRepository()), inject: [DATABASE] },
    { provide: AuditEngineService, useFactory: (repo: AuditEngineRepositoryPort, incidents: IncidentService, db: AppDatabase) => new AuditEngineService(repo, incidents, db ?? undefined), inject: ['AuditEngineRepositoryPort', IncidentService, DATABASE] },
    AuditEngineScheduler,
    { provide: 'IncidentRepositoryPort', useFactory: (db: AppDatabase): IncidentRepositoryPort => (db ? new KyselyIncidentRepository(db) : new InMemoryIncidentRepository()), inject: [DATABASE] },
    { provide: IncidentService, useFactory: (repo: IncidentRepositoryPort) => new IncidentService(repo), inject: ['IncidentRepositoryPort'] },
    { provide: 'PolicyRepositoryPort', useFactory: (db: AppDatabase): PolicyRepositoryPort => (db ? new KyselyPolicyRepository(db) : new InMemoryPolicyRepository()), inject: [DATABASE] },
    { provide: PolicyService, useFactory: (repo: PolicyRepositoryPort) => new PolicyService(repo), inject: ['PolicyRepositoryPort'] },
    { provide: 'LockdownRepositoryPort', useFactory: (db: AppDatabase): LockdownRepositoryPort => (db ? new KyselyLockdownRepository(db) : new InMemoryLockdownRepository()), inject: [DATABASE] },
    { provide: LockdownService, useFactory: (repo: LockdownRepositoryPort, revoke: SessionRevokeService, platform?: PlatformLockdownPort | null) => new LockdownService(repo, revoke, platform ?? undefined), inject: ['LockdownRepositoryPort', SessionRevokeService, { token: PLATFORM_LOCKDOWN, optional: true }] },
    { provide: 'GrantRepositoryPort', useFactory: (db: AppDatabase): GrantRepositoryPort => (db ? new KyselyGrantRepository(db) : new InMemoryGrantRepository()), inject: [DATABASE] },
    { provide: GrantService, useFactory: (repo: GrantRepositoryPort) => new GrantService(repo), inject: ['GrantRepositoryPort'] },
    { provide: 'RetentionRepositoryPort', useFactory: (db: AppDatabase): RetentionRepositoryPort => (db ? new KyselyRetentionRepository(db) : new InMemoryRetentionRepository()), inject: [DATABASE] },
    { provide: RetentionService, useFactory: (repo: RetentionRepositoryPort) => new RetentionService(repo), inject: ['RetentionRepositoryPort'] },
    // Constitution 1 §57 (Phase 10): the central retention executor — batches run on the worker pool when there is one.
    { provide: RetentionExecutorService, useFactory: (db: AppDatabase, worker?: AppDatabase) => new RetentionExecutorService((worker ?? db) as any), inject: [DATABASE, { token: DATABASE_WORKER, optional: true }] },
    RetentionExecutorScheduler,
  ],
  exports: [AuditEngineService, SecurityService, SessionRevokeService, IpBlockService, IncidentService, PolicyService, LockdownService, GrantService, RetentionService, RetentionExecutorService],
})
export class SecurityModule {}
