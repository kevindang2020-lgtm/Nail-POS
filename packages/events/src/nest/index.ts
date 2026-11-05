// @aipowersalon/events/nest — EventsCoreModule provides the OutboxWriter a domain module injects to write events
// inside its own transaction. Factory-registered (the check:boot lesson: bare classes with defaulted ctor params fail
// Nest DI). The API's EventsModule imports this and adds the publisher pipeline and the event-ops surface.
import { Module } from '@nestjs/common';
import { OutboxWriter } from '../outbox-writer';

@Module({
  providers: [{ provide: OutboxWriter, useFactory: () => new OutboxWriter() }],
  exports: [OutboxWriter],
})
export class EventsCoreModule {}
