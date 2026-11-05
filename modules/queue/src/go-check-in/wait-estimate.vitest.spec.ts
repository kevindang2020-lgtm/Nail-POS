// wait-estimate.vitest.spec — the check-in response only carries a wait estimate the salon allows.
//
// CORRECTION RECORDED HERE, not just in a commit message: this began as a suspected bug ("switching the estimate off
// changed nothing a customer saw"). That was WRONG. The kiosk receives every setting in its config and already checks
// showWaitEstimate before displaying anything, so customers were never shown a hidden estimate. What this adds is
// defence in depth: the SERVER no longer sends the value at all when it is hidden, so a future client that forgets the
// check cannot leak it.
import { describe, it, expect } from 'vitest';
import { waitEstimateFor } from './go-check-in.service';

describe('the wait estimate is withheld server-side when the salon hides it', () => {
  it('estimate ON → the quoted minutes are sent', () => expect(waitEstimateFor({ showWaitEstimate: true }, 15)).toBe(15));
  it('estimate OFF → nothing is sent, not merely hidden by the kiosk', () => expect(waitEstimateFor({ showWaitEstimate: false }, 15)).toBeUndefined());
  it('an unset flag keeps the existing default of showing it', () => expect(waitEstimateFor({}, 15)).toBe(15));
  it('a non-numeric quote is never sent as if it were a wait', () => {
    expect(waitEstimateFor({ showWaitEstimate: true }, null)).toBeUndefined();
    expect(waitEstimateFor({ showWaitEstimate: true }, Number.NaN)).toBeUndefined();
  });
});
