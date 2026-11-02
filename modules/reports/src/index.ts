// modules/reports — the reports domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { BookingCheckinEventsModule } from './booking-checkin-events/booking-checkin-events.module';
export { BookingConversionModule } from './booking-conversion/booking-conversion.emitter';
export { BookingConversionEmitter } from './booking-conversion/booking-conversion.emitter';   // used by the API today (ai-center)
export { MenuInsightsModule } from './menu-insights/menu-insights.module';
export { ReportsModule } from './reports/reports.module';
export * from './menu-insights/menu-insights.dto';
export * from './reports/reports.dto';
export { BOOKING_CHECKIN_RECORDER, BookingCheckinRecorderPort, DuplicateInput, FailedEventInput } from './booking-checkin-events/booking-checkin-recorder';   // used by the API today
export { PosKpiSnapshots } from './kpi-snapshots/kpi-snapshots';   // used by the API today
export { ReportsContext } from './reports/reports.repository';   // used by the API today
export { ForbiddenError, ReportsService } from './reports/reports.service';   // used by the API today
// joined by --into (marketing-report):
export { MarketingReportModule } from './marketing-report/marketing-report.module';
export { MarketingGrowthModule } from './marketing-growth/marketing-growth.module';   // Marketing & Growth (Oct 30 2026): reconciliation, search, activity, journey, economics
export { BirthdayCenterModule } from './birthdays/birthday-center.module';   // Birthday Campaigns (Oct 31 2026): /pos/birthdays/*
export * from './marketing-report/marketing-report.dto';
