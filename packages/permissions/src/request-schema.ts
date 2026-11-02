// request-schema.ts — Constitution 5 / BUILD_PLAN Phase 12 (#17): the ONE request-body validation mechanism.
//
// A body schema is a plain JSON-Schema (draft-07 subset) object, so the same object documents the route in the OpenAPI
// spec and validates it at run time. This file is framework-free (no Nest, no ajv): the Nest pipe that applies it is
// `ValidatedBody(schema)` in ./guards/validated-body.ts.
//
// Why not ajv: the only ajv in the tree is v6, an undeclared transitive dependency of the lint tool chain — a runtime
// validator the API's production image would load without the package ever declaring it. The subset below is what the
// request bodies need, is ~200 lines, and is unit-tested keyword by keyword (request-schema.test.ts).
//
// Semantics (the Phase 12 contract):
//   • UNKNOWN properties are STRIPPED (the writable-field whitelist, #18) — a client that sends an extra field keeps
//     working; the handler never sees the field.
//   • A DANGEROUS unknown property is REFUSED (400), never silently dropped: a client that sends `tenantId` /
//     `permissions` / `platformRole` to a route that does not declare it learns at once that it cannot. A schema adds
//     its own with `x-forbidden` (e.g. `status` on a money row). Prototype keys (__proto__, constructor, prototype)
//     are always dropped.
//   • STRICT mode (Security Deep Scan §40 / §110, opt-in): a schema marked `'x-strict': true` (S.strict(schema)), or a
//     call with { strict: true }, REFUSES every unknown property with 400 ("is not an allowed field") instead of
//     stripping it — the object it is set on and every object nested inside it (unless a nested schema says
//     `'x-strict': false`). Enabled first on the auth, merchant / payment-configuration and platform-security bodies.
//   • No coercion: '5' stays a string unless the schema accepts a string. Schemas list every type a client SENDS today.
//   • Errors carry a field path (`items[0].priceCents`) and a short message; the submitted value is never echoed.
export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface BodySchema {
  type?: JsonType | JsonType[];
  properties?: Record<string, BodySchema>;
  required?: string[];
  /** false (default for objects) → unknown properties are stripped; true → kept as-is; a schema → each extra value validated */
  additionalProperties?: boolean | BodySchema;
  items?: BodySchema;
  minItems?: number;
  maxItems?: number;
  enum?: readonly (string | number | boolean | null)[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'uuid' | 'date' | 'date-time' | 'email' | 'time';
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  anyOf?: BodySchema[];
  description?: string;
  /** unknown properties that are refused (400) instead of stripped — merged with DANGEROUS_UNKNOWN */
  'x-forbidden'?: readonly string[];
  /** Security Deep Scan §40: refuse (400) EVERY unknown property here and in nested objects, instead of stripping */
  'x-strict'?: boolean;
  /** Security Deep Scan §40 (reviewed open schemas): the deepest nesting of objects / arrays the value may have (the value
   *  itself is depth 1) — a free-form part kept whole is still bounded */
  'x-maxDepth'?: number;
  /** Security Deep Scan §40 (reviewed open schemas): the most keys + array items the value may hold, counted at every level */
  'x-maxNodes'?: number;
}

/** rule + params (Vietnamese POS §2 / §21 / §58, Oct 27 2026 — additive): a stable code for what failed, so a client words the
 *  message in its own language (POS: ns/errors `errors.rule.<RULE>` with the field's label) instead of showing `message`. */
export type FieldRule = 'REQUIRED' | 'REQUIRED_ONE_OF' | 'TYPE' | 'ENUM' | 'NOT_EMPTY' | 'MIN_LENGTH' | 'MAX_LENGTH' | 'FORMAT' | 'NUMBER' | 'MIN'
  | 'MIN_EXCLUSIVE' | 'MAX' | 'MIN_ITEMS' | 'MAX_ITEMS' | 'NOT_ALLOWED' | 'UNKNOWN_FIELD' | 'SHAPE';
export interface FieldError { path: string; message: string; rule?: FieldRule; params?: Record<string, string | number> }
export type ValidationResult<T = unknown> = { ok: true; value: T; stripped: string[] } | { ok: false; errors: FieldError[] };

/** Undeclared properties that are refused everywhere: authority a body may never carry. */
export const DANGEROUS_UNKNOWN: readonly string[] = Object.freeze(['tenantId', 'tenant_id', 'permissions', 'platformRole', 'platform_role', 'isSuperAdmin', 'is_super_admin']);
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ERRORS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function typeOf(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v as JsonType;
}
function typeMatches(want: JsonType, got: JsonType, v: unknown): boolean {
  if (want === got) return true;
  if (want === 'number' && got === 'integer') return true;
  if (want === 'number' || want === 'integer') return false;
  return want === 'object' && got === 'object' && v !== null;
}
const join = (base: string, key: string | number) => (typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key);
const label = (p: string) => p || '(body)';

/** 'depth' / 'nodes' when a value nests deeper / holds more keys + items than allowed (stops counting at the first excess) */
function measure(root: unknown, maxDepth: number, maxNodes: number): 'depth' | 'nodes' | null {
  let nodes = 0;
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (d > maxDepth) return 'depth';
    const kids = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    nodes += kids.length;
    if (nodes > maxNodes) return 'nodes';
    for (const k of kids) if (k !== null && typeof k === 'object') stack.push([k, d + 1]);
  }
  return null;
}

