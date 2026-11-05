// Constitution 7 §5 — /api/v1/platform/* reaches the same controller as /super-admin/*, with module middleware seeing
// the rewritten path (the real app's order: our Express instance rewrites before Nest registers anything).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import 'reflect-metadata';
import { Controller, Get, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { platformAliasMiddleware, rewritePlatformAlias } from './platform-alias';

describe('rewritePlatformAlias', () => {
  it('maps /api/v1/platform/* onto /super-admin/*, keeps the query, and leaves everything else alone', () => {
    expect(rewritePlatformAlias('/api/v1/platform/tenants/t1/health')).toBe('/super-admin/tenants/t1/health');
    expect(rewritePlatformAlias('/api/v1/platform/tenant-health?sort=name')).toBe('/super-admin/tenant-health?sort=name');
    expect(rewritePlatformAlias('/api/v1/platform')).toBe('/super-admin');
    expect(rewritePlatformAlias('/platform/branding')).toBeNull();                 // the live public route is never shadowed
    expect(rewritePlatformAlias('/api/v1/platformx/y')).toBeNull();
    expect(rewritePlatformAlias('/super-admin/tenants')).toBeNull();
  });
});

const seen: string[] = [];
@Injectable() class RecordPath implements NestMiddleware { use(req: any, _res: any, next: () => void) { seen.push(String(req.originalUrl)); next(); } }
@Controller('super-admin/ping') class PingController { @Get() ping(@Req() req: any) { return { url: req.url, alias: !!req.platformAlias }; } }
@Module({ controllers: [PingController] })
class TestModule implements NestModule { configure(c: MiddlewareConsumer) { c.apply(RecordPath).forRoutes('*'); } }

describe('the alias in a real Nest app', () => {
  let app: any; let base = '';
  beforeAll(async () => {
    const server = express(); server.use(platformAliasMiddleware);
    app = await NestFactory.create(TestModule, new ExpressAdapter(server), { logger: false });
    await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });
  afterAll(async () => { await app?.close(); });
  it('both spellings reach the same handler, and module middleware sees /super-admin (so its exclusions still apply)', async () => {
    const a = await (await fetch(`${base}/super-admin/ping`)).json();
    const b = await (await fetch(`${base}/api/v1/platform/ping`)).json();
    expect(a).toEqual({ url: '/super-admin/ping', alias: false });
    expect(b).toEqual({ url: '/super-admin/ping', alias: true });
    expect(seen).toEqual(['/super-admin/ping', '/super-admin/ping']);
  });
});
