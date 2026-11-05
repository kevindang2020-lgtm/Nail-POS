// http-compression.vitest.spec.ts — Smooth Refresh spec §88 over a REAL local HTTP server (Node's own client, no mocks):
// big JSON is gzipped, small JSON is not, and — the part that matters — an SSE stream is never compressed, so each event
// reaches the client as it is written instead of waiting in the compressor's buffer.
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { apiCompression } from './http-compression';

let server: http.Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function start(app: express.Express): Promise<number> {
  return new Promise((r) => { server = app.listen(0, () => r((server!.address() as AddressInfo).port)); });
}
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, headers: { 'accept-encoding': 'gzip', ...headers } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks), res }));
    });
    req.on('error', reject);
  });
}
function appWithRoutes() {
  const app = express();
  app.use(apiCompression());
  app.get('/big', (_req, res) => { res.json({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Customer ${i}`, status: 'booked' })) }); });
  app.get('/small', (_req, res) => { res.json({ appointments: [], cursor: 'v1.x' }); });
  app.get('/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders?.();
    res.write('data: {"event":"hello"}\n\n');
    (res as any).__later = setTimeout(() => { res.write('data: {"event":"appointment_updated"}\n\n'); res.end(); }, 400);
  });
  return app;
}

describe('API response compression (spec §88) — never on the realtime streams', () => {
  it('a large JSON response is gzipped and decodes to the same body', async () => {
    const port = await start(appWithRoutes());
    const r = await get(port, '/big');
    expect(r.headers['content-encoding']).toBe('gzip');
    const json = JSON.parse(zlib.gunzipSync(r.body).toString('utf8'));
    expect(json.items).toHaveLength(200);
    expect(r.headers.vary).toMatch(/accept-encoding/i);
  });

  it('a small response (a quiet change-feed tick) is left uncompressed', async () => {
    const port = await start(appWithRoutes());
    const r = await get(port, '/small');
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(r.body.toString('utf8')).cursor).toBe('v1.x');
  });

  it('an SSE stream is NOT compressed and its first event arrives immediately, before the stream ends', async () => {
    const port = await start(appWithRoutes());
    const firstEventAt = await new Promise<{ ms: number; enc: string | undefined; text: string }>((resolve, reject) => {
      const t0 = Date.now();
      const req = http.get({ port, path: '/stream', headers: { 'accept-encoding': 'gzip', accept: 'text/event-stream' } }, (res) => {
        res.once('data', (c: Buffer) => { resolve({ ms: Date.now() - t0, enc: res.headers['content-encoding'], text: c.toString('utf8') }); res.destroy(); });
      });
      req.on('error', (e: any) => { if (e.code !== 'ECONNRESET') reject(e); });
    });
    expect(firstEventAt.enc).toBeUndefined();
    expect(firstEventAt.text).toContain('"hello"');
    expect(firstEventAt.ms).toBeLessThan(300);              // the second event is only written at 400 ms
  });

  it('a client can opt out with x-no-compression', async () => {
    const port = await start(appWithRoutes());
    const r = await get(port, '/big', { 'x-no-compression': '1' });
    expect(r.headers['content-encoding']).toBeUndefined();
  });
});
