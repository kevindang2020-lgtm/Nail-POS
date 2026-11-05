// ai-entitlement.guard.vitest.spec.ts — the "have you paid" gate.
//
// The eight modules this guard covers do PURE COMPUTATION — they cost us nothing per call. So the risk here is
// not a runaway bill; it is the opposite: turning this on **revokes a feature from a live, paying-yesterday
// tenant**. That is a pricing decision, and an engineer must not make it silently inside a refactor.
//
// Hence the mode ladder, and hence most of these tests: the DEFAULT must let everyone through while recording
// what *would* have happened, so the blast radius of enforcing can be read off a screen before anyone is cut
// off. A guard that ships enforcing-by-default would have been the dangerous change.
import { describe, it, expect } from 'vitest';
import { AiEntitlementGuard, enforcementMode, RequiresAiPackage, AI_PACKAGE_KEY } from './ai-entitlement.guard';
import type { AiAccessSnapshot } from '../ai/ai-access-gate';

const snap = (over: Partial<AiAccessSnapshot> = {}): AiAccessSnapshot => ({
  tenantStatus: 'active', supportMode: false, packageEnabled: true,
  subscription: { status: 'active', trialEndsAt: null },
  usage: { used: 5, limit: 500, overageEnabled: false },
  hasPermission: true, pastDuePolicy: 'block',
  ...over,
} as AiAccessSnapshot);

function ctxFor(reqCtx: any, packageCode: string | undefined) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ ctx: reqCtx }) }),
    __packageCode: packageCode,
  } as any;
}

function build(opts: { mode?: string; snapshot?: AiAccessSnapshot; repo?: any; throws?: boolean } = {}) {
  const prev = process.env.AI_ENTITLEMENT_ENFORCEMENT;
  if (opts.mode === undefined) delete process.env.AI_ENTITLEMENT_ENFORCEMENT;
  else process.env.AI_ENTITLEMENT_ENFORCEMENT = opts.mode;

  const logged: any[] = [];
  let loads = 0;
  const reflector: any = { get: (_k: string, target: any) => (target === 'handler' ? undefined : CURRENT_PKG) };
  const repo: any = opts.repo !== undefined ? opts.repo : {
    async loadSnapshot() { loads++; if (opts.throws) throw new Error('db blip'); return opts.snapshot ?? snap(); },
  };
  const usage: any = { async log(e: any) { logged.push(e); } };
  const guard = new AiEntitlementGuard(reflector, repo, usage);
  const restore = () => { if (prev === undefined) delete process.env.AI_ENTITLEMENT_ENFORCEMENT; else process.env.AI_ENTITLEMENT_ENFORCEMENT = prev; };
  return { guard, logged, restore, loads: () => loads };
}

let CURRENT_PKG: string | undefined = 'ai_scheduling_optimizer';
const TENANT = { tenantId: 't1', userId: 'u1', role: 'MANAGER' };

describe('enforcementMode', () => {
  it('DEFAULTS to observe — nobody loses access just because this code shipped', () => {
    expect(enforcementMode({} as any)).toBe('observe');
    expect(enforcementMode({ AI_ENTITLEMENT_ENFORCEMENT: '' } as any)).toBe('observe');
    expect(enforcementMode({ AI_ENTITLEMENT_ENFORCEMENT: 'nonsense' } as any)).toBe('observe');
  });
  it('honours off and enforce', () => {
    expect(enforcementMode({ AI_ENTITLEMENT_ENFORCEMENT: 'off' } as any)).toBe('off');
    expect(enforcementMode({ AI_ENTITLEMENT_ENFORCEMENT: 'ENFORCE' } as any)).toBe('enforce');
  });
});

describe('AiEntitlementGuard — it only touches routes that opt in', () => {
  it('passes any handler with no @RequiresAiPackage — public routes, webhooks, Super Admin all untouched', async () => {
    CURRENT_PKG = undefined;
    const { guard, logged, restore, loads } = build({ mode: 'enforce', snapshot: snap({ subscription: null } as any) });
    expect(await guard.canActivate(ctxFor(TENANT, undefined))).toBe(true);
    expect(loads()).toBe(0);     // it did not even look
    expect(logged).toHaveLength(0);
    restore(); CURRENT_PKG = 'ai_scheduling_optimizer';
  });

  it('never gates SUPER_ADMIN — support must keep working on a lapsed tenant, which is when it is needed most', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ subscription: null } as any) });
    expect(await guard.canActivate(ctxFor({ ...TENANT, role: 'SUPER_ADMIN' }, 'x'))).toBe(true);
    restore();
  });
});

