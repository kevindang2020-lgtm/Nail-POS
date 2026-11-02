// Security Deep Scan A4: no token, code or id from a URL path reaches the telemetry "operation" field.
import { describe, it, expect } from 'vitest';
import { redactPathForTelemetry } from './request-telemetry';

describe('redactPathForTelemetry', () => {
  it('masks tokens, codes and ids; keeps the words', () => {
    expect(redactPathForTelemetry('/webhooks/bank/9f3cKq_L0ngT0ken')).toBe('/webhooks/bank/:x');
    expect(redactPathForTelemetry('/pos/gift-cards/GCABCDEFGH')).toBe('/pos/gift-cards/:x');
    expect(redactPathForTelemetry('/pos/gift-cards/abcdefghijklmnopqrstuvwxyzabcdefghijklmnop')).toBe('/pos/gift-cards/:x');
    expect(redactPathForTelemetry('/pos/booking/appointments/0f000000-0000-4000-8000-000000000001/cancel?x=secret')).toBe('/pos/booking/appointments/:x/cancel');
    expect(redactPathForTelemetry('/pos/booking/day-grid')).toBe('/pos/booking/day-grid');
  });
});
