export class Reflector { get(k, t) { return globalThis.Reflect.getMetadata?.(k, t); } getAllAndOverride(k, ts) { for (const t of ts ?? []) { const v = this.get(k, t); if (v !== undefined) return v; } } }
export const APP_INTERCEPTOR = 'APP_INTERCEPTOR', APP_GUARD = 'APP_GUARD', APP_FILTER = 'APP_FILTER', APP_PIPE = 'APP_PIPE';
export class DiscoveryService {} export class MetadataScanner {} export class ExternalContextCreator {} export class ModuleRef {} export class HttpAdapterHost {}
export const NestFactory = {};
