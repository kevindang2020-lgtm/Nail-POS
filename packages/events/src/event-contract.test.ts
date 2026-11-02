// Pins the envelope rules of Constitution 8 §6–§13, §37, §93, §225. Each test names the section it enforces.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS, EVENT_VERSIONS, createDomainEvent, validateDomainEvent, isPlatformEvent } from './event-contract';

const base = () => createDomainEvent({
  eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: 't-1', branchId: 'b-1',
  aggregateType: 'appointment', aggregateId: 'a-1', actorType: 'user', actorId: 'u-1',
  payload: { appointmentId: 'a-1', technicianId: 'tech-1' },
});

describe('event registry (§6–7)', () => {
  it('every name is domain.action or domain.entity.action, lowercase, past tense by convention', () => {
    for (const name of Object.values(DOMAIN_EVENTS)) expect(name).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*){1,2}$/);
  });
  it('every registered type has a version (§34)', () => {
    for (const name of Object.values(DOMAIN_EVENTS)) expect(EVENT_VERSIONS[name]).toBeGreaterThanOrEqual(1);
  });
  it('has no duplicate names', () => {
    const v = Object.values(DOMAIN_EVENTS); expect(new Set(v).size).toBe(v.length);
  });
});

describe('createDomainEvent (§8, §10–12)', () => {
  it('produces a UUID eventId, stamps occurredAt, and defaults correlationId to the eventId', () => {
    const e = base();
    expect(e.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(e.occurredAt)).not.toBeNaN();
    expect(e.correlationId).toBe(e.eventId);
    expect(e.eventVersion).toBe(1);
  });
  it('keeps an explicit correlationId and causationId when the event is part of a flow', () => {
    const cause = base();
    const e = createDomainEvent({ ...base(), correlationId: cause.correlationId, causationId: cause.eventId });
    expect(e.correlationId).toBe(cause.correlationId);
    expect(e.causationId).toBe(cause.eventId);
    expect(e.eventId).not.toBe(cause.eventId);
  });
});

describe('validateDomainEvent (§13, §37, §93, §225)', () => {
  it('accepts a well-formed tenant event', () => { expect(validateDomainEvent(base())).toEqual([]); });
  it('§13: a tenant-scoped event without tenantId is rejected', () => {
    expect(validateDomainEvent({ ...base(), tenantId: undefined })).toContain('tenant_id_missing');
  });
  it('§168: a platform event may omit tenantId', () => {
    const e = createDomainEvent({ eventType: DOMAIN_EVENTS.TENANT_SUSPENDED, aggregateType: 'tenant', aggregateId: 't-9', payload: { tenantId: 't-9' } });
    expect(isPlatformEvent(e.eventType)).toBe(true);
    expect(validateDomainEvent(e)).toEqual([]);
  });
  it('§7: an unregistered event type is rejected — no raw strings', () => {
    expect(validateDomainEvent({ ...base(), eventType: 'appointment.finished' as any })).toContain('event_type_unknown');
  });
  it('§34: a version newer than the registry knows is rejected, not guessed at', () => {
    expect(validateDomainEvent({ ...base(), eventVersion: 2 })).toContain('event_version_unsupported');
  });
  it('§225: OTPs, secrets and card data can never ride in a payload — including nested', () => {
    const bad = { ...base(), payload: { customerId: 'c-1', otp: '123456', nested: { cvv: '999' } } };
    const reasons = validateDomainEvent(bad);
    expect(reasons).toContain('forbidden_payload_key:otp');
    expect(reasons).toContain('forbidden_payload_key:nested.cvv');
  });
  it('§93: oversized payloads (documents, images) are rejected', () => {
    expect(validateDomainEvent({ ...base(), payload: { blob: 'x'.repeat(40_000) } })).toContain('payload_too_large');
  });
});
