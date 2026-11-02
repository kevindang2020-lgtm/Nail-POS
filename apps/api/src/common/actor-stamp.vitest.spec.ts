import { describe, it, expect } from 'vitest';
import { runWithContext } from '@aipowersalon/observability';
import { stampActor } from './actor-stamp';

const U = '22222222-2222-4222-8222-222222222222';
const ctx = (actorType: any, actorId: string | undefined) => ({ requestId: 'req_x', correlationId: 'c', traceId: 't', service: 'api' as const, actorType, actorId });

describe('stampActor — only a person is stamped', () => {
  it('staff user, technician, customer and Super Admin → their id', () => {
    for (const t of ['user', 'technician', 'customer', 'super_admin']) expect(runWithContext(ctx(t, U), () => stampActor())).toBe(U);
  });
  it('device, integration, system, anonymous, a worker principal, or no context at all → null', () => {
    for (const t of ['device', 'integration', 'system', 'anonymous']) expect(runWithContext(ctx(t, U), () => stampActor())).toBeNull();
    expect(runWithContext(ctx('system', 'worker:dormant-accounts'), () => stampActor())).toBeNull();
    expect(runWithContext(ctx('user', undefined), () => stampActor())).toBeNull();
    expect(stampActor()).toBeNull();
  });
});
