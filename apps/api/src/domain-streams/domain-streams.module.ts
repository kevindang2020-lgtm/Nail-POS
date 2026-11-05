// domain-streams.module.ts — the per-audience SSE endpoints (GET /tech/stream, GET /customer/stream) are an API
// COMPOSITION adapter: they join the realtime transport to a domain, so they live in neither. Not in realtime/ (a
// platform directory importing domains is a §101 back-edge — the architecture gate refused my first placement), not in
// the domains (Constitution 13 §94/§105): RealtimeStreamFactory is the API's SSE machinery
// (connect limits, session revalidation, presence, graceful drain), and a domain module must not import it. Each
// endpoint only asks its domain which rooms the caller may join, through the domain's data port.
import { Module } from '@nestjs/common';
import { TechModule } from '@aipowersalon/queue';
import { CustomerModule } from '../customer/customer.module';
import { TechRealtimeController } from './tech-realtime.controller';
import { CustomerRealtimeController } from './customer-realtime.controller';
import { OwnerRealtimeController } from './owner-realtime.controller';
import { OwnerModule } from '@aipowersalon/analytics';

@Module({ imports: [TechModule, CustomerModule, OwnerModule], controllers: [TechRealtimeController, CustomerRealtimeController, OwnerRealtimeController] })
export class DomainStreamsModule {}
