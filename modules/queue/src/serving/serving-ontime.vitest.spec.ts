import { describe, it, expect } from 'vitest';
import { computeOnTimeCompletionPercent } from './serving.dto';

describe('computeOnTimeCompletionPercent', () => {
  it('returns 0 when no ticket has a positive estimate', () => {
    expect(computeOnTimeCompletionPercent([])).toBe(0);
    expect(computeOnTimeCompletionPercent([{ actualMinutes: 30, estimatedMinutes: 0 }])).toBe(0);
  });

  it('counts a service on time when actual does not exceed the estimate', () => {
    const rows = [
      { actualMinutes: 40, estimatedMinutes: 45 }, // on time
      { actualMinutes: 45, estimatedMinutes: 45 }, // on time (equal)
      { actualMinutes: 60, estimatedMinutes: 45 }, // late
      { actualMinutes: 50, estimatedMinutes: 60 }, // on time
    ];
    expect(computeOnTimeCompletionPercent(rows)).toBe(75); // 3 of 4
  });

  it('excludes tickets with no estimate from the denominator', () => {
    const rows = [
      { actualMinutes: 30, estimatedMinutes: 30 }, // judged, on time
      { actualMinutes: 90, estimatedMinutes: 0 },  // not judged
    ];
    expect(computeOnTimeCompletionPercent(rows)).toBe(100); // 1 of 1 judged
  });

  it('rounds to a whole percent', () => {
    const rows = [
      { actualMinutes: 10, estimatedMinutes: 30 },
      { actualMinutes: 50, estimatedMinutes: 30 },
      { actualMinutes: 20, estimatedMinutes: 30 },
    ];
    expect(computeOnTimeCompletionPercent(rows)).toBe(67); // 2 of 3
  });

  it('returns 0 when every judged service ran long', () => {
    expect(computeOnTimeCompletionPercent([{ actualMinutes: 80, estimatedMinutes: 45 }])).toBe(0);
  });
});