function walk(s: BodySchema, v: unknown, path: string, errs: FieldError[], stripped: string[], strictIn = false): unknown {
  if (errs.length >= MAX_ERRORS) return v;
  const strict = s['x-strict'] ?? strictIn;
  if (s.anyOf?.length) {
    const tried: FieldError[][] = [];
    for (const alt of s.anyOf) {
      const e: FieldError[] = []; const st: string[] = [];
      const out = walk(alt, v, path, e, st, strict);
      if (!e.length) { stripped.push(...st); return out; }
      // an alternative whose own type fits the value (the errors are inside it) says what is wrong more precisely
      if (!e.some((x) => x.path === label(path) && x.rule === 'TYPE')) tried.push(e);
    }
    const best = tried.sort((a, b) => a.length - b.length);
    if (best.length && (best.length === 1 || best[0].length < best[1].length)) { errs.push(...best[0]); return v; }
    errs.push({ path: label(path), message: 'does not match any allowed shape', rule: 'SHAPE' });
    return v;
  }
  if ((s['x-maxDepth'] !== undefined || s['x-maxNodes'] !== undefined) && v !== null && typeof v === 'object') {
    const m = measure(v, s['x-maxDepth'] ?? Infinity, s['x-maxNodes'] ?? Infinity);
    if (m) { errs.push({ path: label(path), message: m === 'depth' ? `may nest at most ${s['x-maxDepth']} levels` : `may hold at most ${s['x-maxNodes']} values`, rule: 'SHAPE', params: m === 'depth' ? { maxDepth: s['x-maxDepth']! } : { maxNodes: s['x-maxNodes']! } }); return v; }
  }
  const types = s.type === undefined ? null : Array.isArray(s.type) ? s.type : [s.type];
  const got = typeOf(v);
  if (types && !types.some((t) => typeMatches(t, got, v))) {
    errs.push({ path: label(path), message: `must be ${types.join(' or ')}`, rule: 'TYPE', params: { type: types.join(' | ') } });
    return v;
  }
  if (s.enum && !s.enum.includes(v as any)) { errs.push({ path: label(path), message: `must be one of: ${s.enum.map(String).join(', ')}`, rule: 'ENUM', params: { allowed: s.enum.map(String).join(', ') } }); return v; }
  if (got === 'string') {
    const str = v as string;
    if (s.minLength !== undefined && str.length < s.minLength) errs.push({ path: label(path), message: s.minLength === 1 ? 'must not be empty' : `must be at least ${s.minLength} characters`, ...(s.minLength === 1 ? { rule: 'NOT_EMPTY' } : { rule: 'MIN_LENGTH', params: { min: s.minLength } }) });
    if (s.maxLength !== undefined && str.length > s.maxLength) errs.push({ path: label(path), message: `must be at most ${s.maxLength} characters`, rule: 'MAX_LENGTH', params: { max: s.maxLength } });
    if (s.pattern && !new RegExp(s.pattern).test(str)) errs.push({ path: label(path), message: 'has an invalid format', rule: 'FORMAT' });
    if (s.format) {
      const re = s.format === 'uuid' ? UUID : s.format === 'date' ? DATE : s.format === 'date-time' ? DATE_TIME : s.format === 'time' ? TIME : EMAIL;
      if (!re.test(str) || ((s.format === 'date' || s.format === 'date-time') && Number.isNaN(Date.parse(str.length === 10 ? `${str}T00:00:00Z` : str)))) {
        errs.push({ path: label(path), message: `must be a valid ${s.format}`, rule: 'FORMAT', params: { format: s.format } });
      }
    }
    return v;
  }
  if (got === 'number' || got === 'integer') {
    const n = v as number;
    if (!Number.isFinite(n)) { errs.push({ path: label(path), message: 'must be a finite number', rule: 'NUMBER' }); return v; }
    if (s.minimum !== undefined && n < s.minimum) errs.push({ path: label(path), message: `must be ≥ ${s.minimum}`, rule: 'MIN', params: { min: s.minimum } });
    if (s.exclusiveMinimum !== undefined && n <= s.exclusiveMinimum) errs.push({ path: label(path), message: `must be > ${s.exclusiveMinimum}`, rule: 'MIN_EXCLUSIVE', params: { min: s.exclusiveMinimum } });
    if (s.maximum !== undefined && n > s.maximum) errs.push({ path: label(path), message: `must be ≤ ${s.maximum}`, rule: 'MAX', params: { max: s.maximum } });
    return v;
  }
  if (got === 'array') {
    const a = v as unknown[];
    if (s.minItems !== undefined && a.length < s.minItems) errs.push({ path: label(path), message: `must have at least ${s.minItems} item(s)`, rule: 'MIN_ITEMS', params: { min: s.minItems } });
    if (s.maxItems !== undefined && a.length > s.maxItems) { errs.push({ path: label(path), message: `must have at most ${s.maxItems} items`, rule: 'MAX_ITEMS', params: { max: s.maxItems } }); return v; }
    return s.items ? a.map((x, i) => walk(s.items!, x, join(path, i), errs, stripped, strict)) : a;
  }
  if (got === 'object' && (s.properties || s.additionalProperties !== undefined || (types && types.includes('object')))) {
    const o = v as Record<string, unknown>;
    const props = s.properties ?? {};
    for (const r of s.required ?? []) if (o[r] === undefined) errs.push({ path: label(join(path, r)), message: 'is required', rule: 'REQUIRED' });
    const forbidden = new Set([...DANGEROUS_UNKNOWN, ...(s['x-forbidden'] ?? [])]);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (PROTO_KEYS.has(k)) { stripped.push(join(path, k)); continue; }
      const val = o[k];
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        if (val === undefined) continue;
        out[k] = walk(props[k], val, join(path, k), errs, stripped, strict);
      } else if (forbidden.has(k)) {
        errs.push({ path: label(join(path, k)), message: 'may not be set by the client', rule: 'NOT_ALLOWED' });
      } else if (s.additionalProperties === true) {
        out[k] = val;
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        out[k] = walk(s.additionalProperties, val, join(path, k), errs, stripped, strict);
      } else if (strict) {
        errs.push({ path: label(join(path, k)), message: 'is not an allowed field', rule: 'UNKNOWN_FIELD' });
      } else {
        stripped.push(join(path, k));
      }
    }
    return out;
  }
  return v;
}

