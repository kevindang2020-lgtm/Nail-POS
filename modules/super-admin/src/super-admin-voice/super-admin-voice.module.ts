// super-admin-voice.module.ts — admin management surface for the voice receptionist. Reuses the services exported by
// VoiceBookingModule (keys, call outcomes, learning) rather than re-providing them, so there's one source of truth.
import { Module } from '@nestjs/common';
import { VoiceBookingModule } from '@aipowersalon/ai';
import { SuperAdminVoiceController } from './super-admin-voice.controller';

@Module({
  imports: [VoiceBookingModule],
  controllers: [SuperAdminVoiceController],
})
export class SuperAdminVoiceModule {}
