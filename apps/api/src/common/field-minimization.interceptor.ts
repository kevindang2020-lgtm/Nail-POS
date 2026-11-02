// field-minimization.interceptor.ts — Constitution 7 §82 / §43: minimise every Super Admin response field by field for a
// caller whose platform role lacks a sensitive class's permission (field-policy.ts). A caller holding every key (today's
// PLATFORM_SUPER_ADMIN) takes the fast path — the response is untouched.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { hiddenClasses, minimizeFields, isPlatformPrincipal } from '@aipowersalon/permissions';

@Injectable()
export class FieldMinimizationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const path = String(req?.route?.path ?? req?.path ?? '');
    if (!isPlatformPrincipal(req?.ctx) || !path.startsWith('/super-admin')) return next.handle();
    const hidden = hiddenClasses(req.ctx.permissions);
    if (!hidden.length) return next.handle();
    return next.handle().pipe(map((body) => minimizeFields(body, hidden)));
  }
}
