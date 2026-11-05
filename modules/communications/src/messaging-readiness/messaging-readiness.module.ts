import { Module } from '@nestjs/common';
import { MessagingReadinessService, MessagingReadinessController } from './messaging-readiness.service';

@Module({
  controllers: [MessagingReadinessController],
  providers: [MessagingReadinessService],
  exports: [MessagingReadinessService],
})
export class MessagingReadinessModule {}
