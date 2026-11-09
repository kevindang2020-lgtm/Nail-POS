// customer-notes.module.ts — Customer Notes SUNMI guide (Nov 9 2026): the salon-wide notes workspace over the notes staff
// already keep. Postgres only — without a database the controller answers 503 SERVICE_UNAVAILABLE (never "no notes").
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CustomerNotesCenter } from './customer-notes-center';
import { CustomerNotesCenterController, CUSTOMER_NOTES_CENTER } from './customer-notes-center.controller';

@Module({
  controllers: [CustomerNotesCenterController],
  providers: [{ provide: CUSTOMER_NOTES_CENTER, useFactory: (db: AppDatabase) => (db ? new CustomerNotesCenter(db) : null), inject: [DATABASE] }],
})
export class CustomerNotesModule {}
