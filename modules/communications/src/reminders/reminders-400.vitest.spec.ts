// reminders-400 — Security Deep Scan §163 run 3 (Oct 27 2026): PATCH /pos/reminders with a reminder ladder of 0 or 6+ rungs
// (or a rung out of range) threw the service's ValidationError, which nothing mapped → 500. It is a 400 VALIDATION_FAILED.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { PosRemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

describe('§163 run 3 — reminder ladder', () => {
  it('a ladder the service refuses is 400 VALIDATION_FAILED with the reason', async () => {
    const ctl = new PosRemindersController(Object.create(RemindersService.prototype));
    for (const ladderMinutes of [[], [60, 120, 180, 240, 300, 360], [1], ["' OR '1'='1"] as any]) {
      let e: unknown; try { await ctl.update({ ladderMinutes }, { ctx: { tenantId: 't1' } }); } catch (x) { e = x; }
      expect(e, JSON.stringify(ladderMinutes)).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(400);
      expect((e as HttpException).getResponse()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});
