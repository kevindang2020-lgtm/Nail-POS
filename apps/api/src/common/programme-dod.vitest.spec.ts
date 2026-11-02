// programme-dod — the programme total (scripts/programme-dod.mjs, BUILD_PLAN Phase 15) is read from each DoD script's
// totals line. If a script changes its line and the parser stops matching, a status would silently count as 0 — these
// cases pin every format the four scripts print, and a sum check in the script refuses a row whose kinds don't add up.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { parseTotals } from '../../scripts/programme-dod.mjs';

describe('programme-dod parseTotals', () => {
  it('reads the dod-lib format (C11 / C12)', () => {
    expect(parseTotals('x\n\n§396: 70 DONE · 6 HOSTING (Kevin) · 0 PARTIAL · 0 NOT DONE of 76\n')).toEqual({ section: '396', total: 76, DONE: 70, HOSTING: 6, DECIDED: 0, PARTIAL: 0, 'NOT DONE': 0 });
  });
  it('reads the dod-lib format with DECIDED', () => {
    expect(parseTotals('§324: 70 DONE · 11 HOSTING (Kevin) · 1 DECIDED · 0 PARTIAL · 0 NOT DONE of 82')).toMatchObject({ DONE: 70, HOSTING: 11, DECIDED: 1, total: 82 });
  });
  it('reads the control-plane format (C7)', () => {
    expect(parseTotals('§303: 71 DONE · 2 DECIDED · 0 PARTIAL · 0 NOT DONE of 73')).toMatchObject({ section: '303', DONE: 71, DECIDED: 2, HOSTING: 0, PARTIAL: 0, 'NOT DONE': 0, total: 73 });
  });
  it('reads the AI format (C10) and does not confuse NOT DONE with DONE', () => {
    expect(parseTotals('DONE 71 · HOSTING 1\n§304: 71 DONE · 1 HOSTING (Kevin) · 0 PARTIAL · 3 NOT DONE of 75')).toMatchObject({ DONE: 71, HOSTING: 1, 'NOT DONE': 3, total: 75 });
  });
  it('returns null when there is no totals line', () => {
    expect(parseTotals('DONE 70 · PARTIAL 1 · NOT DONE 1')).toBeNull();
  });
});
