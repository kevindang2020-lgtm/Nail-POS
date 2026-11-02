// Validates the ENTIRE Nest DI graph — every provider/injection across all modules — by instantiating AppModule.
// No DATABASE_URL → in-memory fallbacks; this checks wiring, not data.
import { NestFactory } from '@nestjs/core';
process.env.NODE_ENV = 'test';
try {
  const { AppModule } = await import('../dist/app.module.js');
  // abortOnError:false — otherwise Nest's ExceptionsZone calls process.exit(1) BEFORE our catch runs, and the
  // check fails with no message at all (found Sep 19 2026: an exported-but-not-provided service produced a bare
  // exit code and forty minutes of bisecting). Errors now reach the catch below and are printed.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.close();
  console.log('DI_GRAPH_OK — all providers resolved, no missing deps or cycles');
  process.exit(0);
} catch (e) {
  console.log('DI_GRAPH_FAIL:', (e && e.message ? e.message : String(e)).split('\n')[0]);
  process.exit(1);
}
