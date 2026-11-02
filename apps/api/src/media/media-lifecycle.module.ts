// media-lifecycle.module.ts — BUILD_PLAN Phase 11 (Constitution 4 §169): registers the daily `media.lifecycle` job.
import { Module } from '@nestjs/common';
import { MediaLifecycleScheduler } from './media-lifecycle';

@Module({ providers: [MediaLifecycleScheduler] })
export class MediaLifecycleModule {}
