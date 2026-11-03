// AI Business Reports + Alerts guides (Nov 3 2026): the center replaces these client methods — they are retired.
import { describe, it, expect } from 'vitest';
import { posAiBusinessApi } from './posAiBusinessApi';
describe('posAiBusinessApi — retired methods', () => {
  it.each(['reportsList', 'reportGet', 'reportCreate', 'alertsList', 'alertEvaluate'])('%s is gone', (k) => {
    expect((posAiBusinessApi as Record<string, unknown>)[k]).toBeUndefined();
  });
  it('the center and the rule editor remain', () => {
    expect(typeof posAiBusinessApi.center.reports).toBe('function');
    expect(typeof posAiBusinessApi.center.evaluate).toBe('function');
    expect(typeof posAiBusinessApi.alertCreate).toBe('function');
    expect(typeof posAiBusinessApi.alertDelete).toBe('function');
  });
});
