/**
 * Board UI state (spec §9, §19, §26). Pure reducer so state preservation can be
 * unit-tested and the host can snapshot/restore it around booking workflows.
 */
import { DEFAULT_PER_PAGE } from '../domain/paging';
import type { AppointmentStatus, ID, ISODate } from '../domain/scheduleTypes';
import { addDays } from '../domain/time';

export type BoardView = 'day' | 'week';

export type BoardPanel =
  | { kind: 'none' }
  | { kind: 'find-opening' }
  | { kind: 'best-matches' }
  | { kind: 'view-all'; technicianId: ID }
  | { kind: 'technician-day'; technicianId: ID }
  | { kind: 'block-time'; technicianId?: ID; startMinute?: number }
  | { kind: 'appointment'; appointmentId: ID };

export interface SelectedSlot {
  technicianId: ID;
  startMinute: number;
  durationMinutes: number;
}

export interface BoardState {
  date: ISODate;
  view: BoardView;
  serviceId: ID | null;
  statuses: AppointmentStatus[];
  /** Empty = all technicians. */
  technicianIds: ID[];
  perPage: number;
  pageIndex: number;
  selectedTechnicianId: ID | null;
  selectedSlot: SelectedSlot | null;
  fitDay: boolean;
  fullScreen: boolean;
  scrollTop: number;
  panel: BoardPanel;
  /** Server-paged boards: show only technicians working on the date (default) or every technician. */
  workingOnly: boolean;
}

export type BoardAction =
  | { type: 'set-date'; date: ISODate }
  | { type: 'shift-date'; days: number }
  | { type: 'set-view'; view: BoardView }
  | { type: 'set-service'; serviceId: ID | null }
  | { type: 'set-statuses'; statuses: AppointmentStatus[] }
  | { type: 'set-technicians'; technicianIds: ID[] }
  | { type: 'set-working-only'; on: boolean }
  | { type: 'set-per-page'; perPage: number }
  | { type: 'set-page'; pageIndex: number }
  | { type: 'next-page'; pageCount: number }
  | { type: 'prev-page' }
  | { type: 'select-technician'; technicianId: ID | null }
  | { type: 'select-slot'; slot: SelectedSlot | null }
  | { type: 'toggle-fit-day' }
  | { type: 'set-full-screen'; on: boolean }
  | { type: 'set-scroll'; scrollTop: number }
  | { type: 'open-panel'; panel: BoardPanel }
  | { type: 'close-panel' }
  | { type: 'restore'; state: Partial<BoardState> };

export function initialBoardState(date: ISODate, overrides: Partial<BoardState> = {}): BoardState {
  return {
    date,
    view: 'day',
    serviceId: null,
    statuses: [],
    technicianIds: [],
    perPage: DEFAULT_PER_PAGE,
    pageIndex: 0,
    selectedTechnicianId: null,
    selectedSlot: null,
    fitDay: false,
    fullScreen: false,
    scrollTop: 0,
    panel: { kind: 'none' },
    workingOnly: true,
    ...overrides,
  };
}

export function boardReducer(s: BoardState, a: BoardAction): BoardState {
  switch (a.type) {
    case 'set-date':
      // Changing the date keeps filters AND the technician page (spec §9 / §26).
      return s.date === a.date ? s : { ...s, date: a.date, selectedSlot: null };
    case 'shift-date':
      return { ...s, date: addDays(s.date, a.days), selectedSlot: null };
    case 'set-view':
      return s.view === a.view ? s : { ...s, view: a.view };
    case 'set-service':
      return { ...s, serviceId: a.serviceId };
    case 'set-statuses':
      return { ...s, statuses: a.statuses };
    case 'set-technicians':
      return { ...s, technicianIds: a.technicianIds, pageIndex: 0 };
    case 'set-working-only':
      return s.workingOnly === a.on ? s : { ...s, workingOnly: a.on, pageIndex: 0 };
    case 'set-per-page': {
      // Keep the first visible technician stable when the page size changes.
      const firstIndex = s.pageIndex * s.perPage;
      return { ...s, perPage: a.perPage, pageIndex: Math.floor(firstIndex / a.perPage) };
    }
    case 'set-page':
      return { ...s, pageIndex: Math.max(0, a.pageIndex) };
    case 'next-page':
      return s.pageIndex + 1 < a.pageCount ? { ...s, pageIndex: s.pageIndex + 1 } : s;
    case 'prev-page':
      return s.pageIndex > 0 ? { ...s, pageIndex: s.pageIndex - 1 } : s;
    case 'select-technician':
      return { ...s, selectedTechnicianId: a.technicianId };
    case 'select-slot':
      return { ...s, selectedSlot: a.slot };
    case 'toggle-fit-day':
      return { ...s, fitDay: !s.fitDay };
    case 'set-full-screen':
      return s.fullScreen === a.on ? s : { ...s, fullScreen: a.on };
    case 'set-scroll':
      return s.scrollTop === a.scrollTop ? s : { ...s, scrollTop: a.scrollTop };
    case 'open-panel':
      return { ...s, panel: a.panel };
    case 'close-panel':
      // Closing a workflow never resets date / filters / page (spec §26).
      return s.panel.kind === 'none' ? s : { ...s, panel: { kind: 'none' } };
    case 'restore':
      return { ...s, ...a.state };
  }
}

/** The part of the state the host should persist around booking workflows (spec §26). */
export type PersistedBoardState = Pick<
  BoardState,
  'date' | 'view' | 'serviceId' | 'statuses' | 'technicianIds' | 'perPage' | 'pageIndex' | 'selectedTechnicianId' | 'fitDay' | 'scrollTop' | 'workingOnly'
>;

export function toPersisted(s: BoardState): PersistedBoardState {
  const { date, view, serviceId, statuses, technicianIds, perPage, pageIndex, selectedTechnicianId, fitDay, scrollTop, workingOnly } = s;
  return { date, view, serviceId, statuses, technicianIds, perPage, pageIndex, selectedTechnicianId, fitDay, scrollTop, workingOnly };
}