/** Validate (and strip) a request body. `undefined` (no JSON body) is validated as `{}` for an object schema. */
export function validateBody<T = unknown>(schema: BodySchema, input: unknown, opts: { strict?: boolean } = {}): ValidationResult<T> {
  const objectSchema = schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'));
  const v = input === undefined && objectSchema ? {} : input;
  const errors: FieldError[] = []; const stripped: string[] = [];
  const value = walk(schema, v, '', errors, stripped, opts.strict === true);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as T, stripped };
}

/** §40 reviewed exception bounds for a provider envelope: no real processor / bank / voice payload nests 32 levels or carries
 *  100,000 keys + items (a Retell call envelope with a long word-level transcript is the largest seen, a few thousand); the
 *  route's body-size limit bounds the bytes. */
export const WEBHOOK_MAX_DEPTH = 32;
export const WEBHOOK_MAX_NODES = 100_000;

// ── builders: terse, but they emit plain JSON-Schema (so the object is also the OpenAPI request schema) ─────────────
type Opts = Omit<BodySchema, 'type'>;
export const S = {
  object: (properties: Record<string, BodySchema>, required: string[] = [], extra: Opts = {}): BodySchema => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...extra }),
  string: (o: Opts = {}): BodySchema => ({ type: 'string', ...o }),
  /** a non-empty string up to `max` characters */
  text: (max = 500, o: Opts = {}): BodySchema => ({ type: 'string', maxLength: max, ...o }),
  uuid: (o: Opts = {}): BodySchema => ({ type: 'string', format: 'uuid', ...o }),
  date: (o: Opts = {}): BodySchema => ({ type: 'string', format: 'date', ...o }),
  dateTime: (o: Opts = {}): BodySchema => ({ type: 'string', format: 'date-time', ...o }),
  email: (o: Opts = {}): BodySchema => ({ type: 'string', format: 'email', maxLength: 254, ...o }),
  integer: (o: Opts = {}): BodySchema => ({ type: 'integer', ...o }),
  /** integer cents ≥ 0 (money is integer cents everywhere) */
  cents: (o: Opts = {}): BodySchema => ({ type: 'integer', minimum: 0, ...o }),
  number: (o: Opts = {}): BodySchema => ({ type: 'number', ...o }),
  boolean: (): BodySchema => ({ type: 'boolean' }),
  enumOf: (values: readonly (string | number | boolean | null)[], o: Opts = {}): BodySchema => ({ enum: values, ...o }),
  array: (items: BodySchema, o: Opts = {}): BodySchema => ({ type: 'array', items, ...o }),
  /** the schema, or null */
  nullable: (s: BodySchema): BodySchema => (s.anyOf ? { ...s, anyOf: [...s.anyOf, { type: 'null' }] } : s.enum ? { ...s, enum: [...s.enum, null] } : { ...s, type: [...(Array.isArray(s.type) ? s.type : s.type ? [s.type] : []), 'null'] as JsonType[] }),
  /** any of the given types (e.g. a number a client sends as a string) */
  oneOfTypes: (types: JsonType[], o: Opts = {}): BodySchema => ({ type: types, ...o }),
  /** a free-form JSON object kept whole (settings blobs, metadata) — use sparingly; prefer declared properties */
  freeObject: (o: Opts = {}): BodySchema => ({ type: 'object', additionalProperties: true, ...o }),
  any: (): BodySchema => ({}),
  /** Security Deep Scan §40: a PROVIDER WEBHOOK body (payments, bank, integrations, voice). The provider's signature over
   *  the RAW bytes (req.rawBody) is the authentication and is verified in the handler exactly as before; this only pins the
   *  shape — a JSON object (or a batch array), never a scalar — keeps every field as sent (nothing stripped, so a
   *  re-serialised fallback still matches), and declares the platform authority names as plain provider data so a
   *  processor payload that happens to carry `tenant_id` is not refused. */
  webhookEnvelope: (): BodySchema => ({ type: ['object', 'array'], additionalProperties: true, properties: Object.fromEntries(DANGEROUS_UNKNOWN.map((k) => [k, {}])), 'x-maxDepth': WEBHOOK_MAX_DEPTH, 'x-maxNodes': WEBHOOK_MAX_NODES }),
  /** Security Deep Scan §40: a reviewed OPEN part (kept whole — a settings blob, a provider envelope) bounded in depth and in
   *  the number of keys + items it may hold; the strict-bodies gate requires both on every open schema it lets stay open */
  bounded: (s: BodySchema, maxDepth: number, maxNodes: number): BodySchema => ({ ...s, 'x-maxDepth': maxDepth, 'x-maxNodes': maxNodes }),
  /** Security Deep Scan §40: the same schema, refusing unknown properties (here and nested) instead of stripping them */
  strict: (s: BodySchema): BodySchema => ({ ...s, 'x-strict': true }),
};
