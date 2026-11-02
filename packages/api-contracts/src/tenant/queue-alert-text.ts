// queue-alert-text.ts — Vietnamese POS §21 / §120 (Oct 27 2026): an AI-queue alert's reason ("Waiting 35 min (severe)")
// is stored as English in queue_alerts.reason. This pure helper re-codes the detector's FIXED English templates
// (modules/ai/src/ai-queue-assignment/ai-queue-assignment-detection.ts) as code + vars, so the POS words it in the
// cashier's language — for alerts already stored too. A reason in any other shape returns null (shown as stored).
// Lossless: the detector spec renders these codes with the POS English catalogue and gets the stored text back.
import { coded, type CodedText } from '../text/coded-text';

const RULES: [RegExp, (m: RegExpExecArray) => CodedText][] = [
  [/^Waiting (\d+) min \((approaching|exceeded|severe|critical)\)$/, (m) => coded('AIQ_ALERT.WAITING', { minutes: +m[1], level: '@srv.AIQ_LEVEL.' + m[2] })],
  [/^No technician for (\d+) min$/, (m) => coded('AIQ_ALERT.UNASSIGNED', { minutes: +m[1] })],
  [/^Appointment time passed (\d+) min ago and the service has not started$/, (m) => coded('AIQ_ALERT.LATE_NOT_STARTED', { minutes: +m[1] })],
  [/^Arrived (\d+) min after the appointment time — check the technician's next booking$/, (m) => coded('AIQ_ALERT.ARRIVED_LATE', { minutes: +m[1] })],
  [/^The technician has clocked out during this service$/, () => coded('AIQ_ALERT.CLOCKED_OUT_IN_SERVICE')],
  [/^In service (\d+) min \(expected about (\d+) min\)$/, (m) => coded('AIQ_ALERT.LONG_SERVICE', { minutes: +m[1], expected: +m[2] })],
  [/^(\d+) guests are waiting for one technician while 1 technician is free$/, (m) => coded('AIQ_ALERT.OVERLOADED_ONE_FREE', { n: +m[1] })],
  [/^(\d+) guests are waiting for one technician while (\d+) technicians are free$/, (m) => coded('AIQ_ALERT.OVERLOADED_FREE', { n: +m[1], free: +m[2] })],
  [/^(\d+) guests are waiting for one technician$/, (m) => coded('AIQ_ALERT.OVERLOADED', { n: +m[1] })],
  [/^The assigned technician has clocked out — reassign this guest$/, () => coded('AIQ_ALERT.STUCK_CLOCKED_OUT')],
  [/^Assigned (\d+) min ago but the service has not started$/, (m) => coded('AIQ_ALERT.STUCK_ASSIGNED', { minutes: +m[1] })],
  [/^Called (\d+) min ago and nothing has happened since$/, (m) => coded('AIQ_ALERT.STUCK_CALLED', { minutes: +m[1] })],
  [/^Sent to the technician (\d+) min ago and not picked up$/, (m) => coded('AIQ_ALERT.STUCK_HANDOFF', { minutes: +m[1] })],
  [/^No change for (\d+) min — the guest may have left$/, (m) => coded('AIQ_ALERT.STUCK_NO_CHANGE', { minutes: +m[1] })],
];
/** one congestion reason part → code (null = unknown shape) */
function congestionPart(p: string): CodedText | null {
  if (p === 'No technician is free') return coded('AIQ_CONGESTION.NONE_FREE');
  if (p === 'No customers waiting') return coded('AIQ_CONGESTION.NONE_WAITING');
  let m = /^(\d+) waiting, (\d+) free \((\d+(?:\.\d)?) per technician\)$/.exec(p);
  if (m) return coded('AIQ_CONGESTION.RATIO', { waiting: +m[1], free: +m[2], ratio: m[3] });
  m = /^(\d+) waiting, (\d+) free \(no one free per technician\)$/.exec(p);
  if (m) return coded('AIQ_CONGESTION.RATIO_NONE_FREE', { waiting: +m[1], free: +m[2] });
  m = /^longest wait (\d+) min$/.exec(p);
  if (m) return coded('AIQ_CONGESTION.LONGEST', { minutes: +m[1] });
  return null;
}
export function queueAlertReasonCoded(reason: string | null | undefined): CodedText | null {
  const r = String(reason ?? '');
  for (const [re, f] of RULES) { const m = re.exec(r); if (m) return f(m); }
  const c = /^Queue (elevated|high|severe|critical): (.+)$/.exec(r);
  if (c) {
    const parts = c[2].split('; ').map(congestionPart);
    if (parts.some((x) => !x) || parts.length > 3) return null;
    const vars: Record<string, string | number> = { level: '@srv.AIQ_LEVEL.' + c[1] };
    parts.forEach((p, i) => { vars['p' + i] = '@srv.' + p!.code + '#p' + i; for (const [k, v] of Object.entries(p!.vars ?? {})) if (v != null) vars[`p${i}_${k}`] = v; });
    return coded('AIQ_ALERT.CONGESTION_' + parts.length, vars);
  }
  return null;
}
