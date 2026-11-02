// ai-marketing-audience.vitest.spec.ts — covers the approved-dimension registry (no text-to-SQL) and the
// service preview path against the in-memory adapter.
import { describe, it, expect } from 'vitest';
import { validateAudienceDefinition, AudienceValidationError } from './ai-marketing-audience';
import { InMemoryAiMarketingRepository } from './ai-marketing.repository';
import { AiMarketingService, AiMarketingForbiddenError, AiMarketingValidationError } from './ai-marketing.service';
import type { AiMarketingContext } from './ai-marketing.dto';

function ctx(over: Partial<AiMarketingContext> = {}): AiMarketingContext {
  return { tenantId: 'tenantA', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['marketing.view'], ...over };
}

describe('validateAudienceDefinition', () => {
  it('rejects any unknown dimension (no arbitrary field/predicate can slip through)', () => {
    expect(() => validateAudienceDefinition({ channel: 'sms', rawSql: 'DROP TABLE customers' })).toThrow(
      AudienceValidationError,
    );
    expect(() => validateAudienceDefinition({ channel: 'sms', tenant_id: 'other' })).toThrow(AudienceValidationError);
  });

  it('requires a valid channel enum', () => {
    expect(() => validateAudienceDefinition({ channel: 'carrier-pigeon' })).toThrow(AudienceValidationError);
    expect(() => validateAudienceDefinition({})).toThrow(AudienceValidationError);
  });

  it('clamps numeric dimensions to safe bounds', () => {
    const d = validateAudienceDefinition({ channel: 'sms', minDaysSinceLastCompletedVisit: 999999, birthdayMonth: 99 });
    expect(d.minDaysSinceLastCompletedVisit).toBe(1000); // clamped max
    expect(d.birthdayMonth).toBe(12); // clamped to valid month
  });

  it('defaults protective flags to true', () => {
    const d = validateAudienceDefinition({ channel: 'email' });
    expect(d.excludeWithFutureAppointment).toBe(true);
    expect(d.requireActiveStatus).toBe(true);
    expect(d.minDaysSinceLastCompletedVisit).toBeNull();
  });
});

describe('AiMarketingService.previewAudience', () => {
  it('returns a consistent aggregate preview for the caller tenant', async () => {
    const repo = new InMemoryAiMarketingRepository({}, { tenantA: { total: 200, missingContact: 10, optedOut: 15 } });
    const svc = new AiMarketingService(repo);
    const p = await svc.previewAudience(ctx(), { channel: 'sms', minDaysSinceLastCompletedVisit: 42 });
    expect(p.total).toBe(200);
    expect(p.suppressed).toBe(25); // 10 + 15
    expect(p.eligible).toBe(175);
    expect(p.breakdown.missingContact).toBe(10);
    expect(p.channel).toBe('sms');
    expect(p.definitionEcho.minDaysSinceLastCompletedVisit).toBe(42);
  });

  it('is tenant-isolated: tenant B sees an empty preview, not tenant A audience', async () => {
    const repo = new InMemoryAiMarketingRepository({}, { tenantA: { total: 200, missingContact: 10, optedOut: 15 } });
    const svc = new AiMarketingService(repo);
    const p = await svc.previewAudience(ctx({ tenantId: 'tenantB' }), { channel: 'sms' });
    expect(p.total).toBe(0);
    expect(p.eligible).toBe(0);
  });

  it('resolves birthdayMonth "current" server-side', async () => {
    const repo = new InMemoryAiMarketingRepository({}, { tenantA: { total: 5, missingContact: 0, optedOut: 0 } });
    const svc = new AiMarketingService(repo);
    const p = await svc.previewAudience(ctx(), { channel: 'sms', birthdayMonth: 'current' });
    expect(p.definitionEcho.birthdayMonth).toBe(new Date().getUTCMonth() + 1);
  });

  it('maps unknown-dimension input to a validation error (400)', async () => {
    const repo = new InMemoryAiMarketingRepository({}, {});
    const svc = new AiMarketingService(repo);
    await expect(svc.previewAudience(ctx(), { channel: 'sms', evil: 1 })).rejects.toBeInstanceOf(
      AiMarketingValidationError,
    );
  });

  it('fails closed without permission', async () => {
    const repo = new InMemoryAiMarketingRepository({}, {});
    const svc = new AiMarketingService(repo);
    await expect(svc.previewAudience(ctx({ permissions: [] }), { channel: 'sms' })).rejects.toBeInstanceOf(
      AiMarketingForbiddenError,
    );
  });
});
