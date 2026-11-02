// birthday-center.module.ts — Birthday Campaigns (Oct 31 2026). Reuses RetentionRepository (salon timezone / today),
// SegmentsRepository (consent verdicts, unsent audience drafts, the customer overlay) and CampaignCenter (the assistant
// only creates a DRAFT there: its launch path needs the limits preflight, which refuses here, so nothing can be launched).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { RetentionRepository, SegmentsRepository } from '@aipowersalon/customers';
import { CampaignCenter } from '@aipowersalon/communications';
import { BirthdayCenterController, BIRTHDAY_CENTER } from './birthday-center.controller';
import { BirthdayCenter } from './birthday-center';

const noLaunch = async () => { throw new Error('Birthday Campaigns never launches a campaign: approve and launch it in Campaign Center.'); };

@Module({
  controllers: [BirthdayCenterController],
  providers: [
    { provide: BIRTHDAY_CENTER, inject: [DATABASE],
      useFactory: (db: AppDatabase) => { if (!db) return null; const ret = new RetentionRepository(db); return new BirthdayCenter(db, ret, new SegmentsRepository(db, ret), new CampaignCenter(db, noLaunch)); } },
  ],
})
export class BirthdayCenterModule {}
