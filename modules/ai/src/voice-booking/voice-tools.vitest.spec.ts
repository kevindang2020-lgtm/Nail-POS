// voice-tools.vitest.spec.ts — the voice tool catalog: read tools live, write tools declared-but-gated.
import { describe, it, expect } from 'vitest';
import { VOICE_TOOLS, enabledVoiceTools } from './voice-tools';

describe('voice tool catalog', () => {
  it('exposes only READ tools by default; write tools require the env flag', () => {
    const enabled = enabledVoiceTools({}); // no flag
    expect(enabled.every((t) => t.kind === 'read')).toBe(true);
    expect(enabled.map((t) => t.name).sort()).toEqual(['get_availability', 'get_business_info', 'get_deals', 'get_services', 'get_technicians']);
  });

  it('with the write flag on, exposes the full verification-gated write set', () => {
    const on = enabledVoiceTools({ VOICE_WRITE_TOOLS_ENABLED: 'true' }).map((t) => t.name);
    expect(on).toContain('create_appointment');
    expect(on).toContain('reschedule_appointment');
    expect(on).toContain('cancel_appointment');
    expect(on).toContain('verify_caller');
    expect(on).toContain('search_appointments');
  });

  it('get_availability requires service_id and date', () => {
    const t = VOICE_TOOLS.find((x) => x.name === 'get_availability')!;
    const required = t.params.filter((p) => p.required).map((p) => p.name);
    expect(required).toEqual(['service_id', 'date']);
  });
});
