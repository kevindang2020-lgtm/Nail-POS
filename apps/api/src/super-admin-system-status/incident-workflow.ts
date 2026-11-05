// incident-workflow.ts — Constitution 11 §168–176: the incident lifecycle, its timeline, and alert promotion.
//
// Hardens status_incidents IN PLACE (audit decision D6). Every change goes through checkIncidentTransition — the one
// rule set — and writes a status_incident_events row, so the timeline (§170) is a by-product of doing the work, not
// something an operator has to remember to fill in. The status route now comes here; there is no second path.
//
// §176 PROMOTION. A single alert is not always an incident. Promoting one creates the incident with its severity,
// component and DETECTION time taken from the alert (so MTTD is measured from when monitoring noticed, not from when
// a human clicked), writes the first two timeline entries, and links both ways — an alert already promoted returns
// its existing incident instead of opening a second.
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { checkIncidentTransition, postmortemsOwed, SEV_LABEL } from './system-status-core';
import { canMoveToSql } from '@aipowersalon/database';
import { STATUS_INCIDENT } from './incident-lifecycle';

/** Alert severity → incident severity. The alerts table and status_incidents share the vocabulary already. */
const SEVERITY_FROM_ALERT: Record<string, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };

@Injectable()
export class IncidentWorkflowService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  private async load(idOrRef: string) {
    const r = await sql<any>`select id, incident_reference, status, severity, recovery_owner, component_key, title from status_incidents
                             where id::text = ${idOrRef} or incident_reference = ${idOrRef} limit 1`.execute(this.db);
    if (!r.rows[0]) throw new NotFoundException('Incident not found.');
    return r.rows[0];
  }

  // `at` stamps an entry with the moment it HAPPENED rather than when it was written. The timeline orders by
  // (created_at, id) and id is a random UUID, so two entries written in the same transaction (same now()) came back in
  // random order — a promoted alert's timeline showed "promoted" before "detected" about half the time.
  private async event(incidentId: string, kind: string, body: string, actor: string | null, ref: string | null = null, at: Date | string | null = null) {
    if (at) await sql`insert into status_incident_events (incident_id, kind, body, actor, ref, created_at) values (${incidentId}, ${kind}, ${body}, ${actor}, ${ref}, ${at as any})`.execute(this.db);
    else await sql`insert into status_incident_events (incident_id, kind, body, actor, ref) values (${incidentId}, ${kind}, ${body}, ${actor}, ${ref})`.execute(this.db);
  }

  /** §169–175: move an incident along its lifecycle. Returns errors instead of throwing, like the route always has. */
  async transition(idOrRef: string, to: string, opts: { actor?: string | null; resolution?: string | null } = {}) {
    const inc = await this.load(idOrRef);
    const errors = checkIncidentTransition({ status: inc.status, severity: inc.severity, commander: inc.recovery_owner }, to, opts.resolution);
    if (errors.length) return { ok: false as const, errors };
    if (inc.status === to) return { ok: true as const, incident: { id: inc.id, status: to } };
    const resolving = to === 'resolved';
    await sql`update status_incidents set status = ${to},
                resolved_at = ${resolving ? sql`now()` : sql`resolved_at`},
                resolution = ${resolving && opts.resolution ? opts.resolution : sql`resolution`}
              where id = ${inc.id} and ${canMoveToSql(STATUS_INCIDENT, to)}`.execute(this.db);
    await this.event(inc.id, resolving ? 'resolution' : 'status_change',
      resolving ? `Resolved: ${opts.resolution ?? '(no resolution recorded)'}` : `Status ${inc.status} → ${to}`, opts.actor ?? null);
    return { ok: true as const, incident: { id: inc.id, status: to } };
  }

  /** §171: the incident commander. */
  async assignCommander(idOrRef: string, commander: string, actor: string | null = null) {
    if (!String(commander ?? '').trim()) throw new BadRequestException('A commander is required.');
    const inc = await this.load(idOrRef);
    await sql`update status_incidents set recovery_owner = ${commander} where id = ${inc.id}`.execute(this.db);
    await this.event(inc.id, 'commander_assigned', `Incident commander: ${commander}`, actor);
    return { ok: true as const };
  }

  /** §170: a manual timeline entry — an action taken, a provider update, a deployment, a note. */
  async addEntry(idOrRef: string, kind: 'action' | 'provider_update' | 'deployment' | 'note', body: string, actor: string | null = null, ref: string | null = null) {
    if (!['action', 'provider_update', 'deployment', 'note'].includes(kind)) throw new BadRequestException('Invalid timeline entry kind.');
    if (!String(body ?? '').trim()) throw new BadRequestException('A timeline entry needs text.');
    const inc = await this.load(idOrRef);
    await this.event(inc.id, kind, body.slice(0, 4000), actor, ref);
    return { ok: true as const };
  }

  async timeline(idOrRef: string) {
    const inc = await this.load(idOrRef);
    const r = await sql<any>`select kind, body, actor, ref, created_at from status_incident_events where incident_id = ${inc.id} order by created_at, id`.execute(this.db);
    return { incidentId: inc.id, severity: inc.severity, sev: SEV_LABEL[inc.severity] ?? inc.severity, entries: r.rows.map((e: any) => ({ kind: e.kind, body: e.body, actor: e.actor, ref: e.ref, at: new Date(e.created_at).toISOString() })) };
  }

  /** §176: promote a PLATFORM alert into an incident. Idempotent — a promoted alert returns its incident. */
  async promoteAlert(alertId: string, actor: string | null = null) {
    const a = (await sql<any>`select id, title, message, severity, related_record_id, created_at, incident_id from alerts
                              where id::text = ${alertId} and tenant_id is null limit 1`.execute(this.db)).rows[0];
    if (!a) throw new NotFoundException('Platform alert not found.');
    if (a.incident_id) return { ok: true as const, incidentId: a.incident_id, created: false };
    const severity = SEVERITY_FROM_ALERT[a.severity] ?? 'medium';
    const component = String(a.related_record_id ?? '').replace(/^slo:.*$/, '') || null;
    const created = (await sql<any>`insert into status_incidents (title, status, impact, severity, component_key, started_at, detected_at, promoted_from_alert_id, incident_reference)
        values (${a.title}, 'investigating', ${severity === 'critical' ? 'critical' : severity === 'high' ? 'major' : 'minor'}, ${severity}, ${component},
                now(), ${a.created_at}, ${a.id}, ${'INC-' + String(Date.now()).slice(-8)})
        returning id`.execute(this.db)).rows[0];
    await sql`update alerts set incident_id = ${created.id} where id = ${a.id} and tenant_id is null`.execute(this.db);
    await this.event(created.id, 'detected', `Detected by monitoring: ${a.title}`, null, a.id, a.created_at);   // detected WHEN monitoring saw it
    await this.event(created.id, 'promoted_from_alert', `Promoted to a ${SEV_LABEL[severity] ?? severity} incident. ${a.message ?? ''}`.slice(0, 4000), actor, a.id);
    return { ok: true as const, incidentId: created.id, created: true };
  }

  /** §175: serious incidents resolved without a post-incident report. */
  async postmortemsOwed() {
    const incidents = (await sql<any>`select id, incident_reference as reference, severity, status from status_incidents where status = 'resolved'`.execute(this.db)).rows;
    const reported = new Set<string>((await sql<any>`select incident_reference from status_post_incident_reports where incident_reference is not null`.execute(this.db)).rows.map((r: any) => r.incident_reference));
    return { owed: postmortemsOwed(incidents, reported) };
  }
}
