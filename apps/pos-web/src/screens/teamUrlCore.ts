// teamUrlCore.ts — (pure; the hook is teamUrlState.ts) Team Management round 2A (TM-02 / TM-03, Four-Module Completion Guide §8.2–§8.3, 30 Oct 2026).
// The directory's NON-SENSITIVE state lives in the URL query (useSearchParams), so Back / Forward / refresh restore it:
//   tab · role · status · shift · dept · account · extra · sort · basis · preset / from / to · page · size (10 | 20 | 50) · mode
// Decision (documented in the handoff): the SEARCH TEXT is never written to the URL — in customer mode it is a customer's
// name or phone (PII), and in staff mode it may be a staff phone or e-mail; a shareable link must not carry either. While a
// search is typed the page is kept in memory only, so a refreshed link opens the filtered list at a real page.
// Every value is read through an allowlist: an unknown filter is dropped, a bad page becomes 1 (the server clamps a page past
// the end and the screen writes the clamped page back with replace), a bad size becomes 10.
// TM-03: a creation flow returns here with `?created=<memberId>` (teamCreatedPath) → page 1, default sort (created_at DESC,
// id DESC), the new row highlighted; `created` stays (refresh-safe) until the note is dismissed.
import type { PeriodState } from '../components/FinanceKit';

export const TEAM_SIZES = [10, 20, 50] as const;
const TABS = ['all', 'stylists', 'nail_technicians', 'receptionists', 'assistants', 'managers'];
const ROLES = ['owner', 'manager', 'receptionist', 'stylist', 'nail_technician', 'assistant', 'other'];
const STATUSES = ['available', 'in_service', 'assigned', 'on_break', 'on_shift', 'off', 'time_off', 'not_tracked'];
const SHIFTS = ['scheduled', 'unscheduled', 'clocked_in', 'day_off'];
const DEPTS = ['management', 'front_desk', 'hair_services', 'nail_services', 'support'];
const ACCOUNTS = ['current', 'active', 'inactive', 'archived', 'all'];
const EXTRAS = ['missing_mapping', 'no_login', 'has_login', 'unrated'];
const SORTS = ['newest', 'oldest', 'name'];
const BASES = ['service', 'created'];
const PRESETS = ['today', 'week', 'month', 'year', 'custom', 'all'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TeamUrl {
  tab: string; role: string; status: string; shift: string; department: string; account: string; extra: string; sort: string; basis: string;
  period: PeriodState; page: number; size: number; mode: 'staff' | 'customer'; created: string | null;
}
export const TEAM_DEFAULTS: TeamUrl = { tab: 'all', role: '', status: '', shift: '', department: '', account: 'current', extra: '', sort: 'newest', basis: 'service',
  period: { preset: 'month' }, page: 1, size: 10, mode: 'staff', created: null };
/** the keys whose change sends the list back to page 1 */
export const FILTER_KEYS = ['tab', 'role', 'status', 'shift', 'department', 'account', 'extra', 'sort', 'basis', 'period', 'size', 'mode'] as const;
const pick = (v: string | null, list: string[], def: string) => (v != null && list.includes(v) ? v : def);

export function readTeamUrl(sp: URLSearchParams): TeamUrl {
  const preset = pick(sp.get('preset'), PRESETS, 'month') as PeriodState['preset'];
  const from = sp.get('from'); const to = sp.get('to');
  const period: PeriodState = preset === 'custom' && from && YMD.test(from) ? { preset, from, to: to && YMD.test(to) && to >= from ? to : from } : preset === 'custom' ? { preset: 'month' } : { preset };
  const page = Math.trunc(Number(sp.get('page'))); const size = Number(sp.get('size')); const created = sp.get('created');
  return {
    tab: pick(sp.get('tab'), TABS, 'all'), role: pick(sp.get('role'), ROLES, ''), status: pick(sp.get('status'), STATUSES, ''), shift: pick(sp.get('shift'), SHIFTS, ''),
    department: pick(sp.get('dept'), DEPTS, ''), account: pick(sp.get('account'), ACCOUNTS, 'current'), extra: pick(sp.get('extra'), EXTRAS, ''), sort: pick(sp.get('sort'), SORTS, 'newest'),
    basis: pick(sp.get('basis'), BASES, 'service'), period, page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100000) : 1,
    size: (TEAM_SIZES as readonly number[]).includes(size) ? size : 10, mode: sp.get('mode') === 'customer' ? 'customer' : 'staff', created: created && ID.test(created) ? created : null,
  };
}

/** the URL for a state: defaults are left out (a clean link), the search text NEVER goes in */
export function teamQuery(s: TeamUrl): URLSearchParams {
  const o = new URLSearchParams(); const d = TEAM_DEFAULTS;
  const put = (k: string, v: string, def: string) => { if (v && v !== def) o.set(k, v); };
  put('tab', s.tab, d.tab); put('role', s.role, ''); put('status', s.status, ''); put('shift', s.shift, ''); put('dept', s.department, ''); put('account', s.account, d.account);
  put('extra', s.extra, ''); put('sort', s.sort, d.sort); put('basis', s.basis, d.basis);
  if (s.period.preset !== 'month') o.set('preset', s.period.preset);
  if (s.period.preset === 'custom' && s.period.from) { o.set('from', s.period.from); if (s.period.to) o.set('to', s.period.to); }
  if (s.page > 1) o.set('page', String(s.page)); if (s.size !== d.size) o.set('size', String(s.size)); if (s.mode !== 'staff') o.set('mode', s.mode);
  if (s.created) o.set('created', s.created);
  return o;
}

/** apply a change: any filter change (without an explicit page) returns to page 1 */
export function nextTeamUrl(cur: TeamUrl, patch: Partial<TeamUrl>): TeamUrl {
  const n = { ...cur, ...patch };
  const filterChanged = FILTER_KEYS.some((k) => k in patch && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((cur as unknown as Record<string, unknown>)[k]));
  if (filterChanged && !('page' in patch)) n.page = 1;
  return n;
}
export const clearedTeamUrl = (cur: TeamUrl): TeamUrl => ({ ...TEAM_DEFAULTS, size: cur.size, mode: cur.mode, period: cur.period, created: cur.created });

/** TM-03: where a creation flow sends the user after a successful save (generic — any flow may use it) */
export function teamCreatedPath(memberId: string, back?: string | null): string {
  // the team list's own (non-sensitive) filters come back too — re-read through the allowlist; page / sort go back to the default
  const cur = readTeamUrl(new URLSearchParams(back ?? ''));
  return '/tenant/team/members?' + teamQuery({ ...cur, page: 1, sort: 'newest', mode: 'staff', created: memberId }).toString();
}
/** the + Add Team Member hand-off: the creation screen returns with ?created=<id> and these filters */
export const teamAddPath = (sp: URLSearchParams) => { const keep = teamQuery({ ...readTeamUrl(sp), page: 1, created: null }).toString(); return '/technicians?new=1&returnTo=team' + (keep ? '&back=' + encodeURIComponent(keep) : ''); };

