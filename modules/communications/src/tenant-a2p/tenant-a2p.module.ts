import { Module } from '@nestjs/common';
import { AuditModule } from '@aipowersalon/audit';
import { TenantA2pService } from './tenant-a2p.service';
import { TenantA2pController } from './tenant-a2p.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantA2pController],
  providers: [TenantA2pService],
  exports: [TenantA2pService],
})
export class TenantA2pModule {}
