// voice-caller-id.vitest.spec — Constitution 12 §108–110 (finding M12): the AI line cannot be told who you are.
//
// Before: the caller was "verified" by the phone number they SAID. Knowing a customer's number was enough to hear
// their upcoming appointments (a read tool, always on) and — with write tools enabled — to cancel or move them.
import { describe, it, expect, vi } from 'vitest';
import { VoiceManageService } from './voice-manage.service';
import { RetellVoiceAdapter } from './retell-voice.adapter';

const V = { tenantId: 't1', branchId: 'b1' } as any;
function svc() {
  const customers = { list: vi.fn(async () => ({ items: [{ customerId: 'c1', phone: '8565552020', normalizedPhone: '+18565552020', firstName: 'Maria', lastName: 'Lopez', displayName: 'Maria Lopez' }] })) };
  return new VoiceManageService({} as any, customers as any);
}

describe('M12 — verification requires the number the call comes FROM', () => {
  it('THE ATTACK: someone who knows Maria\'s number, calling from their OWN phone, is not verified as Maria', async () => {
    expect(await svc().verifyCaller(V, { phone: '856-555-2020' }, '+12125559999')).toBeNull();
  });
  it('a withheld / unknown caller id means no verification — the agent hands off to the front desk', async () => {
    expect(await svc().verifyCaller(V, { phone: '856-555-2020' }, null)).toBeNull();
    expect(await svc().verifyCaller(V, { phone: '856-555-2020' }, 'anonymous')).toBeNull();
  });
  it('Maria, calling from her own phone and saying her number, IS verified (formatting and +1 tolerated)', async () => {
    expect(await svc().verifyCaller(V, { phone: '(856) 555-2020' }, '+18565552020')).toMatchObject({ verified: true, customerId: 'c1' });
  });
  it('calling from the right number but SAYING a different customer\'s number is still refused', async () => {
    expect(await svc().verifyCaller(V, { phone: '856-555-2021' }, '+18565552020')).toBeNull();
  });
});

describe('the Retell adapter reads the caller id from the CALL object, never from tool arguments', () => {
  const a = new RetellVoiceAdapter();
  it('inbound: from_number becomes callerId', () => {
    const c: any = a.parseToolCall(JSON.stringify({ name: 'search_appointments', args: { phone: '8565552020' }, call: { call_id: 'x', direction: 'inbound', from_number: '+18565552020' } }));
    expect(c.callerId).toBe('+18565552020');
  });
  it('a caller_id smuggled into the tool ARGUMENTS is ignored', () => {
    const c: any = a.parseToolCall(JSON.stringify({ name: 'search_appointments', args: { phone: '8565552020', from_number: '+18565552020', callerId: '+18565552020' }, call: { call_id: 'x' } }));
    expect(c.callerId).toBeNull();
  });
  it('an OUTBOUND call\'s from_number is the salon\'s own line — never treated as the customer', () => {
    const c: any = a.parseToolCall(JSON.stringify({ name: 'search_appointments', args: {}, call: { call_id: 'x', direction: 'outbound', from_number: '+18005550000' } }));
    expect(c.callerId).toBeNull();
  });
});

describe('every verification site passes a caller id', () => {
  it('the four Retell tool sites and the three gateway sites (the compiler also enforces the argument)', async () => {
    const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const retell = readFileSync(join(process.cwd(), 'src/voice-booking/voice-booking.controller.ts'), 'utf8');
    expect((retell.match(/verifyCaller\(ctx, \{[^}]*\}, callerId\)/g) ?? []).length).toBe(4);
    const gw = readFileSync(join(process.cwd(), 'src/voice-booking/ai-receptionist-gateway.controller.ts'), 'utf8');
    expect(gw).toMatch(/req\?\.headers\?\.\['x-voice-caller-number'\]/);
    expect((gw.match(/this\.verified\([^)]*, rid, req\)/g) ?? []).length).toBe(3);
  });
});

describe('Phase 3 (audit E4): caller-ID matches the customer’s CURRENT number, never the editable display text', () => {
  it('a display text that shows the caller’s number does not verify them when the real number differs', async () => {
    const { VoiceManageService } = await import('./voice-manage.service');
    const customers = { list: vi.fn(async () => ({ items: [{ customerId: 'c9', phone: '(856) 555-2020', normalizedPhone: '+16095550000', firstName: 'Eve' }] })) };
    const s = new (VoiceManageService as any)({ appointments: vi.fn() }, customers);
    expect(await s.verifyCaller(V, { phone: '856-555-2020' }, '+18565552020')).toBeNull();
  });
  it('a caller whose display text is a MASK (what activation used to write) is still found by their real number', async () => {
    const { VoiceManageService } = await import('./voice-manage.service');
    const customers = { list: vi.fn(async () => ({ items: [{ customerId: 'c7', phone: '••••2020', normalizedPhone: '+18565552020', firstName: 'Eve' }] })) };
    const s = new (VoiceManageService as any)({ appointments: vi.fn() }, customers);
    expect(await s.verifyCaller(V, { phone: '856-555-2020', name: 'Eve' }, '+18565552020')).toMatchObject({ verified: true, customerId: 'c7' });
  });
});

