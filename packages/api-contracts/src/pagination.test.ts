// Verifies the shared pagination clamps (Roadmap Phase 1.4). The property that matters most is the ceiling: a client
// can never request more than MAX_PAGE_SIZE rows, however large a number they send.
import { describe, it, expect } from 'vitest';
import { clampPageSize, clampPage, clampLimit, MAX_PAGE_SIZE } from './pagination';

describe('pagination clamps', () => {
  it('clampPageSize caps oversized requests at MAX_PAGE_SIZE', () => {
    expect(clampPageSize(1_000_000, 20)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize('9999', 20)).toBe(MAX_PAGE_SIZE);
  });

  it('clampPageSize honors the requested size when within bounds', () => {
    expect(clampPageSize(25, 20)).toBe(25);
    expect(clampPageSize(1, 20)).toBe(1);
  });

  it('clampPageSize falls back to the default for missing/invalid input, and never returns < 1', () => {
    expect(clampPageSize(undefined, 20)).toBe(20);
    expect(clampPageSize('abc', 50)).toBe(50);
    expect(clampPageSize(0, 20)).toBe(1);
    expect(clampPageSize(-5, 20)).toBe(1);
  });

  it('clampPageSize respects a per-endpoint cap but never above the global ceiling', () => {
    expect(clampPageSize(80, 20, 50)).toBe(50);           // endpoint cap of 50
    expect(clampPageSize(500, 20, 1000)).toBe(MAX_PAGE_SIZE); // requested cap can't exceed the global ceiling
  });

  it('clampPage floors at 1 and rejects garbage', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-3)).toBe(1);
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage(7)).toBe(7);
  });

  it('clampLimit caps a bare list limit at MAX_PAGE_SIZE', () => {
    expect(clampLimit(10_000, 50)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(30, 50)).toBe(30);
    expect(clampLimit(undefined, 50)).toBe(50);
  });
});
