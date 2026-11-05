// graceful-shutdown.vitest.spec.ts — Phase 1 (BUILD_PLAN_2026-10-06): SIGTERM with live SSE clients finishes.
//
// The bug: RealtimeStreamFactory drained its streams in onApplicationShutdown. Nest calls that hook only after
// httpServer.close() resolves — and close() waits for every open connection. An SSE stream never ends by itself, so the
// drain never ran: the instance hung on shutdown until the platform killed it, and its clients were cut off without
// the "reconnect elsewhere" frame. This boots a real Nest HTTP server with a live stream and closes it.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Controller, Inject, Module, Req, Sse, type MessageEvent } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { REALTIME } from '@aipowersalon/realtime-contracts';
import http from 'node:http';
import type { Observable } from 'rxjs';
import { RealtimeStreamFactory } from './realtime-stream';
import { InProcessEmitter } from './realtime.gateway';
import { HealthController } from '../health/health.controller';

@Controller('t')
class StreamController {
  constructor(@Inject(RealtimeStreamFactory) private readonly f: RealtimeStreamFactory) {}   // explicit: vitest emits no decorator metadata
  @Sse('stream')
  stream(@Req() req: any): Observable<MessageEvent> {
    req.ctx = { tenantId: '11111111-1111-1111-1111-111111111111', branchId: '', userId: 'u-shutdown', role: 'OWNER', permissions: [] };
    return this.f.open(req, () => ['tenant:11111111-1111-1111-1111-111111111111']);
  }
}

@Module({
  controllers: [StreamController, HealthController],
  providers: [{ provide: REALTIME, useValue: new InProcessEmitter() }, RealtimeStreamFactory],
})
class ShutdownTestModule {}

describe('graceful shutdown with live SSE clients', () => {
  it('app.close() completes promptly, the client is told to reconnect first, and readiness reports shutting_down', async () => {
    const app = await NestFactory.create(ShutdownTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as any).port;
    const health = app.get(HealthController);

    let body = ''; let endedFlag = false;
    const ended = new Promise<void>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/t/stream', headers: { accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => { endedFlag = true; resolve(); });
        res.on('close', () => resolve());
      });
      req.on('error', () => resolve());
    });
    // Wait until the stream is live (the "connected" frame has arrived).
    for (let i = 0; i < 100 && !body.includes('connected'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(body).toContain('connected');

    const started = Date.now();
    const closed = app.close().then(() => 'closed');
    const outcome = await Promise.race([closed, new Promise((r) => setTimeout(() => r('hung'), 5_000))]);
    expect(outcome).toBe('closed');
    // Well under the 5 s keep-alive timeout: the socket was idle when the server closed, nothing waited it out.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(endedFlag).toBe(true);
    await ended;
    expect(body).toContain('reconnect_requested');
    expect(body).toContain('server_shutdown');

    const ready: any = await health.ready(undefined);
    expect(ready.failed).toContain('shutting_down');
  }, 15_000);
});
