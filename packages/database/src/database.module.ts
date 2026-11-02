// database.module.ts — @aipowersalon/database: the global Nest module exposing DATABASE (primary) and DATABASE_READ
// (replica, falling back to the primary when no DATABASE_REPLICA_URL is configured). Both are null when Postgres is
// not in use. forRoot() takes the app's pool hook (query telemetry) — this package never imports the app.
import { Global, Inject, Injectable, Module, Optional, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { DATABASE, DATABASE_READ, DATABASE_WORKER, createDatabase, createReadDatabase, createWorkerDatabase, type AppDatabase, type DatabaseOptions } from './kysely.provider';

/** Closes the pools when the application shuts down (after the HTTP server has drained). Before Oct 6 2026 nothing did:
 *  on SIGTERM the open connections were dropped by the process exit instead of being returned, and Postgres logged
 *  every one as an unexpected EOF. The read handle is closed only when it is a separate replica pool. */
@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Optional() @Inject(DATABASE) private readonly primary: AppDatabase, @Optional() @Inject(DATABASE_READ) private readonly read: AppDatabase,
              @Optional() @Inject(DATABASE_WORKER) private readonly worker?: AppDatabase) {}
  async onApplicationShutdown(): Promise<void> {
    const handles = [this.primary, this.read && this.read !== this.primary ? this.read : null, this.worker && this.worker !== this.primary ? this.worker : null].filter(Boolean) as NonNullable<AppDatabase>[];
    await Promise.all(handles.map((h) => h.destroy().catch(() => undefined)));
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(opts: DatabaseOptions = {}): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DATABASE, useFactory: () => createDatabase(opts) },
        { provide: DATABASE_READ, useFactory: (primary) => createReadDatabase(primary, opts), inject: [DATABASE] },
        { provide: DATABASE_WORKER, useFactory: () => createWorkerDatabase(opts) },
        DatabaseShutdown,
      ],
      exports: [DATABASE, DATABASE_READ, DATABASE_WORKER],
    };
  }
}
