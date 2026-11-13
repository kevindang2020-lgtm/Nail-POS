/**
 * Every word the board shows, in ONE dictionary (merge, Nov 13 2026). The package ships English; the host passes
 * `translate` (the POS: `tx('bsb.' + key, vars)` with the same keys in its `bsb` namespace, EN + VI) and `money`
 * (the salon's currency formatter, integer cents in). Placeholders are `{name}`. Nothing in the board concatenates
 * English fragments any more — the POS front desk runs in English or Vietnamese (addendum P-14).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export const BOARD_TEXT_EN = {
  // primary toolbar (optional — the POS keeps its own)
  'toolbar.view': 'View',
  'toolbar.day': 'Day',
  'toolbar.week': 'Week',
  'toolbar.today': 'Today',
  'toolbar.prevDay': 'Previous day',
  'toolbar.nextDay': 'Next day',
  'toolbar.selectedDate': 'Selected date {date}; choose another date',
  'toolbar.serviceFilter': 'Filter by service',
  'toolbar.allServices': 'All services',
  'toolbar.status': 'Status',
  'toolbar.statusesN': '{n} statuses',
  'toolbar.statusFilter': 'Status filter',
  'toolbar.clear': 'Clear',
  'toolbar.gridResolution': 'Grid resolution',
  'toolbar.grid15': '15-min grid',
  'toolbar.fitDay': 'Fit day',
  'toolbar.fullScreen': 'Full screen',
  'toolbar.exitFullScreen': 'Exit full screen',
  // appointment statuses (always shown as text/icon, never colour alone)
  'status.scheduled': 'Scheduled',
  'status.confirmed': 'Confirmed',
  'status.arrived': 'Arrived',
  'status.in_service': 'In service',
  'status.completed': 'Completed',
  'status.cancelled': 'Cancelled',
  'status.no_show': 'No-show',
  'status.rescheduled': 'Rescheduled',
  // second toolbar
  'opening.find': 'Find an opening',
  'opening.serviceToBook': 'Service to book',
  'opening.chooseService': 'Choose a service…',
  'opening.serviceOption': '{name} · {min} min',
  'opening.bestMatches': 'Best matches',
  'opening.rankFor': 'Rank technicians for {name}',
  'opening.chooseServiceFirst': 'Choose a service first',
  'opening.workingTechs': 'Working technicians ({n})',
  'opening.filteredTechs': '{n} of {total} technicians',
  'opening.techFilter': 'Technician filter',
  'opening.allWorking': 'All working technicians ({n})',
  'opening.offToday': 'Off today: {names}',
  'opening.allTechs': 'All technicians ({n})',
  'opening.workingOnly': 'Working today only ({n})',
  'opening.perPage': 'Technicians per page',
  'opening.perPageOption': '{n} per page',
  // pager
  'pager.previous': 'Previous',
  'pager.range': 'Technicians {first}–{last} of {total}',
  'pager.none': 'No technicians',
  'pager.next': 'Next {n}',
  'pager.page': 'Page {page} of {pages}',
  'pager.nextTechs': 'Next {n} technicians',
  // technician header
  'tech.state.working': 'Working',
  'tech.state.off': 'Off',
  'tech.state.time_off': 'Time off',
  'tech.state.on_break': 'On break',
  'tech.state.lunch': 'Lunch',
  'tech.state.in_service': 'In service',
  'tech.state.blocked': 'Blocked',
  'tech.offToday': 'Off today',
  'tech.moreActions': 'More actions for {name}',
  'tech.viewFullDay': 'View full day',
  'tech.blockTime': 'Block time…',
  'tech.clearSelection': 'Clear selection',
  'tech.selectColumn': 'Select column',
  'tech.viewDay': 'View day',
  'tech.stateTitle': '{state} · {shift} · {n} booked',
  // daily availability strip
  'avail.timeOff': 'Time off',
  'avail.notWorking': 'Not working today',
  'avail.fullyBooked': 'Fully booked',
  'avail.minOpen': 'min open',
  'avail.noOpeningsLeft': 'No openings left',
  'avail.bookAt': 'Book {name} at {range}',
  'avail.viewAll': 'View All',
  'avail.viewAllLabel': 'View all {n} openings for {name} ({min} min open)',
  'avail.caption': 'Daily availability',
  'avail.captionHint': 'tap an open time to book',
  'avail.openTimes': 'open times',
  'avail.openTimesTitle': 'Total open time across the visible technicians',
  'avail.hm': '{h}h {m}m',
  'avail.h': '{h}h',
  'avail.m': '{m}m',
  // grid
  'grid.notVisible': 'Technician not visible',
  'grid.noReassign': 'No permission to reassign',
  'grid.unavailable': 'Unavailable',
  'grid.noTechs': 'No technicians match the current filter.',
  'grid.loading': 'Loading schedule',
  'grid.retry': 'Retry',
  // drop / eligibility reasons
  'elig.TENANT_MISMATCH': 'Different salon',
  'elig.BRANCH_MISMATCH': 'Different branch',
  'elig.INACTIVE': 'Inactive',
  'elig.NOT_WORKING': 'Not working',
  'elig.SERVICE_INELIGIBLE': 'Not qualified for service',
  'elig.SERVICE_INACTIVE': 'Service inactive',
  'elig.SERVICE_NOT_AT_BRANCH': 'Service not offered here',
  'elig.OVERLAP': 'Already booked',
  'elig.LUNCH': 'Lunch',
  'elig.BREAK': 'Break',
  'elig.BLOCKED': 'Blocked time',
  'elig.TIME_OFF': 'Time off',
  'elig.PROTECTED': 'Runs into protected appointment',
  'elig.OFF_GRID': 'Not on 15-minute grid',
  'elig.INVALID_DURATION': 'Invalid duration',
  'elig.POLICY_LEAD_TIME': 'Too soon',
  'elig.POLICY_MAX_DURATION': 'Exceeds maximum duration',
  'elig.REQUESTED_OTHER_TECHNICIAN': 'Customer requested another technician',
  // appointment cards
  'card.walkIn': 'Walk-in',
  'card.walkInName': 'Walk-in: {name}',
  'card.protected': 'Protected',
  'card.requested': 'Requested technician',
  'card.min': '{n} min',
  'card.minShort': '{n}m',
  // open cells
  'open.bookAt': 'Book {time}, {n} minutes available',
  'open.passed': 'This time has passed',
  'open.bookMin': 'Book · {n}m',
  // break / blocked segments
  'seg.working': 'Working',
  'seg.lunch': 'Lunch',
  'seg.break': 'Break',
  'seg.blocked': 'Blocked',
  'seg.time_off': 'Time off',
  'seg.createdBy': 'Created by {who}',
  'seg.notBookable': 'not bookable',
  // legend + bottom bar
  'legend.walkIn': 'Walk-in',
  'legend.open': 'Open',
  'legend.break': 'Break',
  'legend.blocked': 'Blocked',
  'legend.blockTime': 'Block time',
  'bottom.prev': 'Previous technicians',
  'bottom.next': 'Next technicians',
  'bottom.pages': 'Technician pages',
  'bottom.hint': 'Swipe or drag left/right to see more technicians',
  // block time
  'block.title': 'Block time',
  'block.cancel': 'Cancel',
  'block.submit': 'Block time',
  'block.busy': 'Blocking…',
  'block.technician': 'Technician',
  'block.date': 'Date',
  'block.start': 'Start time',
  'block.duration': 'Duration',
  'block.durationOption': '{n} min',
  'block.end': 'End time',
  'block.reason': 'Reason',
  'block.notes': 'Notes',
  'block.optional': 'Optional',
  'block.help': 'Blocked time is not bookable and is recorded with who created it. Overlapping openings disappear immediately.',
  'block.reason.training': 'Training',
  'block.reason.supply': 'Supply run',
  'block.reason.personal': 'Personal',
  'block.reason.cleaning': 'Cleaning',
  'block.reason.meeting': 'Meeting',
  'block.reason.other': 'Other',
  // find an opening
  'find.title': 'Find an opening',
  'find.services': 'Services ({n} min total)',
  'find.servicesGroup': 'Services',
  'find.technician': 'Technician',
  'find.any': 'Any technician',
  'find.date': 'Date',
  'find.from': 'From',
  'find.to': 'To',
  'find.chooseOne': 'Choose at least one service to search.',
  'find.searching': 'Searching…',
  'find.none': 'No opening fits {n} minutes with an eligible technician in that window.',
  'find.row': '{n} min service · gap of {gap} min',
  'find.book': 'Book',
  // best matches
  'best.title': 'Best matches · {service}',
  'best.serviceFallback': 'Service',
  'best.requested': 'Requested technician',
  'best.none': 'None (any technician)',
  'best.preferred': 'Preferred start',
  'best.ranking': 'Ranking eligible technicians…',
  'best.noMatch': 'No eligible technician has a {n}-minute opening from {time}.',
  'best.earliest': 'Earliest {time}',
  'best.noOpening': 'No opening',
  'best.score': 'score {n}',
  'best.excluded': '{n} technicians not ranked (not eligible, or no opening)',
  'best.reason.rank': 'Rank {n} of {total} eligible',
  'best.reason.openSlots': '{n} open start times left today',
  'best.reason.roster': 'Roster #{n}',
  // technician day
  'day.title': '{name} · full day',
  'day.titleFallback': 'Technician day',
  'day.loading': 'Loading…',
  'day.appointments': 'appointments',
  'day.minBooked': 'min booked',
  'day.minOpen': 'min open',
  'day.minShift': 'min on shift',
  'day.timeline': 'Timeline',
  'day.open': 'Open',
  'day.bookChip': '{n} min · Book',
  'day.walkIn': '(walk-in)',
  'day.protected': 'protected',
  // appointment sheet
  'appt.open': 'Open appointment',
  'appt.cancel': 'Cancel appointment…',
  'appt.move': 'Move',
  'appt.moving': 'Moving…',
  'appt.moveHeading': 'Move (checked by the server)',
  'appt.technician': 'Technician',
  'appt.start': 'Start',
  'appt.requestedNotice': "The customer requested {name}. Reassignment is refused unless the salon's policy allows it.",
  'appt.cancelQ': 'Cancel this appointment?',
  'appt.reason': 'Reason',
  'appt.reasonPh': 'Why is it cancelled?',
  'appt.keep': 'Keep',
  'appt.confirmCancel': 'Confirm cancel',
  // view all
  'viewAll.label': 'All openings for {name}',
  'viewAll.title': '{name} · {n} openings',
  'viewAll.none': 'No openings today.',
  // week (standalone only)
  'week.technician': 'Technician',
  'week.off': 'Off',
  'week.summary': '{n} appts · {m}m open',
  'week.label': '{name} on {date}: {n} appointments, {m} minutes open',
  // toasts
  'toast.movedTime': '{name} moved to a new time.',
  'toast.movedTech': '{name} moved to another technician.',
  'toast.cancelled': "{name}'s appointment was cancelled.",
  'toast.blocked': 'Time blocked. Overlapping openings were removed.',
  'ui.close': 'Close',
  'ui.dismiss': 'Dismiss',
  // domain errors (spec §35)
  'err.APPOINTMENT_CONFLICT': 'That time was just booked. The schedule has been updated.',
  'err.TECHNICIAN_UNAVAILABLE': 'This technician is not available at that time.',
  'err.TECHNICIAN_SERVICE_INELIGIBLE': 'This technician is not qualified for the selected service.',
  'err.SCHEDULE_CHANGED': 'The schedule changed while you were working. It has been refreshed.',
  'err.PERMISSION_DENIED': 'You do not have permission to make this change.',
  'err.INVALID_DURATION': 'The service duration does not fit in the selected opening.',
  'err.BLOCKED_TIME_CONFLICT': 'That time is blocked and cannot be booked.',
  'err.APPOINTMENT_PROTECTION': 'This service would run into a protected appointment.',
  'err.NOT_FOUND': 'That appointment no longer exists.',
  'err.VALIDATION_FAILED': 'Some of the booking details are invalid.',
  'err.NETWORK_ERROR': 'The schedule service could not be reached. Please try again.',
  'err.UNKNOWN': 'Something went wrong. The schedule has been refreshed.',
} as const;

export type BoardTextKey = keyof typeof BOARD_TEXT_EN;
export type BoardTextVars = Record<string, string | number>;
/** Host translation hook: return the text for `key` (the host's own catalogue), or `undefined` to use English. */
export type BoardTranslate = (key: BoardTextKey, vars?: BoardTextVars) => string | undefined;

export function interpolate(template: string, vars?: BoardTextVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** English with placeholders filled — the default, and the fallback for a key the host does not know. */
export function englishText(key: BoardTextKey, vars?: BoardTextVars): string {
  return interpolate(BOARD_TEXT_EN[key], vars);
}

export function defaultMoney(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export interface BoardText {
  t: (key: BoardTextKey, vars?: BoardTextVars) => string;
  /** integer cents → the salon's money text */
  money: (cents: number) => string;
}

const DEFAULT_TEXT: BoardText = { t: englishText, money: defaultMoney };
const BoardTextContext = createContext<BoardText>(DEFAULT_TEXT);

export function BoardTextProvider({ translate, money, children }: { translate?: BoardTranslate; money?: (cents: number) => string; children: ReactNode }) {
  const value = useMemo<BoardText>(() => ({
    t: translate ? (key, vars) => { const out = translate(key, vars); return out == null || out === '' ? englishText(key, vars) : out; } : englishText,
    money: money ?? defaultMoney,
  }), [translate, money]);
  return <BoardTextContext.Provider value={value}>{children}</BoardTextContext.Provider>;
}

export function useBoardText(): BoardText {
  return useContext(BoardTextContext);
}
