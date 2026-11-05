// @aipowersalon/observability/nest — the NestJS-bound half of the kernel (Constitution 13 §113): the request-context
// middleware, the platform exception filter, the request/correlation headers and the pino LoggerService. The root entry
// stays framework-free (logging, metrics, ids, redaction, the telemetry adapters) so core specs, workers and packages
// can import it without dragging @nestjs/common in.
export { RequestContextMiddleware, PlatformExceptionFilter, routeTemplateOf, fingerprint as errorFingerprint, REQUEST_ID_HEADER, CORRELATION_ID_HEADER, TRACEPARENT_HEADER } from '../request-telemetry';
export { PinoLoggerService } from '../pino-logger';
export { apiError } from './api-error';   // Constitution 5 §30: throw a registered error