describe('AiEntitlementGuard — OBSERVE (the default)', () => {
  it('ALLOWS an unsubscribed tenant through — shipping this must not cut anyone off', async () => {
    const { guard, restore } = build({ snapshot: snap({ subscription: null } as any) });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    restore();
  });

  it('but RECORDS the would-be denial, so the blast radius of enforcing is a number, not a guess', async () => {
    const { guard, logged, restore } = build({ snapshot: snap({ subscription: null } as any) });
    await guard.canActivate(ctxFor(TENANT, 'x'));
    expect(logged).toHaveLength(1);
    expect(logged[0].action).toBe('would_block');
    expect(logged[0].status).toBe('blocked_unpaid');
    expect(logged[0].packageCode).toBe('ai_scheduling_optimizer');
    expect(logged[0].usageAmount).toBe(0);          // a denial consumes no allowance, even a hypothetical one
    restore();
  });

  it('records an over-limit tenant as blocked_limit, and still lets them work', async () => {
    const { guard, logged, restore } = build({ snapshot: snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any) });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    expect(logged[0].status).toBe('blocked_limit');
    restore();
  });

  it('logs nothing for an entitled tenant — observe mode is not a firehose', async () => {
    const { guard, logged, restore } = build({ snapshot: snap() });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    expect(logged).toHaveLength(0);
    restore();
  });
});

describe('AiEntitlementGuard — ENFORCE', () => {
  it('denies an unsubscribed tenant with 403', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ subscription: null } as any) });
    await expect(guard.canActivate(ctxFor(TENANT, 'x'))).rejects.toMatchObject({ status: 403 });
    restore();
  });

  it('denies an over-limit tenant with 429 — a different problem with a different remedy', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any) });
    await expect(guard.canActivate(ctxFor(TENANT, 'x'))).rejects.toMatchObject({ status: 429 });
    restore();
  });

  it('allows an entitled tenant', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap() });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    restore();
  });

  it('denies cancelled / expired / suspended', async () => {
    for (const s of [
      snap({ subscription: { status: 'cancelled', trialEndsAt: null } } as any),
      snap({ subscription: { status: 'expired', trialEndsAt: null } } as any),
      snap({ tenantStatus: 'suspended' } as any),
    ]) {
      const { guard, restore } = build({ mode: 'enforce', snapshot: s });
      await expect(guard.canActivate(ctxFor(TENANT, "x"))).rejects.toThrow();
      restore();
    }
  });
});

describe('AiEntitlementGuard — OFF', () => {
  it('does nothing at all, and does not even consult the repo', async () => {
    const { guard, logged, restore, loads } = build({ mode: 'off', snapshot: snap({ subscription: null } as any) });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    expect(loads()).toBe(0);
    expect(logged).toHaveLength(0);
    restore();
  });
});

describe('AiEntitlementGuard — failure modes FAIL OPEN, deliberately', () => {
  it('a repo error lets the tenant through', async () => {
    // The opposite of the malware-scan rule, and on purpose. There, a false 'clean' means a live threat. Here,
    // a false deny means breaking a customer who paid us because a lookup timed out.
    const { guard, restore } = build({ mode: 'enforce', throws: true });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    restore();
  });

  it('an unbound repo (no DB) lets the tenant through', async () => {
    const { guard, restore } = build({ mode: 'enforce', repo: undefined });
    expect(await guard.canActivate(ctxFor(TENANT, 'x'))).toBe(true);
    restore();
  });

  it('a request with no tenant context is not gated', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ subscription: null } as any) });
    expect(await guard.canActivate(ctxFor({}, 'x'))).toBe(true);
    restore();
  });
});

describe('RequiresAiPackage', () => {
  it('is the metadata the guard keys off', () => {
    expect(typeof RequiresAiPackage('ai_inventory_assistant')).toBe('function');
    expect(AI_PACKAGE_KEY).toBe('ai_package_code');
  });
});

describe('Functional Decision 30 — usage warnings and the stop at 100%', () => {
  const ctxWithRes = (headers: Record<string, string>) => ({
    getHandler: () => 'handler', getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ ctx: TENANT }), getResponse: () => ({ setHeader: (k: string, v: string) => { headers[k] = v; } }) }),
  } as any);
  it('allowed at 80% / 90% → the response carries X-AI-Usage-Warning; below 80% it does not', async () => {
    for (const [used, want] of [[300, undefined], [399, 'warn_80'], [449, 'warn_90']] as const) {
      const headers: Record<string, string> = {};
      const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ usage: { used, limit: 500, overageEnabled: false } } as any) });
      expect(await guard.canActivate(ctxWithRes(headers))).toBe(true);
      expect(headers['X-AI-Usage-Warning']).toBe(want);
      restore();
    }
  });
  it('at 100% (no overage) → 429 with code AI_USAGE_LIMIT_REACHED and the tenant\'s options', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any) });
    const err: any = await guard.canActivate(ctxWithRes({})).catch((e) => e);
    restore();
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'AI_USAGE_LIMIT_REACHED', options: ['upgrade_plan', 'purchase_additional_usage', 'enable_overage_billing'] });
  });
  it('a tenant that ENABLED overage is not stopped (no surprise overage for anyone who did not)', async () => {
    const { guard, restore } = build({ mode: 'enforce', snapshot: snap({ usage: { used: 500, limit: 500, overageEnabled: true } } as any) });
    expect(await guard.canActivate(ctxWithRes({}))).toBe(true);
    restore();
  });
});

