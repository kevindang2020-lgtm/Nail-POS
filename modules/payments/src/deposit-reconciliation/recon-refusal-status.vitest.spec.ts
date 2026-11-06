// recon-refusal-status.vitest.spec — §74 (Nov 5 2026): the reconciliation exception workflow refuses another salon's
// case id with ReconValidationError + RECON_CASE_NOT_FOUND, but the workspace controller's runFinance only knew
// FinanceError, so assign / review / reopen answered 500. The refusal now carries its registry status.
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ReconValidationError, ReconForbiddenError, reconRefusalStatus } from './deposit-reconciliation.service';
import { runFinance } from '../finance-screens/settlements-screen.controller';

describe('reconRefusalStatus', () => {
  it('uses the registry status of the code', () => {
    expect(reconRefusalStatus(withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND'))).toBe(404);
    expect(reconRefusalStatus(withCode(new ReconValidationError('x'), 'RECON_CASE_STATE_INVALID'))).toBe(409);
  });
  it('falls back to 400 / 403 by class, and null for anything else', () => {
    expect(reconRefusalStatus(new ReconValidationError('x'))).toBe(400);
    expect(reconRefusalStatus(new ReconForbiddenError('x'))).toBe(403);
    expect(reconRefusalStatus(new Error('x'))).toBeNull();
  });
});

describe('runFinance maps a reconciliation refusal', () => {
  it("another salon's case id → 404 RECON_CASE_NOT_FOUND (it was a 500)", async () => {
    const err = await runFinance(async () => { throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND'); }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse()).toMatchObject({ code: 'RECON_CASE_NOT_FOUND' });
  });
  it('an unknown error still propagates untouched', async () => {
    const boom = new TypeError('boom');
    await expect(runFinance(async () => { throw boom; })).rejects.toBe(boom);
  });
});
