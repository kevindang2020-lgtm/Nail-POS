import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './legal-documents.service';
import { KyselyLegalDocsRepo, InMemoryLegalDocsRepo, type LegalDocsRepo } from './legal-documents.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [LegalDocumentsController],
  providers: [
    { provide: 'LegalDocsRepo', useFactory: (db: AppDatabase): LegalDocsRepo => (db ? new KyselyLegalDocsRepo(db) : new InMemoryLegalDocsRepo()), inject: [DATABASE] },
    { provide: LegalDocumentsService, useFactory: (repo: LegalDocsRepo, db: AppDatabase) => new LegalDocumentsService(repo, db || undefined), inject: ['LegalDocsRepo', DATABASE] },
  ],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
