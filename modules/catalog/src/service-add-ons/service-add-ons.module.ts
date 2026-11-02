import { Module } from '@nestjs/common';
import { ServiceAddOnsController } from './service-add-ons.controller';
import { ServiceAddOnsService } from './service-add-ons.service';
import { ServicesModule } from '../services/services.module';
import { ServicesService } from '../services/services.service';

@Module({
  imports: [ServicesModule],
  controllers: [ServiceAddOnsController],
  providers: [
    { provide: ServiceAddOnsService, useFactory: (s: ServicesService) => new ServiceAddOnsService(s), inject: [ServicesService] },
  ],
  exports: [ServiceAddOnsService],
})
export class ServiceAddOnsModule {}
