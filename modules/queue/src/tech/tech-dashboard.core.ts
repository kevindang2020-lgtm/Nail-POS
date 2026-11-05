/**
 * tech-dashboard.core.ts — pure assembly of the Technician Mobile Dashboard state (no I/O).
 *
 * Composes the dto's pure helpers (elapsedSecondsFrom, deriveAvailableActions, salesOnlySnapshot) into the consolidated
 * TechDashboardState that GET /tech (dashboard) and GET /tech/earnings will return. The service layer (next slice)
 * gathers the raw pieces — the technician, today's served line snapshots, the current serving session, the next
 * appointment, and the queue flags — and hands them here. Earnings are derived from per-line snapshots (never recomputed
 * from current settings), matching spec §12/§20.
 */
import {
  TechMe, TechTodayOverview, TechCurrentService, TechNextAppointment,
  TechAvailableActions, TechDashboardState, LineSnapshot,
  elapsedSecondsFrom, deriveAvailableActions, salesOnlySnapshot,
} from './tech-dashboard.dto';

export interface CurrentServiceInput {
  ticketId: string; queueItemId: string; serviceLineId: string; customerId: string;
  customerName: string; serviceName: string; startedAt: string; estimatedFinishTime?: string;
  status: 'accepted' | 'serving' | 'nearly_finished';
}

export interface TechDashboardInput {
  technician: TechMe;
  todayLines: LineSnapshot[];
  bookings: number;
  completed: number;
  inService: number;
  salesTrendPercent: number;
  currentService?: CurrentServiceInput;
  nextAppointment?: TechNextAppointment;
  notificationsCount?: number;
  hasAssignedUnacceptedTicket: boolean;
  hasAcceptedNotStarted: boolean;
  assignedTicketId?: string | null;
  nowMs?: number;
}

export function initialsOf(name: string): string {
  return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

export function buildTechDashboardState(input: TechDashboardInput): TechDashboardState {
  const now = input.nowMs ?? Date.now();
  const earnings = salesOnlySnapshot(input.todayLines);   // money (commission / tips) is filled from the snapshot by TechService
  const hasActiveService = !!input.currentService && (input.currentService.status === 'serving' || input.currentService.status === 'nearly_finished');

  const currentService: TechCurrentService | undefined = input.currentService
    ? { ...input.currentService, customerInitials: initialsOf(input.currentService.customerName), elapsedSeconds: elapsedSecondsFrom(input.currentService.startedAt, now) }
    : undefined;

  const overview: TechTodayOverview = {
    bookings: input.bookings, completed: input.completed, inService: input.inService,
    totalSalesCents: earnings.todaySalesCents, totalSalesTrendPercent: input.salesTrendPercent,
  };

  const availableActions: TechAvailableActions = deriveAvailableActions(
    input.technician.status, input.hasAssignedUnacceptedTicket, input.hasAcceptedNotStarted, hasActiveService,
  );

  return {
    technician: input.technician,
    overview,
    currentService,
    nextAppointment: input.nextAppointment,
    earnings,
    notificationsCount: input.notificationsCount ?? 0,
    availableActions,
    assignedTicketId: input.assignedTicketId ?? null,
  };
}
