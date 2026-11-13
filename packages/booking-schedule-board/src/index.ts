/** Public surface of the standalone Booking Schedule Board (spec §5–§7). */
import './styles/board.css';

export { BookingScheduleBoard, type BookingScheduleBoardProps } from './components/BookingScheduleBoard';
export * from './adapters/BookingDataAdapter';
export { ProductionBookingDataAdapter, HostScheduleBridge, MonotonicClock, type HttpClient, type HostDayGridFilters, type ProductionAdapterOptions } from './adapters/ProductionBookingDataAdapter';
export * from './adapters/posBookingWire';
export * from './domain/technicianColor';
export * from './domain/time';
export { BOARD_TEXT_EN, BoardTextProvider, useBoardText, englishText, interpolate, type BoardTextKey, type BoardTextVars, type BoardTranslate } from './i18n/boardText';
export * from './domain/scheduleTypes';
export * from './domain/bookingErrors';
export * from './domain/availability';
export * from './domain/eligibility';
export * from './domain/openings';
export * from './domain/paging';
export * from './realtime/events';
export type { PersistedBoardState } from './state/boardState';
// NOTE: MockBookingDataAdapter and fixtures are intentionally NOT exported here.
// Import them from './testing' in dev/test code only (MERGE-CHECKLIST step 11).
