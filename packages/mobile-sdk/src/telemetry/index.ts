// telemetry/ — Constitution 6 §116–119: sanitized analytics + perf marks (BUILD_PLAN Phase 13, E).
export {
  configureTelemetry, initMobileTelemetry, track, trackScreen, recordPerf, recordApiLatency, markFirstScreen, flushTelemetry, pendingTelemetry,
  resetTelemetryForTests, type TelemetryConfig,
} from './telemetry';
