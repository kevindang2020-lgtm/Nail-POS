// validated-routes.ts — BUILD_PLAN Phase 12 (#17): the route-by-route check every module's validated-bodies spec runs.
// For one route: its handler carries @Body(ValidatedBody(...)) (found through the caller's bodyPipeOf), the bodies
// today's clients send pass INTACT, the same bodies plus an unknown field come back without it (or, for a STRICT schema,
// are refused with a 400 naming it — Security Deep Scan §40), a bad body is a 400
// VALIDATION_FAILED naming the field, and an undeclared tenantId is refused. Returns the failures (empty = pass).
export interface RouteBodyCase {
  route: string;
  ctl: abstract new (...a: any[]) => unknown;
  handler: string;
  /** bodies copied from the client code that calls the route today */
  today: Record<string, unknown>[];
  /** [a bad body, the field path the 400 must name] */
  bad: [unknown, string];
  /** the schema deliberately KEEPS extra scalar keys (a stored JSON blob such as customer notes) */
  keepsUnknown?: boolean;
}
type Pipe = { transform(v: unknown): unknown; schema?: Record<string, unknown>; opts?: { strict?: boolean } };
const attempt = (pipe: Pipe, body: unknown): { ok: true; value: unknown } | { ok: false; status?: number; res?: any } => {
  try { return { ok: true, value: pipe.transform(body) }; } catch (e: any) { return { ok: false, status: e?.getStatus?.(), res: e?.getResponse?.() }; }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function routeBodyFailures(c: RouteBodyCase, bodyPipeOf: (ctl: any, handler: string) => Pipe | null): string[] {
  const out: string[] = [];
  const pipe = bodyPipeOf(c.ctl, c.handler);
  if (!pipe) return [`${c.route}: the handler's @Body is not ValidatedBody(...)`];
  for (const body of c.today) {
    const r = attempt(pipe, body);
    if (!r.ok) { out.push(`${c.route}: today's body was refused ${JSON.stringify(body).slice(0, 200)} → ${JSON.stringify((r as any).res?.details?.fields ?? r).slice(0, 300)}`); continue; }
    if (!same(r.value, body)) out.push(`${c.route}: today's body was changed ${JSON.stringify(body).slice(0, 200)} → ${JSON.stringify(r.value).slice(0, 200)}`);
    const x = attempt(pipe, { ...body, __unknownLegacyField: 'x' });
    // Security Deep Scan §40: a STRICT schema (S.strict / ValidatedBody(s, { strict: true })) refuses the unknown field
    // with 400 VALIDATION_FAILED naming it, instead of stripping it.
    // keepsUnknown: the extra key is covered by the schema's additionalProperties, so even a strict schema keeps it.
    if (!c.keepsUnknown && (pipe.schema?.['x-strict'] === true || pipe.opts?.strict === true)) {
      const paths = (!x.ok ? ((x as any).res?.details?.fields ?? []) : []).map((f: any) => f.path);
      if (x.ok || (x as any).status !== 400 || !paths.includes('__unknownLegacyField')) out.push(`${c.route}: strict schema did not refuse an unknown field`);
    } else if (!x.ok || !same(x.value, c.keepsUnknown ? { ...body, __unknownLegacyField: 'x' } : body)) out.push(`${c.route}: an unknown field was ${c.keepsUnknown ? 'not kept' : 'not stripped'}`);
  }
  const bad = attempt(pipe, c.bad[0]);
  if (bad.ok) out.push(`${c.route}: the bad body was accepted ${JSON.stringify(c.bad[0]).slice(0, 200)}`);
  else {
    const paths = ((bad as any).res?.details?.fields ?? []).map((f: any) => f.path);
    if ((bad as any).status !== 400 || (bad as any).res?.code !== 'VALIDATION_FAILED' || !paths.includes(c.bad[1])) out.push(`${c.route}: the bad body did not answer 400 VALIDATION_FAILED naming '${c.bad[1]}' (got ${(bad as any).status} ${JSON.stringify(paths)})`);
  }
  const t = attempt(pipe, { ...(c.today[0] ?? {}), tenantId: '11111111-1111-4111-8111-111111111111' });
  if (t.ok) out.push(`${c.route}: an undeclared tenantId was accepted`);
  return out;
}
