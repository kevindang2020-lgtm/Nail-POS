// queue-alert-coded-text.vitest.spec.ts — Vietnamese POS §21 (Oct 27 2026): every reason the queue detector writes
// re-codes losslessly (queueAlertReasonCoded, api-contracts): the codes rendered with the POS English catalogue give back
// the stored English exactly, for every alert type; an unknown shape → null (the POS shows the stored text).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { queueAlertReasonCoded } from '@aipowersalon/api-contracts/tenant';
import type { CodedText } from '@aipowersalon/api-contracts';
import { detectQueueFindings, evaluateStuck, DEFAULT_DETECTION_THRESHOLDS as T, type DetectionEntry, type DetectionTechnician } from './ai-queue-assignment-detection';

const cat: Record<string, string> = {};
for (const m of readFileSync(new URL('../../../../apps/pos-web/src/i18n/ns/srv.en.ts', import.meta.url), 'utf8').matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',/gm)) cat[m[1]] = m[2].replace(/\\'/g, "'");
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
function ref(spec: string, raw: Record<string, string>): string {
  const [key, prefix] = spec.split('#'); let vars = raw;
  if (prefix) { vars = {}; for (const [k, v] of Object.entries(raw)) if (k.startsWith(prefix + '_')) vars[k.slice(prefix.length + 1)] = v; }
  if (!(key in cat)) throw new Error('missing ' + key); return fill(cat[key], vars);
}
function en(ct: CodedText): string {
  const raw: Record<string, string> = {}; for (const [k, v] of Object.entries(ct.vars ?? {})) if (v != null) raw[k] = String(v);
  const vars: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) vars[k] = v.startsWith('@') ? ref(v.slice(1), raw) : v;
  if (!('srv.' + ct.code in cat)) throw new Error('missing srv.' + ct.code); return fill(cat['srv.' + ct.code], vars);
}
const NOW = Date.UTC(2026, 9, 7, 15, 0, 0);
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const e = (o: Partial<DetectionEntry> & { queueEntryId: string }): DetectionEntry => ({ status: 'waiting', waitMinutes: 0, assignedTechnicianId: null, isAppointment: false, updatedAt: ago(1), ...o });
const tech = (id: string, status = 'available'): DetectionTechnician => ({ technicianId: id, status });

describe('queue alert reasons re-code losslessly', () => {
  it('every finding of a busy salon', () => {
    const f = [
      ...detectQueueFindings({ branchId: 'b', technicians: [tech('t1', 'busy'), tech('t2'), tech('t9', 'clocked_out')], entries: [
        e({ queueEntryId: 'w1', waitMinutes: 25, assignedTechnicianId: 't1' }), e({ queueEntryId: 'w2', waitMinutes: 40 }), e({ queueEntryId: 'w3', waitMinutes: 70, assignedTechnicianId: 't1' }),
        e({ queueEntryId: 'w4', waitMinutes: 3, assignedTechnicianId: 't1' }), e({ queueEntryId: 'w5', waitMinutes: 2, assignedTechnicianId: 't1' }),
        e({ queueEntryId: 'a1', isAppointment: true, appointmentStartAt: ago(40), waitMinutes: 5, assignedTechnicianId: 't2' }),
        e({ queueEntryId: 'a2', isAppointment: true, lateMinutes: 30, waitMinutes: 2, assignedTechnicianId: 't2' }),
        e({ queueEntryId: 's1', status: 'in_service', assignedTechnicianId: 't9', startedAt: ago(20) }),
        e({ queueEntryId: 's2', status: 'in_service', assignedTechnicianId: 't2', startedAt: ago(200), expectedDurationMinutes: 45 }),
        e({ queueEntryId: 'k1', status: 'assigned', assignedTechnicianId: 't2', updatedAt: ago(60) }),
      ] }, T, NOW),
      ...detectQueueFindings({ branchId: 'b2', technicians: [tech('x', 'busy')], entries: [e({ queueEntryId: 'z1', waitMinutes: 5 }), e({ queueEntryId: 'z2', waitMinutes: 8 })] }, T, NOW),
      ...detectQueueFindings({ branchId: 'b3', technicians: [tech('x', 'busy'), tech('y'), tech('y2')], entries: Array.from({ length: 8 }, (_, i) => e({ queueEntryId: 'm' + i, waitMinutes: 2, assignedTechnicianId: 'x' })) }, T, NOW),
    ];
    const types = new Set(f.map((x) => x.type));
    for (const ty of ['waiting_too_long', 'unassigned', 'late_appointment', 'stuck_record', 'long_service', 'overloaded_technician', 'congestion']) expect(types.has(ty as any), ty).toBe(true);
    for (const x of f) { const c = queueAlertReasonCoded(x.reason); expect(c, x.reason).not.toBeNull(); expect(en(c!)).toBe(x.reason); }
  });
  it('every stuck text', () => {
    const texts = [
      evaluateStuck({ status: 'assigned', assignedTechnicianId: 't', startedAt: null, updatedAt: ago(60) }, NOW, T).text,
      evaluateStuck({ status: 'called', assignedTechnicianId: null, updatedAt: ago(60) }, NOW, T).text,
      evaluateStuck({ status: 'ready_for_tech', assignedTechnicianId: 't', updatedAt: ago(60) }, NOW, T).text,
      evaluateStuck({ status: 'waiting', assignedTechnicianId: null, updatedAt: ago(500) }, NOW, T).text,
      evaluateStuck({ status: 'assigned', assignedTechnicianId: 't', updatedAt: ago(5) }, NOW, T, { clockedOutTechIds: new Set(['t']) }).text,
    ].filter(Boolean) as string[];
    expect(texts.length).toBeGreaterThanOrEqual(4);
    for (const s of texts) { const c = queueAlertReasonCoded(s); expect(c, s).not.toBeNull(); expect(en(c!)).toBe(s); }
  });
  it('a reason in another shape → null', () => { expect(queueAlertReasonCoded('Mia is unhappy')).toBeNull(); expect(queueAlertReasonCoded(null)).toBeNull(); });
});
