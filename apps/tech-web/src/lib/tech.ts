// tech.ts — pure formatting + status helpers shared by the technician screens. Money is integer cents from the
// backend; statuses map to chip styles. No business values are computed here (the server is authoritative).
export const money2 = (c: number | undefined | null) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const clock = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
export const longDate = (d: Date = new Date()): string => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export const greeting = (d: Date = new Date()): string => {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

// elapsed HH:MM:SS from a backend start time (the timer's source of truth is startedAt, not a local counter)
export const elapsed = (startIso?: string | null, nowMs: number = Date.now()): string => {
  if (!startIso) return '00:00:00';
  const start = new Date(startIso).getTime(); if (isNaN(start)) return '00:00:00';
  let s = Math.max(0, Math.floor((nowMs - start) / 1000));
  const hh = Math.floor(s / 3600); s -= hh * 3600; const mm = Math.floor(s / 60); const ss = s - mm * 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
};

export type ChipKind = 'ok' | 'warn' | 'danger' | 'neutral';
const STATUS_LABELS: Record<string, string> = {
  available: 'Available', assigned: 'Assigned', in_service: 'In Service', serving: 'In Service',
  on_break: 'On Break', lunch: 'Lunch', off_shift: 'Off Shift', offline: 'Offline',
  accepted: 'Accepted', nearly_finished: 'Almost Done', paused: 'Paused', done: 'Completed',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'No Show', upcoming: 'Upcoming',
  confirmed: 'Upcoming', checked_in: 'Checked In', waiting: 'Waiting', ready: 'Ready',
};
export const statusLabel = (s?: string): string => {
  const v = (s || '').toLowerCase();
  return STATUS_LABELS[v] || (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};
export const statusKind = (s?: string): ChipKind => {
  const v = (s || '').toLowerCase();
  if (['in_service', 'serving', 'completed', 'done', 'available', 'ready', 'checked_in'].includes(v)) return 'ok';
  if (['cancelled', 'no_show'].includes(v)) return 'danger';
  if (['upcoming', 'confirmed', 'assigned', 'accepted', 'waiting', 'on_break', 'lunch', 'nearly_finished'].includes(v)) return 'warn';
  return 'neutral';
};
export const initials = (name?: string | null): string =>
  (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
