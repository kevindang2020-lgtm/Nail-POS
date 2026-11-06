// posfix.en.ts — Vietnamese POS gate repair (Nov 6 2026): small shared labels that were typed in English on screens built
// in Batches C–G (channel names, consent line, example values, a service line). Keys: `px.*`.
export const POSFIX_EN: Record<string, string> = {
  'px.ch.sms': 'SMS',
  'px.ch.smsEmail': 'SMS / Email',
  'px.ch.consent': 'SMS {sms} · Email {email}',
  'px.ch.smsTo': 'SMS · {to}',
  'px.vipSince': 'VIP since {when}',
  'px.svcLine': '{name} ({minutes} min, {price})',
  'px.aifd.handoffPh': 'e.g. +16095550100 · voicemail · front_desk',
  'px.bd.datePh': 'YYYY-MM-DD / MM-DD',
};
