import { describe, it, expect } from 'vitest';
import { integrationsProductionProblems } from './integrations-production-config';

const prod = (over: Record<string, string> = {}) => ({ NODE_ENV: 'production', PAYMENTS_WEBHOOK_RAW_BODY: '1', ...over } as NodeJS.ProcessEnv);
describe('integrationsProductionProblems (§125–§126) — startup validation, pure', () => {
  it('outside production: never a problem', () => { expect(integrationsProductionProblems({ NODE_ENV: 'test', CARDPOINTE_BASE_URL: 'https://isv-uat.cardconnect.com' } as any)).toEqual([]); });
  it('a clean production environment passes', () => { expect(integrationsProductionProblems(prod())).toEqual([]); });
  it('raw-body webhook verification is mandatory', () => { expect(integrationsProductionProblems(prod({ PAYMENTS_WEBHOOK_RAW_BODY: '' })).join()).toMatch(/PAYMENTS_WEBHOOK_RAW_BODY=1/); });
  it('a sandbox / UAT processor host is refused', () => {
    expect(integrationsProductionProblems(prod({ CARDPOINTE_BASE_URL: 'https://isv-uat.cardconnect.com/cardconnect/rest' })).join()).toMatch(/sandbox \/ UAT host/);
    expect(integrationsProductionProblems(prod({ CARDPOINTE_BOLT_BASE_URL: 'https://bolt-uat.cardpointe.com/api' })).join()).toMatch(/CARDPOINTE_BOLT_BASE_URL/);
    expect(integrationsProductionProblems(prod({ CARDPOINTE_BASE_URL: 'https://fts.cardconnect.com/cardconnect/rest' }))).toEqual([]);
  });
  it('a half-configured or malformed shared Twilio sender is refused; a complete one needs the public API base (https)', () => {
    expect(integrationsProductionProblems(prod({ TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32) })).join()).toMatch(/set together/);
    const full = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM: '+18565550100' };
    expect(integrationsProductionProblems(prod(full)).join()).toMatch(/PUBLIC_API_BASE_URL is required/);
    expect(integrationsProductionProblems(prod({ ...full, PUBLIC_API_BASE_URL: 'http://api.example.com' })).join()).toMatch(/must be https/);
    expect(integrationsProductionProblems(prod({ ...full, PUBLIC_API_BASE_URL: 'https://api.example.com' }))).toEqual([]);
    expect(integrationsProductionProblems(prod({ ...full, TWILIO_FROM: 'MG' + 'b'.repeat(32), PUBLIC_API_BASE_URL: 'https://api.example.com' }))).toEqual([]);   // a Messaging Service is a valid sender (§60)
    expect(integrationsProductionProblems(prod({ ...full, TWILIO_FROM: '8565550100', PUBLIC_API_BASE_URL: 'https://api.example.com' })).join()).toMatch(/E\.164/);
    expect(integrationsProductionProblems(prod({ ...full, TWILIO_ACCOUNT_SID: 'ACnope', PUBLIC_API_BASE_URL: 'https://api.example.com' })).join()).toMatch(/Account SID/);
  });
});
