// Constitution 7 §78 — the support session extension rule.
import { describe, it, expect } from 'vitest';
import { decideExtension, MAX_EXTENSIONS, MAX_TOTAL_MINUTES } from './support-access-notice';

const now = new Date('2026-09-28T10:00:00Z');
const at = (m: number) => new Date(now.getTime() + m * 60_000);
const live = (over: Partial<Parameters<typeof decideExtension>[0]> = {}) => ({ startedAt: at(-20), expiresAt: at(10), endedAt: null, extensionCount: 0, ...over });
const R = 'still reproducing the booking bug';

describe('support session extension (§78)', () => {
  it('extends a live session by 15–60 minutes with a reason', () => {
    expect(decideExtension(live(), 30, R, now)).toEqual({ ok: true, newExpiresAt: at(40) });
  });
  it('needs a reason, a sane length, and a live session', () => {
    expect(decideExtension(live(), 30, 'more time', now)).toMatchObject({ ok: false, error: /at least 10/ });
    expect(decideExtension(live(), 240, R, now)).toMatchObject({ ok: false, error: /15–60/ });
    expect(decideExtension(live({ expiresAt: at(-1) }), 30, R, now)).toMatchObject({ ok: false, error: /already ended/ });
    expect(decideExtension(live({ endedAt: at(-2) }), 30, R, now)).toMatchObject({ ok: false, error: /already ended/ });
  });
  it(`never silently indefinite: at most ${MAX_EXTENSIONS} extensions and ${MAX_TOTAL_MINUTES} minutes in total`, () => {
    expect(decideExtension(live({ extensionCount: MAX_EXTENSIONS }), 15, R, now)).toMatchObject({ ok: false, error: /at most 2 times/ });
    expect(decideExtension(live({ startedAt: at(-100), expiresAt: at(10) }), 30, R, now)).toMatchObject({ ok: false, error: /2 hours/ });
    expect(decideExtension(live({ startedAt: at(-100), expiresAt: at(10) }), 15, R, now)).toMatchObject({ ok: false });
    expect(decideExtension(live({ startedAt: at(-90), expiresAt: at(10) }), 20, R, now)).toMatchObject({ ok: true });   // exactly 120
  });
});
