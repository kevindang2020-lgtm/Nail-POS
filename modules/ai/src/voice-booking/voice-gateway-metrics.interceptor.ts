// voice-gateway-metrics.interceptor.ts — records gateway operational metrics centrally, without touching any endpoint
// body. Maps the handler method name to a GwOp, counts the request, detects idempotent replays on success, and reads
// the stable error code off any thrown HttpException on failure. Bound only to the gateway controller.
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, HttpException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { VoiceGatewayMetricsService, type GwOp } from './voice-gateway-metrics.service';

const HANDLER_TO_OP: Record<string, GwOp> = {
  services: 'services', hours: 'hours', availability: 'availability', lookupOrCreateCustomer: 'customer',
  book: 'book', getAppointment: 'get_appointment', reschedule: 'reschedule', cancel: 'cancel', handoff: 'handoff',
};

@Injectable()
export class VoiceGatewayMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: VoiceGatewayMetricsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const op = HANDLER_TO_OP[context.getHandler()?.name];
    if (!op) return next.handle();
    this.metrics.request(op);
    return next.handle().pipe(tap({
      next: (val: any) => { if (val?.meta?.idempotentReplay) this.metrics.replay(); if (op === 'handoff' && val?.success) this.metrics.handoff(); },
      error: (err: any) => {
        const code = err instanceof HttpException ? ((err.getResponse() as any)?.error?.code ?? 'INTERNAL_ERROR') : 'INTERNAL_ERROR';
        this.metrics.error(op, code);
      },
    }));
  }
}
