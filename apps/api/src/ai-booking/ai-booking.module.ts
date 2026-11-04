// ai-booking.module.ts — the shared AI Booking Assistant. Reuses BookingService (authoritative engine) and the Copilot
// ranking intelligence; adds trusted context/source resolution and conversion tracking. No parallel booking store.
import { CustomerBookingModule, BookingModule } from '@aipowersalon/booking';
import { Module } from '@nestjs/common';
// The booking-verification GUARD lives here and is exported. The public booking page injects the SAME instance
// the customer app and the AI receptionist use — one gate, three channels, so none of them can drift.
import { AiCenterModule } from '@aipowersalon/ai';
import { RateLimitModule } from '../common/rate-limit.module';
import { AiBookingService } from './ai-booking.service';
import { AiBookingMutationService } from './ai-booking-mutation.service';
import { AiBookingConversionService } from './ai-booking-conversion.service';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';
import { AiBookingLinkService } from './ai-booking-link.service';
import { AiBookingRevocationService } from './ai-booking-revocation.service';
import { AiBookingController } from './ai-booking.controller';
import { AiBookingPublicController } from './ai-booking-public.controller';
import { AiBookingAdminController } from './ai-booking-admin.controller';
import { AiBookingCenterController } from './ai-booking-center.controller';

@Module({
  imports: [BookingModule, AiCenterModule, RateLimitModule, CustomerBookingModule],
  controllers: [AiBookingController, AiBookingPublicController, AiBookingAdminController, AiBookingCenterController],
  providers: [AiBookingService, AiBookingMutationService, AiBookingConversionService, AiBookingPublicResolver, AiBookingLinkService, AiBookingRevocationService],  exports: [AiBookingService, AiBookingMutationService, AiBookingConversionService],
})
export class AiBookingModule {}
