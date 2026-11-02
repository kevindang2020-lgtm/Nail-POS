import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TwilioInboundService } from './twilio-inbound.service';
import { TwilioInboundController } from './twilio-inbound.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [TwilioInboundController],
  providers: [TwilioInboundService],
  exports: [TwilioInboundService],
})
export class MessagingInboundModule {}
