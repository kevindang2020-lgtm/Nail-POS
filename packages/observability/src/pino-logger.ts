// pino-logger.ts — structured JSON logging for production observability (CloudWatch-friendly).
// Swapped in ONLY when NODE_ENV=production (see main.ts), so local/dev output and the entire test suite are unchanged.
// Level via LOG_LEVEL (default 'info'). Authorization/cookie/password/token/secret fields are redacted.
import type { LoggerService } from '@nestjs/common';
import pino from 'pino';

export class PinoLoggerService implements LoggerService {
  private readonly logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'aipowersalon-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret', '*.mfaCode'],
      remove: true,
    },
  });

  private contextOf(optionalParams: any[]): string | undefined {
    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  log(message: any, ...optionalParams: any[]) {
    this.logger.info({ context: this.contextOf(optionalParams) }, String(message));
  }
  error(message: any, ...optionalParams: any[]) {
    // Nest calls error(message, trace?, context?)
    const context = this.contextOf(optionalParams);
    const trace = optionalParams.length >= 2 ? optionalParams[0] : undefined;
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: any, ...optionalParams: any[]) {
    this.logger.warn({ context: this.contextOf(optionalParams) }, String(message));
  }
  debug(message: any, ...optionalParams: any[]) {
    this.logger.debug({ context: this.contextOf(optionalParams) }, String(message));
  }
  verbose(message: any, ...optionalParams: any[]) {
    this.logger.trace({ context: this.contextOf(optionalParams) }, String(message));
  }
  fatal(message: any, ...optionalParams: any[]) {
    this.logger.fatal({ context: this.contextOf(optionalParams) }, String(message));
  }
}
