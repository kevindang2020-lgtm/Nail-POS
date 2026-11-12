// aiBookingSupportReport.ts — Extras "Evidence Export" (AI Booking Assistant 14): a plain-text support report of ONE AI booking
// request, built only from the detail the server already returned to this authorized viewer (GET pos/ai-booking/requests/:id).
// Exact ISO timestamps, statuses, stages, tool calls, verification and hold states and trace ids — and nothing private: no
// customer name, the phone only as the server's mask, provider references cut to their last 4, never a code (the server never
// sends one). Screenshots are not included (the POS cannot capture them). Nothing is sent anywhere — the file downloads here.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import type { AibRequestDetail } from '@aipowersalon/api-contracts/tenant';

const last4 = (v: string | null | undefined) => (v ? `…${String(v).slice(-4)}` : '—');
const v = (x: unknown) => (x == null || x === '' ? '—' : String(x));
/** anything that still looks like a phone number or an e-mail address in free text is masked (defence in depth) */
export const redactFreeText = (s: string | null | undefined) => (s == null ? '—' : String(s)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => `[phone …${m.replace(/\D/g, '').slice(-4)}]`)
  .replace(/(?<!…)\b\d{4,8}\b/g, '[number]'));

export function buildSupportReport(d: AibRequestDetail, generatedAt: string): string {
  const L: string[] = [];
  L.push(t('growth.aiBooking.rep.title'), `${t('growth.aiBooking.rep.generated')}: ${generatedAt}`, t('growth.aiBooking.rep.redacted'), '');
  L.push(`${t('growth.aiBooking.ov.requestId')}: ${d.requestId}`, `${t('growth.aiBooking.rep.branch')}: ${v(d.branchId)}`, `${t('growth.aiBooking.rep.source')}: ${v(d.source)}`,
    `${t('growth.aiBooking.rep.status')}: ${v(d.status)}`, `${t('growth.aiBooking.rep.created')}: ${v(d.createdAt)}`, `${t('growth.aiBooking.rep.updated')}: ${v(d.updatedAt)}`,
    `${t('growth.aiBooking.rep.appointment')}: ${v(d.appointmentId)} ${d.appointmentId ? `(${v(d.appointmentDate)} ${v(d.appointmentTime)} · ${v(d.appointmentStatus)})` : ''}`.trim(),
    `${t('growth.aiBooking.rep.phone')}: ${v(d.customer?.maskedPhone)} · ${t('growth.aiBooking.rep.verified')}: ${d.customer?.verified ? 'yes' : 'no'}`,
    `${t('growth.aiBooking.rep.attempts')}: ${v(d.attempts)}`, '');
  L.push(`## ${t('growth.aiBooking.rep.timeline')}`);
  for (const x of d.timeline ?? []) L.push(`${v(x.at)}  ${v(x.stage)}${x.outcome ? ` · ${x.outcome}` : ''}${x.failureReason ? ` · ${x.failureReason}` : ''}${x.latencyMs != null ? ` · ${x.latencyMs} ms` : ''}${x.appointmentId ? ` · appt ${x.appointmentId}` : ''}`);
  if (!d.timeline?.length) L.push('—');
  L.push('', `## ${t('growth.aiBooking.rep.tools')}`);
  for (const x of d.tools ?? []) L.push(`${v(x.at)} → ${v(x.finishedAt)}  ${v(x.tool)} (${v(x.kind)}) · ${v(x.status)} · ${x.requests} req${x.error ? ` · error: ${redactFreeText(x.error)}` : ''}`);
  if (!d.tools?.length) L.push('—');
  L.push('', `## ${t('growth.aiBooking.rep.verification')}`);
  for (const x of d.verification ?? []) L.push(`${v(x.at)}  ${v(x.status)} · ${v(x.channel)} · ${v(x.maskedPhone)} · tries ${x.attempts}/${x.resends} · expires ${v(x.expiresAt)} · verified ${v(x.verifiedAt)}${x.failureReason ? ` · ${x.failureReason}` : ''}`);
  if (!d.verification?.length) L.push('—');
  L.push('', `## ${t('growth.aiBooking.rep.holds')}`);
  for (const x of d.holds ?? []) L.push(`${x.holdId}  ${v(x.status)} · ${v(x.channel)} · ${v(x.startAt)}–${v(x.endAt)} · expires ${v(x.expiresAt)} · released ${v(x.releasedAt)}${x.releaseReason ? ` (${x.releaseReason})` : ''}${x.convertedAppointmentId ? ` · appt ${x.convertedAppointmentId}` : ''}`);
  if (!d.holds?.length) L.push('—');
  L.push('', `## ${t('growth.aiBooking.rep.messages')}`);
  for (const x of d.communications ?? []) L.push(`${v(x.sentAt)}  ${v(x.kind)} · ${v(x.provider)} · ref ${last4(x.providerReference)} · ${v(x.status)}`);
  if (!d.communications?.length) L.push('—');
  L.push('', t('growth.aiBooking.rep.noScreens'));
  return L.join('\n') + '\n';
}
