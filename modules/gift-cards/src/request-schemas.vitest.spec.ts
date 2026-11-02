// BUILD_PLAN Phase 12 (#17): gift-card stock body validation on the real controller.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures } from '@aipowersalon/testing';
import { GiftCardStockController } from './gift-card-stock/gift-card-stock.controller';

describe('gift-cards — validated bodies', () => {
  it('POST /pos/gift-cards/stock/register', () => expect(routeBodyFailures({ route: 'POST /pos/gift-cards/stock/register', ctl: GiftCardStockController, handler: 'register',
    today: [{ numbers: '6011000000001234\n6011000000001235', batchLabel: 'Box 7' }, { numbers: '6011000000001234' }], bad: [{ numbers: ['6011'] }, 'numbers'] }, bodyPipeOf as any)).toEqual([]));
});
