// pino-logger.ts — structured JSON logging for production observability (CloudWatch-friendly).
// Swapped in ONLY when NODE_ENV=production (see main.ts), so local/dev output and the entire test suite are unchanged.
// Level via LOG_LEVEL (default 'info'). Authorization/cookie/password/token/secret fields are redacted.
import type { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { maskValueSecrets } from './redaction';

/** Security Deep Scan A12: Nest's messages are free text — value-mask them (bearer/JWT/card/provider keys) like every other log line. */
const m = (message: unknown): string => maskValueSecrets(String(message));

export class PinoLoggerService implements LoggerService {
  /** `destination`: where the lines go (stdout by default). Security Deep Scan §128: the log-capture test passes a capturing
   *  stream so it can scan exactly what production would write. */
  private readonly logger: pino.Logger;
  constructor(destination?: pino.DestinationStream) {
    this.logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'aipowersalon-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret', '*.mfaCode'],
      remove: true,
    },
    }, ...(destination ? [destination] : []));
  }

  private contextOf(optionalParams: any[]): string | undefined {
    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  log(message: any, ...optionalParams: any[]) {
    this.logger.info({ context: this.contextOf(optionalParams) }, m(message));
  }
  error(message: any, ...optionalParams: any[]) {
    // Nest calls error(message, trace?, context?)
    const context = this.contextOf(optionalParams);
    const trace = optionalParams.length >= 2 ? optionalParams[0] : undefined;
    this.logger.error({ context, trace: typeof trace === 'string' ? maskValueSecrets(trace) : trace }, m(message));
  }
  warn(message: any, ...optionalParams: any[]) {
    this.logger.warn({ context: this.contextOf(optionalParams) }, m(message));
  }
  debug(message: any, ...optionalParams: any[]) {
    this.logger.debug({ context: this.contextOf(optionalParams) }, m(message));
  }
  verbose(message: any, ...optionalParams: any[]) {
    this.logger.trace({ context: this.contextOf(optionalParams) }, m(message));
  }
  fatal(message: any, ...optionalParams: any[]) {
    this.logger.fatal({ context: this.contextOf(optionalParams) }, m(message));
  }
}
