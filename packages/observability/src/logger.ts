// logger.ts — Constitution 11 §16–21, §29, §190, §375: the ONE application logger.
//
// Every line is a JSON object carrying the ambient telemetry context (request/correlation/trace/tenant/branch)
// merged automatically from request-context (§375–376) — a module logs `log.info('appointment.created', { appointmentId })`
// and the ids arrive on their own. Every field passes through redaction before it is written (§27).
//
// pino is used ONLY in production (the existing pino-logger.ts decision, kept): in dev and tests the same
// structured object goes to the console as a single line, so nothing here changes what the test suite sees.
//
// §284–289: writes never block or throw. pino is asynchronous by design; the console fallback is wrapped.
import { getContext, contextFields } from './request-context';
import { BUILD } from './build-info';
import { redact } from './redaction';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export interface LogRecord {
  timestamp: string; level: LogLevel; service: string; environment: string;
  msg: string;
  requestId?: string; correlationId?: string; traceId?: string; tenantId?: string; branchId?: string;
  operation?: string; actorType?: string;
  [k: string]: unknown;
}

export interface LogSink { write(rec: LogRecord): void }

/** Test seam + the production hook: main.ts installs the pino sink; tests install a capturing sink. */
let sink: LogSink | null = null;
export function setLogSink(s: LogSink | null): void { sink = s; }

/** BUILD_PLAN Phase 14 A: a SECOND, optional destination for every emitted record — the telemetry store's sink
 *  (telemetry-store.ts) — called after the primary sink, synchronously, inside the caller's context (so it can read the
 *  trace-sampled flag). It must only enqueue; a throwing tap is swallowed like a throwing sink. */
export type LogTap = (rec: LogRecord) => void;
let tap: LogTap | null = null;
export function setLogTap(t: LogTap | null): void { tap = t; }

let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
export function setLogLevel(l: LogLevel): void { minLevel = l; }

const ENV = process.env.NODE_ENV || 'development';
const SERVICE = process.env.SERVICE_NAME || 'aipowersalon-api';

function consoleSink(rec: LogRecord): void {
  try {
    const line = JSON.stringify(rec);
    if (rec.level === 'error' || rec.level === 'fatal') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  } catch { /* §286: never let logging fail the caller */ }
}

function emit(level: LogLevel, msg: string, fields: Record<string, unknown> | undefined, bound: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  let rec: LogRecord;
  try {
    rec = { timestamp: new Date().toISOString(), level, service: SERVICE, environment: ENV, deploymentVersion: BUILD.version, ...contextFields(getContext()), ...redact(bound), msg, ...redact(fields ?? {}) } as LogRecord;
  } catch {
    rec = { timestamp: new Date().toISOString(), level, service: SERVICE, environment: ENV, msg } as LogRecord;
  }
  try { (sink ?? { write: consoleSink }).write(rec); } catch { /* never throw into application code */ }
  if (tap) { try { tap(rec); } catch { /* the store tap never throws into application code (§286) */ } }
}

export interface AppLogger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
  /** §375: `logger.withContext({ jobId })` returns a logger whose every line carries those fields. */
  withContext(bound: Record<string, unknown>): AppLogger;
}

function make(bound: Record<string, unknown>): AppLogger {
  return {
    trace: (m, f) => emit('trace', m, f, bound), debug: (m, f) => emit('debug', m, f, bound),
    info: (m, f) => emit('info', m, f, bound), warn: (m, f) => emit('warn', m, f, bound),
    error: (m, f) => emit('error', m, f, bound), fatal: (m, f) => emit('fatal', m, f, bound),
    withContext: (more) => make({ ...bound, ...more }),
  };
}

/** The application logger. Import this; do not construct loggers or call console.* in production code (§190/§366). */
export const log: AppLogger = make({});

/** §29: log an unexpected exception with class, safe message, internal stack, and the ambient ids. */
export function logException(e: unknown, fields: Record<string, unknown> = {}): void {
  const err = e instanceof Error ? e : new Error(String(e));
  log.error(err.message || 'unhandled_error', { ...fields, exception: { name: err.name, message: err.message, stack: err.stack } });
}
