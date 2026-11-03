// kysely.types.ts — typed DB schema for AIPowerSalon, derived from db/migrations.
// Columns mirror the SQL migrations exactly. Add more tables here as features get Kysely adapters.
import type { ColumnType, Generated } from 'kysely';

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface PaymentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; ticket_id: string | null;
  method: string; amount_cents: number; tip_cents: number; tax_cents: number; discount_cents: number;
  surcharge_cents: Generated<number>;
  status: string; created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  idempotency_key: string | null; change_due_cents: number; processor_transaction_id: string | null;
  processor: string | null; processor_reference_id: string | null; approved_at: TsNull; failed_at: TsNull;
  settlement_batch_id: string | null;   // Phase 10 (537/539): the processor settlement batch (payment_settlements.id)
  gift_card_last4: string | null;   // migration 515
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  stranded_at: TsNull;   // migration 549 (Phase 11): the stranded-attempt sweep could not verify this card charge
  payment_surface: string | null; device_id: string | null; card_brand: string | null; card_last4: string | null;   // migration 660 (Tap to Pay: surface dimension + safe card metadata)
}

export interface PaymentSignaturesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; payment_id: string; ticket_id: string | null;
  signature_png: string; captured_on: Generated<string>; created_at: Ts;
}
export interface PaymentAttemptsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; ticket_id: string;
  amount_cents: number; method: string; processor: string | null; status: string;
  idempotency_key: string; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  stranded_at: TsNull; resolution: string | null; resolved_at: TsNull;   // migration 549 (Phase 11): the stranded-attempt sweep
  provider: string | null; payment_surface: string | null; device_id: string | null; merchant_account_id: string | null; currency: string | null; checkout_version: string | null;   // migration 660 (PaymentIntent fields)
  processor_ref: string | null; card_brand: string | null; card_last4: string | null; payment_id: string | null; last_error_code: string | null; expires_at: TsNull;   // migration 660
}
export interface TicketNumberCountersTable {
  tenant_id: string; branch_id: string; business_date: ColumnType<string, string, string>; last_seq: number; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TicketsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; customer_id: string | null; queue_item_id: string | null;
  primary_technician_id: string | null; status: string; subtotal_cents: number; tax_cents: number;
  discount_cents: number; discount_snapshot: any; total_cents: number; accepted_at: TsNull; serving_started_at: TsNull;
  service_done_at: TsNull; ready_checkout_at: TsNull; paid_at: TsNull; created_at: Ts; updated_at: Ts;
  tip_cents: number; chosen_payment_method: string | null; locked_total_cents: number | null; ticket_number: string | null;
  tip_type: Generated<string>; tip_percent: number | null;
  satisfaction_rating: number | null;
  serving_paused_at: TsNull; accumulated_paused_ms: Generated<number>;
  version: Generated<number>;
  service_done_locked_at: TsNull; service_done_locked_by_user_id: string | null; service_done_locked_total_cents: number | null;
  removed_at: TsNull; removed_by_user_id: string | null; removal_reason: string | null;
  checkout_held_at: TsNull; checkout_held_by: string | null; checkout_register_id: string | null; // POS Hold Ticket / Move to Front Desk (Oct 6 2026)
  checkout_status: string | null; // the checkout-board status, on the row (migration 572; NULL = derived from status)
  serving_delay_status: Generated<string>; serving_delay_reason: string | null;   // migration 586 (durable Serving delay)
  station_label: string | null; surcharge_cents: Generated<number>; payment_status: Generated<string>; finished_at: TsNull; service_done_quality_status: Generated<string>; service_done_checkout_status: Generated<string>; service_done_notes: string | null; service_done_customer_visible_notes: string | null; service_done_customer_notified_at: TsNull; service_done_send_idempotency_key: string | null; helper_technician_id: string | null;
  service_done_checklist: unknown | null;   // migration 707 (Service Done quality checklist, Oct 28 2026)
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TicketServiceLinesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; ticket_id: string; service_id: string | null;
  product_id: string | null;
  technician_id: string | null; service_name_snapshot: string; price_cents_snapshot: number;
  duration_minutes_snapshot: number; commission_type_snapshot: string; commission_value_snapshot: number;
  supply_method_snapshot: Generated<string>; supply_value_snapshot: Generated<number>;
  line_total_cents: number; status: string; started_at: TsNull; completed_at: TsNull; progress_percent: number;
  category_snapshot: string | null; line_kind: string | null; is_add_on: Generated<boolean>; quantity: Generated<number>; notes: string | null;
  added_by_user_id: string | null; added_by_role: string | null; removed_at: TsNull;
  policy_id: string | null; rule_source: string | null;   // migration 587 (which rule priced the line)
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TicketChangeRequestsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; line_id: string | null;
  request_type: string; old_value_json: unknown; new_value_json: unknown; reason: string | null;
  requested_by_user_id: string | null; requested_by_technician_id: string | null;
  status: Generated<string>; approved_by_user_id: string | null; approved_at: TsNull;
  rejected_by_user_id: string | null; rejected_at: TsNull; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerDisplayDevicesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; pos_station_id: string | null; device_name: string | null;
  device_type: string | null; pairing_code_hash: string | null; pairing_status: string | null; last_seen_at: TsNull; revoked_at: TsNull; device_token_hash: string | null;
  created_at: Ts; updated_at: Ts;
  // 23-inch spec §85–§86 (migration 511): what the display reports with its heartbeat, and the owner's maintenance switch
  reported_mode: string | null; app_version: string | null; screen_width: number | null; screen_height: number | null;
  pixel_ratio: string | number | null; display_profile: string | null; maintenance_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
// 23-inch spec §9–§10 (migration 511): a POS register — a display dedicated to it has pos_station_id = its id.
export interface PosStationsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; name: string;
  created_at: Generated<Ts>; updated_at: Generated<Ts>; retired_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
// 23-inch spec §8/§12 (migration 511): display-initiated pairing — a code the display shows, claimed from the POS.
export interface CustomerDisplayPairingsTable {
  id: Generated<string>; code_hash: string; poll_secret_hash: string; created_at: Generated<Ts>; expires_at: Ts;
  tenant_id: string | null; device_id: string | null; claimed_at: TsNull; consumed_at: TsNull; platform: string | null;
}
// 23-inch dual-screen spec §47–§78 (migration 509): the salon's own advertising on its customer display.
export interface DisplayAdMediaTable {
  id: Generated<string>; tenant_id: string; media_kind: Generated<string>; mime_type: string; width: number; height: number;
  byte_size: number; total_bytes: string | number; sha256: string; storage_key: string; variants: unknown;
  suggested_focal_x: Generated<string | number>; suggested_focal_y: Generated<string | number>; original_filename: string | null;
  created_by: string | null; created_at: Generated<Ts>; deleted_at: TsNull;
  deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DisplayAdsTable {
  id: Generated<string>; tenant_id: string; name: string; media_id: string | null; fullscreen_media_id: string | null;
  headline: string | null; subheadline: string | null; description: string | null; cta_text: string | null;
  qr_kind: string | null; qr_url: string | null; fit_mode: Generated<string>; focal_x: Generated<string | number>; focal_y: Generated<string | number>;
  start_date: ColumnType<string | null, string | null | undefined, string | null>; end_date: ColumnType<string | null, string | null | undefined, string | null>;
  days_of_week: number[] | null; daily_start_time: string | null; daily_end_time: string | null;
  display_duration_seconds: number | null; priority: Generated<number>; all_branches: Generated<boolean>; status: Generated<string>;
  published_at: TsNull; paused_at: TsNull; archived_at: TsNull; version: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>;
}
export interface DisplayAdBranchesTable { tenant_id: string; ad_id: string; branch_id: string }
export interface DisplayAdDeviceSettingsTable { tenant_id: string; device_id: string; ads_enabled: Generated<boolean>; updated_by: string | null; updated_at: Generated<Ts> }
export interface DisplayAdDisplayStatsTable {
  tenant_id: string; branch_id: string; device_id: string; ad_id: string; hour_start: Ts;
  display_count: Generated<number>; display_ms: Generated<string | number>; first_shown_at: Ts; last_shown_at: Ts;
}
export interface DisplayAdReportBatchesTable { tenant_id: string; device_id: string; batch_id: string; received_at: Generated<Ts> }
export interface CustomerDisplaySessionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; display_device_id: string | null; pos_station_id: string | null;
  ticket_id: string | null; customer_id: string | null; state: string; public_token_hash: string | null; selected_tip_cents: number | null; selected_tip_type: Generated<string>; selected_tip_percent: number | null;
  subtotal_cents: number | null; surcharge_cents: number | null; tax_cents: number | null; total_due_cents: number | null;
  payment_method: string | null; expires_at: TsNull; closed_at: TsNull; created_at: Ts; updated_at: Ts;
  // 23-inch spec §97 (migration 511): the receipt the customer chose on the display before the 3-second screen
  receipt_choice: string | null; receipt_status: string | null; receipt_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface PosPaymentTerminalsTable {
  id: string; tenant_id: string; branch_id: string | null; label: string;
  station_id: string | null; status: string; paired_at: TsNull; hsn: string | null;
  // migration 638 (wave 3 PAYI §11/§50): the terminal registry
  provider: string | null; terminal_type: string | null; serial_number: string | null; connection_type: string | null;
  merchant_account_id: string | null; disabled_at: TsNull; disabled_by: string | null; disabled_reason: string | null;
  last_seen_at: TsNull; last_ping_at: TsNull; last_ping_ok: boolean | null; last_transaction_at: TsNull;
  updated_at: TsNull; updated_by: string | null;
}
export interface TenantSettingsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; category: string; settings_json: unknown;
  updated_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianSkillChangeRequestsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; service_id: string;
  request_type: string; note: string | null; status: string; decided_by_user_id: string | null; decided_at: TsNull; created_at: Ts;
  proficiency_level: string | null; experience_years: number | null; supporting_photos: unknown; certificate_evidence: string | null; review_notes: string | null; submitted_at: TsNull;
  review_started_at: TsNull; review_started_by_user_id: string | null; more_info_requested_at: TsNull; updated_at: Generated<Ts>;   // 583 — review bookkeeping
  updated_by: string | null;   // 599 — actor stamp (AUTH merge)
}
export interface TicketTipAllocationsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; technician_id: string;
  tip_cents: number; created_at: Ts;
}
export interface TechnicianAuditLogsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null; user_id: string | null;
  action: string; ticket_id: string | null; metadata: unknown; created_at: Ts;
}
export interface SettingsAuditLogsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; user_id: string | null; role: string | null;
  action_type: string; entity_type: string | null; entity_id: string | null; before_json: unknown; after_json: unknown;
  metadata: unknown; created_at: Ts;
}
export interface PosTechQueueTicketsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; queue_item_id: string | null; ticket_id: string | null; customer_id: string | null;
  customer_name: string | null; customer_phone: string | null; is_vip: boolean; source: string; appointment_id: string | null; requested_services: unknown;
  priority: string; status: string; assigned_technician_id: string | null; station: string | null; assigned_at: Ts; accepted_at: TsNull; started_at: TsNull;
  notes: string | null; delay_status: string; delay_reason: string | null; technician_notified_at: TsNull; customer_notified_at: TsNull; serving_idempotency_key: string | null;
  acceptance_deadline: TsNull; version: Generated<number>; start_source: string | null;   // migration 480
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  visit_part: number | null;   // migration 569 (a part of a split visit; null = the whole visit)
}
export interface PosTechAppointmentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string; customer_id: string | null;
  customer_name: string | null; customer_phone: string | null; is_vip: boolean; source: string; services: unknown;
  appt_date: string; start_time: string; end_time: string; duration_minutes: number; status: string; deposit_status: string;
  notes: string | null; queue_idempotency_key: string | null; tech_queue_idempotency_key: string | null; serving_idempotency_key: string | null;
  inspiration_photo_id: string | null; start_source: string | null;   // migration 480
  created_at: Ts; updated_at: Ts;
  version: Generated<number>; overbook_ok: Generated<boolean>; overbook_reason: string | null; overbook_by_user_id: string | null;
  arrived_at: TsNull;   // migration 488 (Decision 38)
  any_technician: boolean | null;   // migration 600 (Fair Turn §19): booked for "first available"
  phone_verification: string | null; phone_verification_session_id: string | null;   // migration 521
  created_by: string | null; updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReviewsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; customer_id: string | null; ticket_id: string | null;
  rating: number; comment: string | null;
  technician_id: string | null; global_tech_profile_id: string | null; ticket_service_line_id: string | null;
  review_tags: Generated<unknown>; is_public: Generated<boolean>; is_hidden_by_manager: Generated<boolean>; hidden_reason: string | null;
  source: Generated<string>; external_review_id: string | null; appointment_id: string | null; reviewer_name: string | null; reviewer_url: string | null; review_date: Ts | null;
  response_status: Generated<string>; sentiment: string | null; severity: string | null; ai_confidence: number | null;
  escalation_status: Generated<string>; assigned_user_id: string | null; resolution_status: Generated<string>; is_spam: Generated<boolean>; last_synced_at: Ts | null;
  created_at: Ts; updated_at: Ts;
  technician_response: string | null; technician_response_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  moderation_version: Generated<number>; last_moderated_at: TsNull;   // migration 752 (Reviews & Reputation)
}
// 377 — App Access, Permissions and Skills. Before this they had no tables and the repo returned literals.
export interface CommissionChangeAuditLogsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null; service_id: string | null;
  target_type: string; old_commission_percent: number; new_commission_percent: number;
  requested_by_user_id: string; requested_by_name: string; requested_by_role: string;
  authorized_by_user_id: string | null; authorized_by_name: string | null; auth_code_used: string | null;
  created_at: Ts;
}
export interface AdminCommissionAuthCodesTable {
  id: Generated<string>; tenant_id: string; code_enc: string;
  generated_by_user_id: string | null; generated_by_name: string | null;
  expires_at: TsNull; used_at: TsNull; created_at: Ts;
}
export interface TechnicianPermissionsTable {
  tenant_id: string; branch_id: string | null; technician_id: string; permission_key: string; allowed: boolean;
  updated_by_user_id: string | null; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianAppSettingsTable {
  tenant_id: string; branch_id: string | null; technician_id: string;
  app_enabled: Generated<boolean>; pin_enabled: Generated<boolean>;
  allowed_sections: Generated<unknown>; allowed_branches: Generated<unknown>;
  updated_by_user_id: string | null; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianSkillsTable {
  tenant_id: string; branch_id: string | null; technician_id: string; skill_group: string; created_at: Ts;
}
// 381 — a manager's customer tags. There was no table; every tag ever set was discarded.
export interface CustomerTagsTable {
  tenant_id: string; branch_id: string | null; customer_id: string; tag: string;
  created_by_user_id: string | null; created_at: Ts;
}
export interface GlobalTechProfilesTable {
  id: Generated<string>; user_id: string | null; public_slug: string; display_name: string; title: string | null;
  avatar_url: string | null; bio: string | null; years_experience: number | null;
  specialties: Generated<unknown>; languages: Generated<unknown>; profile_links: Generated<unknown>;
  profile_link_visibility: unknown | null;
  is_public: Generated<boolean>; is_bookable: Generated<boolean>; marketplace_discovery_enabled: Generated<boolean>;
  overall_rating: number | null; rating_count: Generated<number>; portfolio_photo_count: Generated<number>;
  verified_completed_services_count: Generated<number>; created_at: Ts; updated_at: Ts;
  // 376 — the permanent global identity
  tech_code: string; normalized_phone: string | null; phone_hash: string | null; email_normalized: string | null;
  status: Generated<string>; suspended_at: TsNull; suspend_reason: string | null;
  anonymized_at: TsNull; anonymize_reason: string | null;
  // 378 — the losing side of a merge becomes a signpost, keeping its tech_code forever
  merged_into_profile_id: string | null; merged_at: TsNull;
  cover_url: string | null; certifications: Generated<unknown>; style_tags: Generated<unknown>; verification_status: Generated<string>; accepts_messages: Generated<boolean>; paused_at: TsNull; pause_reason: string | null; pause_expires_at: TsNull; admin_profile_hidden: Generated<boolean>; admin_messaging_paused: Generated<boolean>; admin_deals_frozen: Generated<boolean>;
  career_history_public: Generated<boolean>;   // 646 (Technician Profile §62): the technician opts her salon history onto her public profile
}
export interface GlobalTechDeleteRequestsTable {
  id: Generated<string>; global_tech_profile_id: string; requester_kind: string; requested_by_user_id: string | null;
  reason: string; status: Generated<string>; legal_hold: Generated<boolean>;
  decided_by_user_id: string | null; decided_at: TsNull; decision_note: string | null; completed_at: TsNull;
  created_at: Ts; updated_at: Ts;
}
export interface TechSalonMembershipsTable {
  id: Generated<string>; global_tech_profile_id: string; tenant_id: string; branch_id: string | null; technician_id: string | null;
  status: Generated<string>; message: string | null; requested_by_user_id: string | null; approved_by_user_id: string | null;
  start_date: TsNull; end_date: TsNull; created_at: Ts; updated_at: Ts;
  is_featured: Generated<boolean>;
  // 376 — the per-salon login this membership grants, and the invite that created it
  user_id: string | null; invited_by_user_id: string | null; invitation_id: string | null;
  role_label: string | null; ended_reason: string | null;
  // 378 — the transfer intent. The departure fires on ARRIVAL, not on approval.
  transfer_from_tenant_id: string | null; transfer_request_id: string | null;
  paused_at: TsNull; pause_reason: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechPortfolioPhotosTable {
  id: Generated<string>; global_tech_profile_id: string; tenant_id: string | null; branch_id: string | null;
  uploaded_by_user_id: string | null; image_url: string; thumbnail_url: string | null; caption: string | null;
  tags: Generated<unknown>; service_category: string | null; is_public: Generated<boolean>; is_featured: Generated<boolean>;
  moderation_status: Generated<string>; sort_order: Generated<number>; created_at: Ts; updated_at: Ts;
  nail_shape: string | null; nail_length: string | null; design_style: string | null; complexity: string | null; brand: string | null; color_name: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface NailPhotoConsentTable {
  id: Generated<string>; photo_id: string; tenant_id: string | null; branch_id: string | null; global_tech_profile_id: string;
  customer_id: string | null; ticket_id: string | null; approved_uses: Generated<unknown>; consent_version: string | null;
  device: string | null; session_id: string | null; revoked: Generated<boolean>; revoked_at: TsNull;
  public_blocked: Generated<boolean>; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BeforeAfterSetsTable {
  id: Generated<string>; global_tech_profile_id: string; tenant_id: string | null; branch_id: string | null; uploaded_by_user_id: string | null;
  before_image_url: string; before_thumbnail_url: string | null; after_image_url: string; after_thumbnail_url: string | null;
  service_performed: string | null; design_notes: string | null; products_used: string | null; duration_minutes: number | null;
  customer_consent: Generated<boolean>; is_public: Generated<boolean>; moderation_status: Generated<string>; sort_order: Generated<number>; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TicketRevisionsTable {
  id: Generated<string>; ticket_id: string; tenant_id: string | null; branch_id: string | null; version: number;
  action: string; service_line_id: string | null; actor_user_id: string | null; actor_role: string | null;
  before: unknown | null; after: unknown | null; summary: string | null; created_at: Ts;
}
export interface TicketDeletionCodesTable {
  id: Generated<string>; ticket_id: string; tenant_id: string | null; code_enc: string;
  generated_by_user_id: string | null; generated_at: Ts; revealed_at: TsNull; revealed_by_user_id: string | null;
  reveal_count: Generated<number>; used_at: TsNull; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface PosQueueItemsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  is_vip: boolean;
  source: string;
  appointment_id: string | null;
  ticket_id: string | null;
  requested_services: unknown;
  priority: string;
  status: string;
  assigned_technician_id: string | null;
  station: string | null;
  checked_in_at: TsNull;
  called_at: TsNull;
  started_at: TsNull;
  notes: string | null;
  customer_notified_at: TsNull;
  serving_idempotency_key: string | null;
  /** migration 665 (mandate §31): the walk-in check-in's client key, durable across API replicas */
  check_in_idempotency_key: string | null;
  tech_queue_idempotency_key: string | null;
  created_at: Ts;
  updated_at: Ts;
  requested_technician_id: string | null;
  version: Generated<number>;
  position: number | null;
  group_id: string | null;
  late_minutes: number | null;
  previous_technician_id: string | null;
  created_by: string | null; updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianShiftsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string; shift_date: ColumnType<string, string, string>;
  start_time: TsNull; end_time: TsNull; status: string; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianTimecardAdjustmentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; shift_id: string; technician_id: string;
  field: string; original_value: TsNull; new_value: TsNull; reason: string; adjusted_by: string; created_at: Ts;
  break_id: string | null;   // migration 603 — a break correction rides the same append-only trail
}
export interface TechnicianHelpRequestsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; service_line_id: string;
  service_id: string | null; primary_technician_id: string; helper_technician_id: string; reason: string; note: string | null;
  status: Generated<string>; responded_at: TsNull; decline_reason: string | null;
  created_by_user_id: string | null; created_by_technician_id: string | null; created_at: Ts;
}
export interface TechnicianStatusesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string; status: string; changed_at: Ts;
}
export interface InventoryItemsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; name: string; quantity: number; low_threshold: number;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BundlesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; name: string; kind: string; label: string | null;
  price_cents: number; status: string; online_booking_enabled: boolean; starts_at: TsNull; ends_at: TsNull;
  usage_limit: number | null; metric_note: string | null; created_by_user_id: string | null;
  created_at: Ts; updated_at: Ts; archived_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BundleItemsTable {
  id: Generated<string>; tenant_id: string; bundle_id: string; item_type: string; ref_id: string | null; label: string;
  quantity: number; unit_price_cents: number; sort_order: number; created_at: Ts;
}
export interface MembershipPlansTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; name: string; plan_code: string | null;
  product_type: string; description: string | null; internal_notes: string | null; badge: string | null;
  is_featured: boolean; is_popular: boolean; member_visible: boolean; status: string; current_version_id: string | null;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MembershipPlanVersionsTable {
  id: Generated<string>; plan_id: string; tenant_id: string; version_number: number;
  billing_interval: string; interval_count: number; price_cents: number; is_custom_pricing: boolean;
  enrollment_fee_cents: number; setup_fee_cents: number; trial_days: number; auto_renew: boolean; billing_cycles: number | null;
  term_type: string; term_days: number | null; rollover_allowed: boolean; rollover_max_cycles: number; credit_expiry_days: number | null;
  tech_commission_basis: string; tech_split_pct: number; owner_split_pct: number; tech_fixed_cents: number | null; allocation_timing: string;
  tax_category: string | null; cancellation_policy: string; min_commitment_cycles: number; pause_max_per_year: number; pause_max_days: number;
  terms_version: string | null; auto_renew_disclosure: string | null; est_margin_cents: number | null;
  is_published: boolean; effective_at: TsNull; published_by_user_id: string | null; created_at: Ts;
}
export interface MembershipBenefitsTable {
  id: Generated<string>; plan_version_id: string; tenant_id: string; benefit_type: string; label: string;
  service_id: string | null; category_snapshot: string | null; credits_per_cycle: number; value_cents: number; percent: number;
  allocated_value_cents: number; min_days_between: number; max_per_cycle: number | null; rollover_allowed: boolean; sort_order: number;
}
export interface CustomerMembershipsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; customer_id: string; plan_id: string; plan_version_id: string;
  status: string; assigned_technician_id: string | null; member_number: string | null;
  started_at: TsNull; current_period_start: TsNull; current_period_end: TsNull; next_billing_at: TsNull; term_end_at: TsNull; cycles_billed: number;
  auto_renew: boolean; auto_renew_consent_at: TsNull; agreement_version: string | null; enrolled_channel: string | null; enrolled_by_user_id: string | null;
  cancel_at_period_end: boolean; canceled_at: TsNull; cancel_reason: string | null; paused_at: TsNull; pause_resumes_at: TsNull; pauses_used: number; comped: boolean;
  version: number; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MembershipCreditLedgerTable {
  id: Generated<string>; tenant_id: string; customer_membership_id: string; benefit_id: string | null; entry_type: string;
  service_id: string | null; quantity: number; amount_cents: number; ticket_id: string | null; reservation_ref: string | null;
  expires_at: TsNull; reason: string | null; created_by_user_id: string | null; created_at: Ts;
}
export interface MembershipPaymentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_membership_id: string; customer_id: string;
  kind: string; amount_cents: number; tax_cents: number; status: string; processor: string; processor_ref: string | null;
  idempotency_key: string; attempt_number: number; failure_reason: string | null; period_start: TsNull; period_end: TsNull;
  tech_alloc_cents: number; owner_alloc_cents: number; created_at: Ts; settled_at: TsNull;
}
export interface MembershipRedemptionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_membership_id: string; ticket_id: string;
  service_line_id: string | null; benefit_id: string | null; service_id: string | null; standard_value_cents: number;
  allocated_value_cents: number; upgrade_charge_cents: number; technician_id: string | null; commission_basis_snapshot: string | null; created_at: Ts;
}
export interface MembershipActivityTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_membership_id: string | null; customer_id: string | null;
  plan_id: string | null; activity_type: string; customer_name_snapshot: string | null; plan_name_snapshot: string | null;
  amount_cents: number | null; occurred_at: Ts; meta: unknown | null;
}
export interface MembershipAuditTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_membership_id: string | null; plan_id: string | null;
  plan_version_id: string | null; customer_id: string | null; actor_user_id: string | null; actor_role: string | null;
  action: string; prev_state: string | null; new_state: string | null; reason: string | null; result: string | null;
  device: string | null; session: string | null; created_at: Ts;
}
export interface TechniciansTable {
  id: Generated<string>; tenant_id: string; branch_id: string; user_id: string | null; first_name: string; last_name: string; full_name: string;
  normalized_phone: string | null; phone_display: string | null; email: string | null; avatar_url: string | null; role_label: string | null;
  status: string; commission_type: string; commission_value: number; default_commission_split_percent: number; pin_hash: string | null;
  is_active: boolean; created_by_user_id: string | null; global_tech_profile_id: string | null; created_at: Ts; updated_at: Ts; archived_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  ended_reason: string | null;   // 577 — why the roster row ended (transfer / archive / disconnect)
  service_eligibility_mode: Generated<string>;   // 631 — 'exact' | 'legacy_unconfigured' (pre-deploy technician with no mapping)
}
export interface TechnicianClockPinsTable {
  tenant_id: string; technician_id: string; pin_hash: string; failed_attempts: Generated<number>; locked_until: TsNull;
  updated_by: string | null; created_at: Ts; updated_at: Ts;
  disabled_at: TsNull; disabled_reason: string | null;   // 573 — disabled by the revocation chain (suspend/terminate); a manager reset clears it
  pin_lookup: string | null; pin_lookup_kid: string | null;   // 683 — keyed digest of (tenant, PIN) + the key's id (identify at 200 technicians)
}
export interface TechnicianSchedulesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string; day_of_week: number;
  start_time: string | null; end_time: string | null; lunch_start_time: string | null; lunch_end_time: string | null;
  is_working: boolean; shifts: unknown; breaks: unknown; created_at: Ts; updated_at: Ts;
  version: Generated<number>;   // Phase 10 (539): optimistic concurrency
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ServiceCategoriesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; name: string; description: string | null;
  color_key: string | null; icon_key: string | null; sort_order: number; status: string; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ServicesCatalogTable {
  id: Generated<string>; tenant_id: string; branch_id: string; category_id: string; name: string; description: string | null;
  duration_minutes: number; price_cents: number; commission_type: string; commission_value: number;
  online_booking_enabled: boolean; customer_app_booking_enabled: boolean; ai_booking_enabled: boolean;
  color_key: string | null; icon_key: string | null; status: string; sort_order: number; created_by_user_id: string | null;
  created_at: Ts; updated_at: Ts; archived_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  required_certification: string | null;   // 583 — a named certification the technician must hold (expired/revoked → not eligible)
}
export interface TechnicianServicesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string; service_id: string;
  is_primary: boolean; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  proficiency: string | null; certificate_document_key: string | null; granted_by_user_id: string | null; granted_via: string | null;   // 583 — what was approved, on what evidence
}
export interface CustomerPhoneVerificationsTable { id: Generated<string>; tenant_id: string; customer_id: string; destination: string; code_hash: string; expires_at: Ts; consumed_at: TsNull; attempts: number; created_at: Ts; purpose: Generated<string>; normalized_phone: string | null; ip_address: string | null; device_id: string | null; }
export interface CustomersTable {
  birthday_year_known: Generated<boolean>;   // 750 (Birthday Campaigns)
  birthday_source: string | null;
  birthday_updated_at: Ts | null;
  birthday_updated_by: string | null;
  id: Generated<string>; tenant_id: string; branch_id: string; first_name: string; last_name: string; full_name: string;
  normalized_phone: string | null; phone_display: string | null; email: string | null; birthday: ColumnType<string | null, string | null, string | null>;
  avatar_url: string | null; status: string; marketing_sms_opt_in: boolean; marketing_email_opt_in: boolean;
  preferred_technician_id: string | null; notes: string | null; notes_json: unknown | null; allergies: unknown | null; safety_notes: string | null; user_id: string | null; created_by_user_id: string | null; phone_verified_at: TsNull; marketing_opt_in: boolean; created_at: Ts; updated_at: Ts; archived_at: TsNull;
  record_version: Generated<number>;
  preferred_name: string | null; preferred_language: string | null; preferred_branch_id: string | null;   // migration 490 (Decision 1)
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface OauthClientsTable { id: Generated<string>; client_id: string; name: string; redirect_uris: string[]; client_secret_hash: string | null; allowed_scopes: Generated<string[]>; disabled_at: TsNull; created_at: Generated<Ts>; }   // 501
export interface OauthGrantsTable { id: Generated<string>; client_id: string; tenant_id: string; approved_by: string | null; scopes: string[]; created_at: Generated<Ts>; revoked_at: TsNull; }   // 501
export interface ApiIdempotencyTable { scope: string; idem_key: string; tenant_id: string | null; method: string; route: string; request_hash: string; state: Generated<string>; response_status: number | null; response_body: unknown | null; created_at: Generated<Ts>; completed_at: TsNull; expires_at: Generated<Ts>; }   // 502
export interface OauthCodesTable { code_hash: string; grant_id: string; redirect_uri: string; code_challenge: string; expires_at: Ts; used_at: TsNull; }   // 501
export interface OauthTokensTable { token_hash: string; grant_id: string; kind: string; expires_at: Ts; rotated_at: TsNull; revoked_at: TsNull; created_at: Generated<Ts>; }   // 501
export interface SecurityNotMeTokensTable { id: Generated<string>; user_id: string; device_id: string | null; token_hash: string; created_at: Generated<Ts>; expires_at: Ts; used_at: TsNull; }   // 500
export interface TenantApiKeyUsesTable { id: Generated<string>; key_id: string; tenant_id: string; used_at: Generated<Ts>; method: string; route: string; ip: string | null; via_previous_secret: Generated<boolean>; }   // 498
export interface AuthEventsTable { id: Generated<string>; occurred_at: Generated<Ts>; event_type: string; outcome: string; user_id: string | null; tenant_id: string | null; session_id: string | null; ip: string | null; user_agent: string | null; reason: string | null; metadata: Generated<unknown>; }   // 497
export interface AuthDevicesTable { id: Generated<string>; user_id: string; device_key_hash: string; name: string | null; platform: string | null; trust_state: Generated<string>; trusted_until: TsNull; first_seen_at: Generated<Ts>; last_seen_at: Generated<Ts>; last_ip: string | null; sign_in_count: Generated<number>; platform_approved_at: TsNull; platform_approved_via: string | null; }   // 496, 698
export interface PlatformDeviceApprovalsTable { id: Generated<string>; user_id: string; device_id: string; token_hash: string; ip: string | null; created_at: Generated<Ts>; expires_at: Ts; used_at: TsNull; }   // 698 S-A13
export interface MfaRecoveryCodesTable { id: Generated<string>; user_id: string; code_hash: string; created_at: Generated<Ts>; used_at: TsNull; retired_at: TsNull; }   // 495
export interface LoyaltyRewardsTable { id: Generated<string>; tenant_id: string; title: string; description: string; points_cost: number; active: boolean; sort_order: number; created_at: Ts;
  reward_type: Generated<string>; value_cents: Generated<number>; percent: Generated<number>; valid_days: number | null; updated_at: TsNull; 
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}   // 492
export interface LoyaltyRedemptionsTable { id: Generated<string>; tenant_id: string; customer_id: string; reward_id: string; reward_title: string; points_spent: number; code: string; created_at: Ts;
  status: Generated<string>; reward_type: string | null; value_cents: Generated<number>; percent: Generated<number>; expires_at: TsNull; ticket_id: string | null; applied_at: TsNull; used_at: TsNull; voided_at: TsNull; }   // 492
export interface LoyaltyLedgerTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_id: string;
  // legacy columns (474) — filled from the canonical ones by 540's insert trigger when a writer leaves them out
  type: Generated<string>; amount: Generated<number>; source: Generated<string>; reference_id: string | null; description: string | null; actor_id: string | null; running_balance: Generated<number>; created_at: Generated<Ts>;
  // Phase 10 (540): the canonical ledger columns — written by LoyaltyLedgerService (modules/customers/src/loyalty)
  entry_type: 'earn' | 'redeem' | 'adjust' | 'reverse' | 'merge'; delta: number; balance_after: number; reason: string | null;
  source_table: string | null; source_id: string | null; actor_user_id: string | null; request_id: string | null;
}
export interface CustomerLoyaltyProfilesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; customer_id: string; loyalty_tier: string;
  points_balance: number; total_earned_points: number; total_redeemed_points: number; vip_since: TsNull; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerPreferencesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; customer_id: string; preferred_style_notes: string | null;
  product_preferences_json: unknown; favorite_colors_json: unknown; avoid_products_json: unknown; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReceiptsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; ticket_id: string | null; payment_id: string | null;
  receipt_number: string | null; emailed_to: string | null; total_cents: number; created_at: Ts;
}
export interface TechnicianBlockedTimesTable {
  id: Generated<string>; tenant_id: string; branch_id: string; technician_id: string;
  block_date: string; start_time: string; end_time: string; reason: string; note: string | null;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface OwnerAlertsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; category: string; severity: string; status: string;
  title: string; body: string | null; metadata: unknown; resolved_by_user_id: string | null;
  resolved_at: ColumnType<Date | null, string | null, string | null>; created_at: Ts; updated_at: Ts;
  audience: Generated<string>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface OwnerAuditLogTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; user_id: string | null; role: string | null;
  action: string; entity_type: string | null; entity_id: string | null; metadata: unknown; created_at: Ts;
}
export interface AuditEventsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; occurred_at: Ts;
  actor_user_id: string | null; actor_role: string | null; actor_name: string | null;
  module: string; action: string; resource_type: string | null; resource_id: string | null; summary: string | null;
  status: string; severity: string; ip: string | null; device: string | null; metadata: unknown; created_at: Ts;
  // Phase 10 (541): the change itself and where it came from
  before_state: unknown | null; after_state: unknown | null; reason: string | null; request_id: string | null; correlation_id: string | null; session_id: string | null;
}
export interface CampaignsTable {
  occasion: string | null;   // 'birthday' = one birthday message per customer per occasion year (migration 750)
  id: Generated<string>; tenant_id: string; branch_id: string | null; name: string; offer: string | null;
  channel: string; audience_label: string | null; audience_size: number; status: string; scheduled_at: TsNull;
  sent_count: number; open_count: number; click_count: number; reply_count: number; booking_count: number;
  revenue_cents: number; cost_cents: number; created_by: string | null; created_at: Ts; updated_at: Ts; started_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 739 (Campaign Center guide): goal / message / audience snapshot / approval / completion facts
  goal: string | null; description: string | null; deal_id: string | null; message_body: string | null; email_subject: string | null;
  message_version: Generated<number>; audience_source: string | null; audience_draft_id: string | null; snapshot_version: Generated<number>;
  content_hash: string | null; origin: Generated<string>; submitted_by_user_id: string | null; submitted_at: TsNull;
  approved_by_user_id: string | null; approved_at: TsNull; approved_content_hash: string | null; completed_at: TsNull;
}
// migration 739: the approved audience snapshot (never a send record)
export interface CampaignRecipientsTable {
  tenant_id: string; campaign_id: string; snapshot_version: number; customer_id: string; channel: string; eligibility: string;
  destination_masked: string | null; source_draft_id: string | null; created_by: string | null; created_at: Generated<Ts>;
}
// migration 739: Check Campaign System runs (read-only findings)
export interface CampaignHealthRunsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; campaign_id: string | null; overall: string;
  findings_json: Generated<unknown>; correlation_id: string; created_by: string | null; created_at: Generated<Ts>;
}
export interface CommunicationThreadsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_id: string | null; customer_name: string | null;
  customer_contact: string | null; channel: string; subject: string | null; status: string; assigned_to: string | null;
  assigned_to_name: string | null; unread_count: number; last_message_at: TsNull; last_message_preview: string | null;
  last_direction: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  contact_normalized: string | null;
  customer_match: string | null;
  last_inbound_at: TsNull;
  last_outbound_at: TsNull;
  awaiting_reply_since: TsNull;
  follow_up_due_at: TsNull;
  record_version: Generated<number>;
  closed_at: TsNull;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface CommunicationMessagesTable {
  id: Generated<string>; tenant_id: string; thread_id: string; direction: string; channel: string; body: string;
  author_user_id: string | null; author_name: string | null; status: string; created_at: Ts;
  notification_id: string | null;
  provider_message_sid: string | null;
  idempotency_key: string | null;
  author_kind: string | null;
  media_count: number | null;
  error_code: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface PayrollPeriodsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; label: string | null; period_start: string; period_end: string; status: Generated<string>; finalized_at: Ts | null; paid_at: Ts | null; total_gross_cents: Generated<number>; total_commission_cents: Generated<number>; total_tips_cents: Generated<number>; total_payable_cents: Generated<number>; created_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; reopen_reason: string | null; reopened_by: string | null; reopened_at: Ts | null; version: Generated<number>; calculation_version: string | null; preview_hash: string | null; prepared_at: Ts | null; prepared_by: string | null; approval_hash: string | null; approved_by: string | null; paid_by: string | null; validation_json: unknown | null; blocking_count: Generated<number>; warning_count: Generated<number>; pay_date: string | null;   submitted_by: string | null; submitted_at: Ts | null; owner_decision: string | null; owner_note: string | null; owner_decided_by: string | null; owner_decided_at: Ts | null; payout_status: Generated<string>; schedule_generated: Generated<boolean>;   // migration 673
  canceled_at: Ts | null; canceled_by: string | null; cancel_reason: string | null;   // migration 701 — the CANCELED period
 }
export interface PayrollLinesTable { id: Generated<string>; tenant_id: string; period_id: string; technician_id: string; technician_name: string | null; services_count: Generated<number>; gross_sales_cents: Generated<number>; commission_type: Generated<string>; commission_value: Generated<number>; commission_cents: Generated<number>; tips_cents: Generated<number>; adjustment_cents: Generated<number>; payable_cents: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; retail_commission_cents: Generated<number>; card_tip_cents: Generated<number>; cash_tip_cents: Generated<number>; guarantee_topup_cents: Generated<number>; updated_by: string | null; hourly_pay_cents: Generated<number>; worked_minutes: Generated<number>; potential_overtime_minutes: Generated<number>; salary_pay_cents: Generated<number>; bonus_cents: Generated<number>; deduction_cents: Generated<number>; net_cents: Generated<number>; review_required: Generated<boolean>; }
export interface ExpensesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; category: string; amount_cents: number | string;
  description: string | null; vendor: string | null; incurred_on: string; created_by: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 672 — the business record's lifecycle, money breakdown, vendor / receipt links, bill + reimbursement state
  status: Generated<string>; kind: Generated<string>; category_raw: string | null; category_source: Generated<string>; vendor_id: string | null; receipt_document_id: string | null; subtotal_cents: number | string | null; tax_cents: number | string | null; tip_cents: number | string | null; fee_cents: number | string | null; discount_cents: number | string | null; currency: Generated<string>; payment_method: string | null; card_brand: string | null; card_last4: string | null; receipt_number: string | null; invoice_number: string | null; reference_number: string | null; due_date: ColumnType<string | null, string | null, string | null>; bill_status: string | null; paid_cents: Generated<number | string>; paid_at: TsNull; reimbursement_status: Generated<string>; reimburse_user_id: string | null; reimbursed_at: TsNull; recurring: Generated<boolean>; duplicate_status: Generated<string>; duplicate_of_id: string | null; duplicate_reason: string | null; source: Generated<string>; tax_review_status: Generated<string>; accountant_note: string | null; approved_by: string | null; approved_at: TsNull; rejected_reason: string | null; voided_by: string | null; voided_at: TsNull; void_reason: string | null; archived_at: TsNull; archived_by: string | null; idempotency_key: string | null; extraction_confidence: number | string | null; review_flags: Generated<unknown>; bill_reminder_kind: string | null; bill_reminded_on: ColumnType<string | null, string | null, string | null>; version: Generated<number>;
  payment_match_status: string | null; matched_payment_id: string | null; matched_payment_ref: string | null; payment_match_reason: string | null; payment_matched_at: TsNull; payment_matched_by: string | null;   // migration 700 (§62/§63)
}
// migration 672 — Receipt / Expense / OCR / Accounting (Kevin's master mandate, Oct 21 2026)
export interface ExpenseCategoriesTable {
  id: Generated<string>; tenant_id: string; key: string; label: string; is_system: Generated<boolean>; accounting_code: string | null; active: Generated<boolean>; sort_order: Generated<number>; created_by: string | null; created_at: Ts; updated_at: Ts; updated_by: string | null;
}
export interface ExpenseCategoryRulesTable {
  id: Generated<string>; tenant_id: string; vendor_norm: string; vendor_id: string | null; keyword: string | null; category_key: string; kind: Generated<string>; hit_count: Generated<number>; active: Generated<boolean>; created_by: string | null; created_at: Ts; updated_at: Ts; updated_by: string | null;
}
export interface ExpenseLineItemsTable {
  id: Generated<string>; tenant_id: string; expense_id: string; line_number: number; description: string; quantity: number | string | null; unit_price_cents: number | string | null; total_cents: number | string; suggested_category_key: string | null; final_category_key: string | null; confidence: number | string | null; created_at: Ts;
}
export interface ExpenseAllocationsTable {
  id: Generated<string>; tenant_id: string; expense_id: string; branch_id: string; amount_cents: number | string; basis_points: number | null; created_at: Ts;
}
export interface ExpenseDocumentsTable {
  id: Generated<string>; tenant_id: string; expense_id: string; document_id: string; role: Generated<string>; attached_by: string | null; created_at: Ts;
}
export interface ExpenseBillPaymentsTable {
  id: Generated<string>; tenant_id: string; expense_id: string; amount_cents: number | string; paid_on: ColumnType<string, string, string>; payment_method: string | null; reference: string | null; recorded_by: string | null; idempotency_key: string | null; created_at: Ts;
}
export interface ExpenseHistoryTable {
  id: Generated<string>; tenant_id: string; expense_id: string; action: string; actor_user_id: string | null; reason: string | null; before_state: unknown | null; after_state: unknown | null; version: number | null; created_at: Ts;
}
export interface ExpenseSettingsTable {
  tenant_id: string; require_approval: Generated<boolean>; auto_ready: Generated<boolean>; auto_category: Generated<boolean>; learn_from_corrections: Generated<boolean>; duplicate_detection: Generated<boolean>; bill_reminder_days: Generated<number>; default_branch_id: string | null; receptionist_upload: Generated<boolean>; technician_upload: Generated<boolean>; version: Generated<number>; updated_at: Ts; updated_by: string | null;
  shared_cost_policy: Generated<string>; shared_cost_shares: Generated<unknown>;   // migration 681 (P2-3: salon-wide cost allocation)
  // migration 700 (§177–§179 notification preferences + digest markers, §83 auto-approval rules)
  notify_needs_review: Generated<boolean>; notify_bill_due: Generated<boolean>; notify_duplicate: Generated<boolean>; notify_weekly_summary: Generated<boolean>; notify_monthly_summary: Generated<boolean>;
  weekly_summary_sent_for: string | null; monthly_summary_sent_for: string | null; auto_approval_rules: Generated<unknown>;
}
export interface TenantApplicationsTable {
  id: string; salon_name: string; owner_name: string; phone: string | null; email: string | null; city: string | null;
  state: string | null; technicians_count: number | null; current_pos: string | null; current_processor: string | null;
  monthly_card_volume_cents: string | number | null; preferred_imac_color: string | null; status: string;
  notes: unknown; converted_tenant_id: string | null; source: string | null; created_at: TsNull; updated_at: TsNull;
  reference_number: string | null; owner_first_name: string | null; owner_last_name: string | null; address: string | null; zip: string | null; locations_count: number | null; ein_encrypted: string | null; ein_last4: string | null; referral_source: string | null; card_volume_band: string | null; best_contact_time: string | null; preferred_contact_method: string | null; applicant_message: string | null; consent_given: Generated<boolean>; consent_text: string | null; consent_at: TsNull; ip_address: string | null; user_agent: string | null; form_version: string | null; utm: unknown; idempotency_key: string | null; duplicate_risk_score: Generated<number>; duplicate_reasons: unknown; spam_score: Generated<number>; priority: string | null; assigned_to_user_id: string | null; follow_up_at: TsNull; last_contacted_at: TsNull; approved_at: TsNull; rejected_at: TsNull; archived_at: TsNull; onboarding_id: string | null; record_version: Generated<number>;
}
export interface WebsiteLeadsTable {
  id: string; kind: string; name: string | null; salon_name: string | null; phone: string | null; email: string | null;
  city: string | null; state: string | null; source_page: string | null; message: string | null; status: string;
  notes: unknown; application_id: string | null; created_at: TsNull; updated_at: TsNull;
  contact_name: string | null; source: string | null; lead_score: number | null; assigned_to_user_id: string | null; next_follow_up_at: TsNull; current_pos: string | null; technician_count: number | null; monthly_card_volume_cents: number | null; archived_at: TsNull;
}
export interface HardwarePackagesTable {
  id: string; tenant_id: string | null; application_id: string | null; imac_color: string | null; imac_serial: string | null;
  clover_flex_serial: string | null; checkin_display_serial: string | null; agreement_status: string;
  payment_setup_status: string; status: string; delivered_at: TsNull; activated_at: TsNull; notes: unknown;
  created_at: TsNull; updated_at: TsNull;
  package_name: string | null; package_type: string | null; payment_status: Generated<string>; hardware_cost_cents: number | null; deposit_cents: number | null; amount_paid_cents: number | null; financing_terms: string | null; shipping_address: string | null; shipping_city: string | null; shipping_state: string | null; shipping_zip: string | null; shipping_carrier: string | null; tracking_number: string | null; tracking_url: string | null; ordered_at: TsNull; shipped_at: TsNull; installed_at: TsNull; completed_at: TsNull; cancelled_at: TsNull; returned_at: TsNull; created_by_user_id: string | null; updated_by_user_id: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SupportAccessSessionsTable {
  extension_count: Generated<number>;   // Constitution 7 §78 (migration 465)
  scope: Generated<string>;   // Constitution 7 §81 (migration 464)
  id: string; tenant_id: string; admin_user_id: string; admin_email: string | null; reason: string;
  started_at: TsNull; expires_at: TsNull; ended_at: TsNull; created_at: TsNull;
}
export interface NailShowcasePostsTable {
  id: Generated<string>; tenant_id: string | null; branch_id: string | null; customer_id: string;
  technician_id: string | null; service_id: string | null; appointment_id: string | null; ticket_id: string | null;
  ticket_service_line_id: string | null; caption: Generated<string>; tags: Generated<unknown>;
  visibility: Generated<string>; post_type: Generated<string>; status: Generated<string>;
  is_verified_service: Generated<boolean>; allow_comments: Generated<boolean>;
  display_name: string | null; is_anonymous: Generated<boolean>;
  like_count: Generated<number>; dislike_count: Generated<number>; comment_count: Generated<number>; report_count: Generated<number>;
  created_at: Ts; updated_at: Ts; deleted_at: TsNull;
  portfolio_photo_id: string | null;   // 647 (Technician Profile §46): the portfolio photo a technician shared into the showcase
  updated_by: string | null; deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface NailShowcasePhotosTable {
  id: Generated<string>; post_id: string; tenant_id: string | null; branch_id: string | null; customer_id: string;
  image_url: string; thumbnail_url: string | null; sort_order: Generated<number>; caption: string | null;
  metadata: unknown | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface NailShowcaseReactionsTable {
  id: Generated<string>; post_id: string; customer_id: string; reaction_type: string; created_at: Ts; updated_at: Ts;
}
export interface NailShowcaseCommentsTable {
  id: Generated<string>; post_id: string; customer_id: string; parent_comment_id: string | null; comment_text: string;
  status: Generated<string>; like_count: Generated<number>; report_count: Generated<number>;
  created_at: Ts; updated_at: Ts; deleted_at: TsNull;
  deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface NailShowcaseReportsTable {
  id: Generated<string>; post_id: string | null; comment_id: string | null; tenant_id: string | null;
  reported_by_customer_id: string | null; reported_by_user_id: string | null; reason: string; details: string | null;
  reported_customer_id: string | null;
  status: Generated<string>; created_at: Ts; updated_at: Ts; resolved_by_user_id: string | null; resolved_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerSocialProfilesTable {
  id: Generated<string>; customer_id: string; tenant_id: string | null;
  public_display_name: string | null; avatar_url: string | null; bio: string | null;
  profile_visibility: Generated<string>; is_public_profile: Generated<boolean>;
  show_rank_on_profile: Generated<boolean>; show_posts_on_profile: Generated<boolean>; allow_followers: Generated<boolean>;
  is_suspended: Generated<boolean>;
  follower_count: Generated<number>; following_count: Generated<number>;
  nail_showcase_score: Generated<number>; nail_showcase_rank_all_time: number | null;
  likes_count: Generated<number>; dislikes_count: Generated<number>; comments_count: Generated<number>; posts_count: Generated<number>;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerFollowsTable {
  id: Generated<string>; follower_customer_id: string; following_customer_id: string;
  tenant_id: string | null; branch_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerBlocksTable {
  id: Generated<string>; blocker_user_id: string; blocked_user_id: string;
  tenant_id: string | null; created_at: Ts;
}
export interface NailShowcaseCustomerScoreSnapshotsTable {
  id: Generated<string>; customer_id: string; tenant_id: string | null;
  scope: Generated<string>; period: Generated<string>; score: Generated<number>;
  likes_count: Generated<number>; dislikes_count: Generated<number>; comments_count: Generated<number>; posts_count: Generated<number>;
  rank: number | null; calculated_at: Ts; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwarePaymentPlansTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; hardware_package_id: string | null; status: Generated<string>;
  total_hardware_cost_cents: Generated<number>; down_payment_cents: Generated<number>; financed_amount_cents: Generated<number>;
  monthly_payment_cents: Generated<number>; remaining_balance_cents: Generated<number>;
  start_date: string | null; end_date: string | null; due_day_of_month: Generated<number>;
  revenue_split_recovery_enabled: Generated<boolean>; auto_charge_shortfall_enabled: Generated<boolean>;
  extra_credit_handling: Generated<string>; carry_forward_credit_cents: Generated<number>;
  saved_payment_method_id: string | null; created_by_user_id: string | null;
  created_at: Generated<Date>; updated_at: Generated<Date>; closed_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwareRevenueSplitSettingsTable {
  id: Generated<string>; tenant_id: string | null; hardware_payment_plan_id: string | null;
  pricing_rate_bps: Generated<number>; expense_rate_bps: Generated<number>; net_margin_bps: Generated<number>;
  platform_share_percent: Generated<number>; fiserv_share_percent: Generated<number>; salon_hardware_credit_percent_of_platform_share: Generated<number>;
  effective_start_date: string | null; effective_end_date: string | null; is_default: Generated<boolean>;
  created_by_user_id: string | null; created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwarePaymentInvoicesTable {
  id: Generated<string>; tenant_id: string; hardware_payment_plan_id: string; billing_month: string;
  card_volume_cents: Generated<number>; pricing_rate_bps: number; expense_rate_bps: number;
  net_margin_cents: Generated<number>; platform_share_cents: Generated<number>; fiserv_share_cents: Generated<number>;
  salon_hardware_credit_cents: Generated<number>; hardware_monthly_due_cents: Generated<number>;
  carry_forward_credit_cents: Generated<number>; shortfall_cents: Generated<number>; auto_charge_amount_cents: Generated<number>;
  status: Generated<string>; due_date: string | null; paid_at: TsNull; created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwarePaymentLedgerTable {
  id: Generated<string>; tenant_id: string; hardware_payment_plan_id: string; invoice_id: string | null;
  entry_type: string; amount_cents: number; description: string | null; source: string | null;
  created_at: Generated<Date>; created_by_user_id: string | null;
}
export interface HardwarePaymentMethodsTable {
  id: Generated<string>; tenant_id: string; gateway_customer_id: string | null; gateway_payment_method_token: string;
  brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null; billing_zip: string | null;
  status: Generated<string>; created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwareAutopayConsentsTable {
  id: Generated<string>; tenant_id: string; hardware_payment_plan_id: string | null; authorized_by_user_id: string;
  authorized_at: Generated<Date>; ip_address: string | null; device_info: string | null; consent_text_version: Generated<string>; revoked_at: TsNull;
}
export interface HardwarePaymentTransactionsTable {
  id: Generated<string>; tenant_id: string; hardware_payment_plan_id: string; invoice_id: string | null;
  amount_cents: number; status: string; gateway_retref: string | null; gateway_resp_status: string | null; gateway_resp_text: string | null;
  attempt: Generated<number>; created_at: Generated<Date>;
}
export interface HardwareReconciliationRunsTable {
  id: Generated<string>; tenant_id: string | null; billing_month: string; status: Generated<string>;
  plans_processed: Generated<number>; invoices_created: Generated<number>; shortfalls_charged_cents: Generated<number>;
  failures: Generated<number>; notes: string | null; created_at: Generated<Date>;
}
export interface HardwareCardVolumeTable {
  id: Generated<string>; tenant_id: string; billing_month: string; card_volume_cents: Generated<number>;
  source: Generated<string>; imported_at: Generated<Date>;
}
export interface PaymentIntentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; invoice_id: string | null;
  customer_id: string | null; amount_cents: Generated<number>; currency: Generated<string>; method: string;
  status: Generated<string>; gateway: string | null; gateway_payment_intent_id: string | null;
  created_by_user_id: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; expires_at: Date | null;
  customer_tip_cents: Generated<number | string>; // migration 425 — customer tip chosen at start; confirm charges the stored choice
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  charge_started_at: TsNull; processor_ref: string | null; failure_reason: string | null; settled_by: string | null; last_inquired_at: TsNull;   // migration 680 (B-80 recovery)
}
export interface CashPaymentConfirmationsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; invoice_id: string | null;
  payment_intent_id: string | null; customer_id: string | null; technician_id: string | null;
  amount_cents: Generated<number>; confirmed_by_user_id: string | null; confirmed_at: Date | null;
  status: Generated<string>; notes: string | null; created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SkipLineCheckoutSettingsTable {
  tenant_id: string; feature_enabled: Generated<boolean>; auto_send_prompt_on_service_done: Generated<boolean>;
  require_front_desk_approval: Generated<boolean>; allow_cash_to_technician: Generated<boolean>;
  require_tech_confirmation_for_cash: Generated<boolean>; manager_approval_over_cents: Generated<number>;
  created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechCashHandoffsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; business_date: string;
  expected_cents: Generated<number>; counted_cents: number | null; variance_cents: number | null; payment_count: Generated<number>;
  status: Generated<string>; submitted_by_user_id: string | null; submitted_at: Date | null;
  reconciled_by_user_id: string | null; reconciled_at: Date | null; notes: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  version: Generated<number>;
  denominations_json: unknown | null;
  resolution_reason: string | null;
  resolved_by_user_id: string | null;
  resolved_at: TsNull;
  drawer_transfer_cents: Generated<string | number>;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface CashDrawerSessionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; register_id: Generated<string>; business_date: string;
  opening_float_cents: Generated<number>; expected_sales_cents: number | null; refunds_cents: number | null; expected_cash_cents: number | null;
  counted_cents: number | null; variance_cents: number | null; cash_payment_count: Generated<number>;
  status: Generated<string>; opened_by_user_id: string | null; opened_at: Date | null;
  reconciled_by_user_id: string | null; reconciled_at: Date | null; notes: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AccountDeletionRequestsTable {
  id: Generated<string>; tenant_id: string | null; user_id: string; role: string;
  request_type: Generated<string>; status: Generated<string>; reason: string | null; contact_email: string | null;
  requested_at: Ts; resolved_at: Date | null; notes: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CashDrawerMovementsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; register_id: Generated<string>; business_date: string;
  direction: string; amount_cents: number; reason: string | null; note: string | null;
  created_by_user_id: string | null; created_at: Ts; voided_at: Ts | null; voided_by_user_id: string | null;
  source_type: string | null; source_id: string | null; idempotency_key: string | null;   // migration 673
 }
export interface PosKpiDailySnapshotsTable {
  id: Generated<string>; tenant_id: string; branch_id: string;
  business_day: ColumnType<string, string, string>; module: string;
  metrics: ColumnType<Record<string, number>, string, string>;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantApiKeysTable {
  id: Generated<string>; tenant_id: string; name: string; prefix: string; secret_hash: string;
  previous_secret_hash: string | null; previous_valid_until: TsNull;   // 498 rotation overlap
  environment: string; scopes: string[]; created_by_user_id: string | null;
  last_used_at: TsNull; expires_at: TsNull; revoked_at: TsNull; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantWebhooksTable {
  id: Generated<string>; tenant_id: string; name: string; url: string; events: string[];
  signing_secret_enc: string; status: string; created_by_user_id: string | null;
  last_delivery_at: TsNull; last_success_at: TsNull; last_failure_at: TsNull; failure_count: number;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDeploymentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; component: string; component_kind: string;
  installed_version: string | null; latest_version: string | null; target_count: number; status: string;
  scheduled_at: TsNull; created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantEventLogsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; category: string; severity: string;
  source: string; message: string; correlation_id: string | null; related_id: string | null; status: string | null;
  metadata: unknown; created_at: Ts;
}
export interface TenantWebhookDeliveriesTable {
  id: Generated<string>; tenant_id: string; webhook_id: string; event_type: string; payload: unknown;
  status: Generated<string>; attempt_count: Generated<number>; max_attempts: Generated<number>;
  next_attempt_at: TsNull; last_status_code: number | null; last_error: string | null;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CallIntelligenceEventsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; provider_call_id: string;
  customer_id: string | null; caller_phone: string | null; direction: Generated<string>; status: string;
  ai_handled: Generated<boolean>; intent: string | null; duration_seconds: Generated<number>;
  outcome: Generated<string>; recovered_appointment_id: string | null;
  started_at: Ts; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiRevenueAttributionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; dedupe_key: string; source: string;
  kind: Generated<string>; ticket_id: string | null; ticket_service_line_id: string | null; customer_id: string | null;
  amount_cents: Generated<number>; accepted_at: Ts; created_at: Ts;
}
export interface WorkflowRunsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; workflow_key: string; dedupe_key: string;
  status: Generated<string>; customer_id: string | null; appointment_id: string | null; detail: string | null;
  ran_at: Ts; created_at: Ts;
}
export interface AiControlModesTable {
  id: Generated<string>; tenant_id: string; assistant_key: string; mode: Generated<string>;
  updated_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TicketCompensationSnapshotsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; service_line_id: string;
  technician_id: string | null; service_id: string | null;
  engine_version: string; policy_id: string | null; policy_version: number | null; commission_source: string | null; rule_source: string | null;   // rule_source: migration 587
  gross_price_cents: number; discount_cents: number; discount_funding: string | null; tax_cents: number; supply_cents: number;
  commissionable_cents: number; commission_type: string | null; commission_value: number | null;
  tech_service_earnings_cents: number; salon_service_share_cents: number;
  card_tip_cents: number; cash_tip_cents: number; retail_commission_cents: number;
  snapshot_at: Ts; created_at: Generated<Ts>;
}
export interface CompensationPoliciesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null; service_id: string | null;
  service_category: string | null; ticket_id: string | null; label: string | null; created_by: string | null;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechnicianTierPlansTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string;
  mode: Generated<string>; bands_json: Generated<unknown>; basis: Generated<string>; status: Generated<string>;
  effective_start: Ts; effective_end: Ts | null; created_by: string | null; created_at: Ts;
}
export interface BonusRulesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null;
  metric: string; target_value: Generated<string | number>; amount_cents: Generated<string | number>;
  label: string | null; status: Generated<string>; effective_start: Ts; effective_end: Ts | null;
  created_by: string | null; created_at: Ts;
}
export interface TechnicianClassificationsTable {
  id: Generated<string>; tenant_id: string; technician_id: string; classification: Generated<string>;
  set_by: string | null; updated_at: Generated<Ts>; created_at: Generated<Ts>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CompensationAgreementsTable {
  id: Generated<string>; tenant_id: string; technician_id: string; title: string; terms_json: Generated<unknown>;
  status: Generated<string>; version: Generated<number>; effective_start: Generated<Ts>; created_by: string | null;
  created_at: Generated<Ts>; acknowledged_at: Ts | null; acknowledged_by: string | null;
}
export interface CompensationPolicyVersionsTable {
  id: Generated<string>; policy_id: string; tenant_id: string; version: Generated<number>;
  commission_type: Generated<string>; commission_value: Generated<number>;
  supply_method: Generated<string>; supply_value: Generated<number>; discount_funding: Generated<string>;
  effective_start: Ts; effective_end: Ts | null; status: Generated<string>;
  approved: Generated<boolean>; approved_by: string | null; approved_at: Ts | null; created_by: string | null; created_at: Ts;
}
export interface CompensationAdjustmentsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null; ticket_id: string | null; service_line_id: string | null; period_id: string | null; category: string; amount_cents: number; reason: string; status: Generated<string>; source: string; targets_future_period: Generated<boolean>; requested_by: string | null; approved_by: string | null; created_at: Generated<Ts>; refund_payment_id: string | null; original_period_id: string | null; chargeback_id: string | null; deduction_type: string | null; reason_code: string | null; idempotency_key: string | null; decided_by: string | null; decided_at: Ts | null; decision_reason: string | null; }
export interface TechnicianGuaranteePoliciesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null;
  period: Generated<string>; guaranteed_cents: number; proration: Generated<string>; type: Generated<string>;
  include_service_commission: Generated<boolean>; include_hourly: Generated<boolean>; include_salary: Generated<boolean>;
  include_retail: Generated<boolean>; include_bonus: Generated<boolean>; include_manual: Generated<boolean>;
  require_clocked_in: Generated<boolean>; min_hours_required: number | null; probation_excluded: Generated<boolean>;
  effective_start: Generated<Ts>; effective_end: Ts | null; version: Generated<number>; status: Generated<string>;
  created_by: string | null; created_at: Generated<Ts>;
}
export interface CheckoutLocksTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string;
  owner_user_id: string; owner_device_id: string | null; session_id: string; source: Generated<string>;
  acquired_at: Ts; refreshed_at: Ts; expires_at: Ts; released_at: TsNull; release_reason: string | null;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  checkout_version: string | null;   // migration 690 (Secure Tap to Pay M6-6): the ticket version the claim was made against
}
export interface OnboardingRecordsTable {
  id: Generated<string>; application_id: string; application_type: Generated<string>; parent_tenant_id: string | null;
  tenant_id: string | null; branch_count: Generated<number>; current_stage: Generated<string>; resume_stage: string | null;
  completion_pct: Generated<number>; specialist_user_id: string | null; identity_status: Generated<string>; merchant_status: Generated<string>;
  bank_status: Generated<string>; hardware_status: Generated<string>; data_import_status: Generated<string>; training_status: Generated<string>;
  users_invited: Generated<boolean>; missing_docs_count: Generated<number>; priority: Generated<string>; target_activation_date: string | null;
  activated_at: TsNull; activation_type: string | null; created_at: Ts; updated_at: Ts; stage_entered_at: Generated<Ts>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface OnboardingStageHistoryTable {
  id: Generated<string>; onboarding_id: string; from_state: string | null; to_state: string;
  skipped_stages: Generated<unknown>; reason: string | null; actor_user_id: string | null; actor_role: string | null;
  audit_event_id: string | null; created_at: Ts;
}
export interface OnboardingApprovalsTable {
  id: Generated<string>; onboarding_id: string; approval_type: string; stage: string | null; status: Generated<string>;
  decision: string | null; decided_by_user_id: string | null; decided_by_role: string | null; decided_at: TsNull;
  reason: string | null; previous_status: string | null; new_status: string | null;
  requires_second_approval: Generated<boolean>; second_approver_user_id: string | null; second_approved_at: TsNull;
  applicant_notified: Generated<boolean>; audit_event_id: string | null; created_at: Ts; updated_at: Ts;
}
export interface OnboardingDocumentsTable {
  id: Generated<string>; onboarding_id: string; category: string; storage_key: string | null; file_name: string | null;
  content_type: string | null; size_bytes: string | number | null; status: Generated<string>; reviewer_user_id: string | null;
  reviewed_at: TsNull; rejection_reason: string | null; issue_date: string | null; expiration_date: string | null;
  version: Generated<number>; replaced_by_document_id: string | null; virus_scan_status: Generated<string>; created_at: Ts; updated_at: Ts;
}
export interface OnboardingNotesTable {
  id: Generated<string>; onboarding_id: string; author_user_id: string | null; author_name: string | null;
  note_type: Generated<string>; body: string; stage: string | null; visibility: Generated<string>; attachment_document_id: string | null;
  follow_up_date: string | null; created_at: Ts;
}
export interface SuperAdminReportDefinitionsTable {
  id: Generated<string>;
  name: string;
  dimension: string;
  measure: string;
  visualization: Generated<string>;
  range_key: Generated<string>;
  scope_tenant_id: string | null;
  filters_json: Generated<unknown>;
  row_limit: Generated<number>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface SuperAdminScheduledReportsTable {
  id: Generated<string>;
  name: string;
  source: Generated<string>;
  report_definition_id: string | null;
  format: Generated<string>;
  range_key: Generated<string>;
  scope_tenant_id: string | null;
  frequency: Generated<string>;
  recipients_json: Generated<unknown>;
  delivery_method: Generated<string>;
  enabled: Generated<boolean>;
  next_run_at: Generated<Date>;
  last_run_at: Date | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}
export interface SuperAdminScheduledReportRunsTable {
  id: Generated<string>;
  schedule_id: string;
  status: string;
  format: string;
  filename: string | null;
  artifact_base64: string | null;
  byte_size: Generated<number>;
  error: string | null;
  trigger: Generated<string>;
  created_at: Generated<Date>;
  artifact_key: string | null;   // migration 677 (B-18) — the private-store key; artifact_base64 stays for older runs
}
export interface PlatformRequestMetricsTable {
  id: Generated<string>;
  method: string;
  route: string;
  status_code: number;
  latency_ms: number;
  created_at: Generated<Date>;
}
export interface PlatformRequestMetricsMinuteTable {
  bucket_minute: Ts; method: string; route: string; status_class: number;
  count: Generated<number>; count_429: Generated<number>; sum_ms: Generated<number>; max_ms: Generated<number>;
  le_5: Generated<number>; le_10: Generated<number>; le_25: Generated<number>; le_50: Generated<number>; le_100: Generated<number>;
  le_250: Generated<number>; le_500: Generated<number>; le_1000: Generated<number>; le_2500: Generated<number>;
  le_5000: Generated<number>; le_10000: Generated<number>; le_inf: Generated<number>;
}
export interface BranchTransferRequestsTable {
  id: Generated<string>; branch_id: string; from_tenant_id: string; to_tenant_id: string; status: Generated<string>;
  reason: string; effective_date: string | null; impact_snapshot: unknown | null;
  requested_by_user_id: string | null; reviewed_by_user_id: string | null; reviewed_at: TsNull;
  created_at: Ts; updated_at: Ts;
}
export interface WorkerTransferRequestsTable {
  id: Generated<string>; tenant_id: string; user_id: string; from_branch_id: string | null; to_branch_id: string;
  status: Generated<string>; reason: string; requested_by_user_id: string | null;
  reviewed_by_user_id: string | null; reviewed_at: TsNull; decision_note: string | null;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SupportTicketAttachmentsTable {
  id: Generated<string>; tenant_id: string; ticket_id: string; uploader_user_id: string | null;
  storage_key: string; file_name: string; content_type: string; size_bytes: string | number;
  deleted_at: TsNull; deleted_by_user_id: string | null; created_at: Ts;
  deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
// ── Appended: tables introspected from the applied migrations (schema-accurate). Conventions match above:
//    Ts/TsNull = timestamptz · ColumnType<string,string,string> = date · unknown = jsonb · T[] = array · Generated<T> = has default/identity.
export interface AccessRequestsTable {
  id: Generated<string>;
  tenant_id: string | null;
  requesting_user_id: string;
  prior_role: string | null;
  requested_role: string;
  requested_branch_ids: Generated<unknown>;
  reason: string;
  requested_duration_days: number | null;
  status: Generated<string>;
  high_risk: Generated<boolean>;
  approver_user_id: string | null;
  decision_notes: string | null;
  expires_at: TsNull;
  decided_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiBillingEventsTable {
  id: Generated<string>;
  event_id: string;
  tenant_id: string | null;
  package_code: string;
  event_type: string;
  provider: string | null;
  from_status: string | null;
  to_status: string | null;
  payment_status: string | null;
  applied: Generated<boolean>;
  raw_json: unknown | null;
  created_at: Ts;
}
export interface AiBookingConversionEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  source: string;
  stage: string;
  outcome: string | null;
  failure_reason: string | null;
  appointment_id: string | null;
  actor_user_id: string | null;
  correlation_id: string | null;
  latency_ms: number | null;
  created_at: Ts;
  campaign_id: string | null;
}
export interface AiBookingRevokedLinksTable {
  tenant_id: string;
  jti: string;
  reason: string | null;
  revoked_by: string | null;
  revoked_at: Ts;
}
export interface AiGlobalPromptsTable {
  id: Generated<string>;
  prompt_key: string;
  name: string;
  body: string | null;
  version: Generated<number>;
  status: Generated<string>;
  updated_by_user_id: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface AiInsightsTable {
  id: Generated<string>;
  insight_reference: string;
  tenant_id: string | null;
  tenant_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  category: string;
  title: string;
  summary: string | null;
  recommendation: string | null;
  severity: Generated<string>;
  confidence: number | null;
  confidence_method: string | null;
  status: Generated<string>;
  affected_start_at: TsNull;
  affected_end_at: TsNull;
  source_cutoff_at: TsNull;
  generated_at: Ts;
  last_evaluated_at: Ts;
  expires_at: TsNull;
  freshness: Generated<string>;
  model_provider: string | null;
  model_name: string | null;
  model_version: string | null;
  prompt_version: string | null;
  detector_version: string | null;
  deduplication_key: string | null;
  occurrence_count: Generated<number>;
  churn_risk_score: number | null;
  flagged_amount_cents: number | null;
  assigned_to_user_id: string | null;
  reviewed_at: TsNull;
  reviewed_by_user_id: string | null;
  resolved_at: TsNull;
  dismissed_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}

// 424: feedback on an insight — human-review-only; snapshots model/prompt version at feedback time.
export interface AiInsightFeedbackTable {
  id: Generated<string>;
  insight_id: string;
  insight_reference: string | null;
  insight_title: string | null;
  tenant_id: string | null;
  verdict: string;
  comment: string | null;
  model_version: string | null;
  prompt_version: string | null;
  submitted_by_user_id: string | null;
  created_at: Generated<Date | string>;
}
export interface AiNarrativeModelVersionsTable {
  id: Generated<string>;
  model_name: string;
  prompt_version: string;
  prompt_hash: string;
  status: Generated<string>;
  notes: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface AiPlanSettingsTable {
  plan_code: string;
  price_cents_override: number | null;
  discount_type: string | null;
  discount_value: Generated<number>;
  active: Generated<boolean>;
  updated_at: Ts;
  annual_months: Generated<number>;
}
export interface AiProvidersTable {
  id: Generated<string>;
  provider_key: string;
  display_name: string;
  status: Generated<string>;
  default_model: string | null;
  api_key_ciphertext: string | null;
  api_key_masked: string | null;
  api_key_fingerprint: string | null;
  last_sync_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface AiReceptionistAgentVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  version: number;
  configuration: unknown;
  created_by_user_id: string | null;
  created_at: Ts;
}
export interface AiReceptionistAgentsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  status: Generated<string>;
  call_type: Generated<string>;
  language: Generated<string>;
  use_case: string | null;
  greeting: string | null;
  behavior: string | null;
  provider: string | null;
  provider_agent_id: string | null;
  knowledge_version: Generated<number>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  archived_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 756 — AI Front Desk: versioned drafts, persisted wizard, activation / pause / verification
  description: string | null; config_version: Generated<number>; wizard_step: Generated<number>; wizard_state: Generated<unknown>; booking_mode: Generated<string>;
  handoff_destination: string | null; after_hours_message: string | null; activated_at: TsNull; activated_by: string | null; paused_at: TsNull; last_verified_at: TsNull;
}
export interface AiReceptionistFaqsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  question: string;
  answer: string;
  category: string | null;
  language: Generated<string>;
  is_active: Generated<boolean>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 753 — AI Business Setup FAQ approval workflow
  status: Generated<string>; version: Generated<number>; approved_revision_id: string | null; draft_revision_id: string | null;
  approved_by_user_id: string | null; approved_at: Ts | null; submitted_at: Ts | null; archived_at: Ts | null; idempotency_key: string | null;
}
export interface AiReceptionistFaqRevisionsTable {   // migration 753 — append-only FAQ text history
  id: Generated<string>; tenant_id: string; faq_id: string; revision_no: number; question: string; answer: string; category: string | null;
  prior_revision_id: string | null; reason: string | null; source: Generated<string>; created_by_user_id: string | null; created_at: Generated<Ts>;
}
export interface AiReceptionistControlTable {   // migration 754 — per-salon AI Receptionist control (armed / test call / activation)
  id: Generated<string>; tenant_id: string; branch_id: string | null; booking_armed: Generated<boolean>; booking_armed_at: Ts | null; booking_armed_by: string | null;
  booking_arm_reason: string | null; test_call_provider_call_id: string | null; test_call_verified_at: Ts | null; test_call_verified_by: string | null;
  activated: Generated<boolean>; activated_at: Ts | null; activated_by: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null;
}
export interface AiReceptionistAgentEventsTable {   // migration 756 — append-only AI Front Desk agent change history
  id: Generated<string>; tenant_id: string; branch_id: string | null; agent_id: string; action: string; before_state: Generated<unknown>; after_state: Generated<unknown>;
  reason: string | null; config_version: number | null; prior_agent_id: string | null; operation_id: string | null; actor_user_id: string | null; idempotency_key: string | null; created_at: Generated<Ts>;
}
export interface AiReceptionistControlEventsTable {   // migration 754 — append-only protected-setting history
  id: Generated<string>; tenant_id: string; branch_id: string | null; action: string; before_state: Generated<unknown>; after_state: Generated<unknown>;
  reason: string | null; actor_user_id: string | null; idempotency_key: string | null; created_at: Generated<Ts>;
}
export interface VoiceCallEventsTable {   // migration 755 — AI Calls: signed provider events (hash only), one row per event key
  id: Generated<string>; tenant_id: string; branch_id: string | null; provider: Generated<string>; provider_event_key: string; event_type: string; provider_call_id: string;
  occurred_at: TsNull; received_at: Generated<Ts>; last_received_at: Generated<Ts>; deliveries: Generated<number>; payload_sha256: string; auth: string; disposition: string;
  failure_reason: string | null; created_at: Generated<Ts>;
}
export interface VoiceToolExecutionsTable {   // migration 755 — AI Calls: tool request → result ledger
  id: Generated<string>; tenant_id: string; branch_id: string; provider_call_id: string; invocation_key: string; tool_name: string; tool_kind: string; status: Generated<string>;
  business_result: string | null; related_type: string | null; related_id: string | null; error_category: string | null; requests: Generated<number>;
  requested_at: Generated<Ts>; finished_at: TsNull; created_at: Generated<Ts>;
}
export interface AiCallsHealthRunsTable {   // migration 755 — read-only "Check AI Calls System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; overall: string; checks: Generated<unknown>; run_by: string | null; created_at: Generated<Ts>;
}
export interface AiReceptionistHealthRunsTable {   // migration 754 — read-only "Check AI Receptionist System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; overall: string; checks: Generated<unknown>; checked_by: string | null; created_at: Generated<Ts>;
  scope: Generated<string>; agent_id: string | null;   // migration 756 — receptionist | front_desk | agent
}
export interface AiReceptionistActionsTable {   // migration 754 — approval-gated priority-list actions
  id: Generated<string>; tenant_id: string; branch_id: string | null; kind: string; status: Generated<string>; source_type: string; source_ref: string; payload: Generated<unknown>;
  prepared_by: string | null; prepared_reason: string | null; decided_by: string | null; decided_at: Ts | null; decision_reason: string | null; result_ref: string | null;
  failure_reason: string | null; policy_decision: string | null; idempotency_key: string; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null;
}
export interface AiReceptionistFaqEventsTable {   // migration 753 — append-only FAQ lifecycle / audit trail
  id: Generated<string>; tenant_id: string; branch_id: string | null; faq_id: string; action: string; from_status: string | null; to_status: string | null;
  revision_id: string | null; actor_user_id: string | null; reason: string | null; idempotency_key: string | null; created_at: Generated<Ts>;
}
export interface AiBusinessSetupPreviewRunsTable {   // migration 753 — Preview AI Knowledge history (question redacted)
  id: Generated<string>; tenant_id: string; branch_id: string | null; question: string; intent: string; answer: string; outcome: string;
  sources: Generated<unknown>; tester_user_id: string | null; created_at: Generated<Ts>;
}
export interface AiReceptionistFollowUpsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  reason: string;
  priority: Generated<string>;
  status: Generated<string>;
  customer_id: string | null;
  caller_phone: string | null;
  provider_call_id: string | null;
  appointment_id: string | null;
  assigned_user_id: string | null;
  due_at: TsNull;
  notes: string | null;
  resolution: string | null;
  created_by_user_id: string | null;
  source: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  resolved_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 759 — AI Follow-Ups & Human Handoff Center
  source_event_key: string | null; version: Generated<number>; due_tz: string | null; resolution_category: string | null; customer_match: string | null;
  contact_attempts: Generated<number>; first_contact_at: TsNull; last_contact_at: TsNull; escalation_level: Generated<number>; escalated_at: TsNull;
  reopened_count: Generated<number>; waiting_until: TsNull; description: string | null; assigned_at: TsNull;
}
export interface AiHandoffEventsTable {   // migration 759
  id: Generated<string>; tenant_id: string; branch_id: string | null; provider_call_id: string; source: string; source_key: string; kind: string;
  callback_required: Generated<boolean>; reason: string | null; follow_up_id: string | null; created_at: Generated<Ts>;
}
export interface AiFollowUpActivityTable {   // migration 759 — append-only
  id: Generated<string>; tenant_id: string; follow_up_id: string; actor_user_id: string | null; event_type: string; from_value: string | null; to_value: string | null;
  note: string | null; metadata: Generated<unknown>; created_at: Generated<Ts>;
}
export interface AiFollowUpContactAttemptsTable {   // migration 759
  id: Generated<string>; tenant_id: string; follow_up_id: string; channel: string; actor_user_id: string; recipient_ref: string | null; outcome: string;
  notification_id: string | null; request_key: string | null; idempotency_key: string; note: string | null; next_attempt_at: TsNull; created_at: Generated<Ts>;
}
export interface AiFollowUpEscalationsTable {   // migration 759
  id: Generated<string>; tenant_id: string; follow_up_id: string; rule: string; severity: string; owner_alert_id: string | null;
  triggered_at: Generated<Ts>; acknowledged_at: TsNull; resolved_at: TsNull;
}
export interface AiFollowUpHealthRunsTable {   // migration 759 — read-only "Check Follow-Up System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; results: Generated<unknown>; ran_at: Generated<Ts>;
}
export interface AiReceptionistHandoffsTable {
  id: Generated<string>;
  call_code: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  ai_session_id: string | null;
  customer_ref: string | null;
  transferred_to: Generated<string>;
  reason: string | null;
  status: Generated<string>;
  requested_at: Ts;
  connected_at: TsNull;
  wait_seconds: number | null;
  failure_reason: string | null;
  booking_result: string | null;
  support_case_id: string | null;
  created_at: Ts;
}
export interface AiReceptionistProvisioningJobsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  agent_id: string;
  status: Generated<string>;
  current_step: string | null;
  progress: Generated<number>;
  error_code: string | null;
  safe_error_message: string | null;
  provider_agent_id: string | null;
  idempotency_key: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiReceptionistSettingsTable {
  tenant_id: string;
  branch_id: Generated<string>;
  settings: Generated<unknown>;
  updated_by_user_id: string | null;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiReportDeliveriesTable {
  id: Generated<string>;
  run_id: string;
  recipient_id: string;
  recipient_type: Generated<string>;
  recipient_tenant: string | null;
  channel: Generated<string>;
  status: Generated<string>;
  excluded_reason: string | null;
  failure_category: string | null;
  attempt_count: Generated<number>;
  delivered_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface AiReportNarrativesTable {
  id: Generated<string>;
  run_id: string;
  template_id: string | null;
  template_version: number | null;
  model_version_id: string | null;
  all_grounded: Generated<boolean>;
  grounding_ok: Generated<boolean>;
  offending_count: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}
export interface AiReportRunsTable {
  id: Generated<string>;
  report_reference: string;
  report_key: string;
  tenant_id: string | null;
  branch_id: string | null;
  scope_type: Generated<string>;
  scope_snapshot: Generated<unknown>;
  date_range_start: ColumnType<string, string, string>;
  date_range_end: ColumnType<string, string, string>;
  timezone: Generated<string>;
  data_cutoff_at: Ts;
  generation_source: Generated<string>;
  generation_status: Generated<string>;
  metrics_snapshot: Generated<unknown>;
  requested_by: string | null;
  started_at: TsNull;
  completed_at: TsNull;
  duration_ms: number | null;
  failure_category: string | null;
  failure_message: string | null;
  parent_run_id: string | null;
  idempotency_key: string;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiReportSchedulesTable {
  id: Generated<string>;
  name: string;
  report_key: string;
  frequency: string;
  run_at_time: Generated<string>;
  timezone: Generated<string>;
  scope_type: Generated<string>;
  tenant_id: string | null;
  branch_id: string | null;
  start_at: Ts;
  end_at: TsNull;
  next_run_at: TsNull;
  status: Generated<string>;
  owner: Generated<string>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiReportTemplatesTable {
  id: Generated<string>;
  report_key: string;
  name: string;
  version: Generated<number>;
  status: Generated<string>;
  sections: Generated<unknown>;
  created_by: string | null;
  published_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface AiSupportConversationsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  turn_count: Generated<number>;
  last_grounded: boolean | null;
  escalated_ticket_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiSupportMessagesTable {
  id: Generated<string>;
  conversation_id: string;
  tenant_id: string;
  user_id: string | null;
  question: string;
  answer: string;
  grounded: Generated<boolean>;
  confidence: string | null;
  sources: Generated<unknown>;
  created_at: Ts;
}
export interface AiPriceVersionsTable {
  id: string;
  provider: string;
  model: string;
  unit: Generated<string>;
  in_per_m: string | number;
  out_per_m: Generated<string | number>;
  effective_from: Date;
  effective_to: Date | null;
  source_note: string | null;
  created_at: Generated<Date>;
}

export interface AiKnowledgeDocumentsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  kind: string;
  title: string;
  status: Generated<string>;
  visibility: Generated<string>;
  allowed_roles: Generated<string[]>;
  source_uri: string | null;
  published_at: Date | null;
  published_by: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}

export interface AiKnowledgeChunksTable {
  id: Generated<string>;
  document_id: string;
  tenant_id: string;
  branch_id: string | null;
  chunk_index: number;
  content: string;
  content_tsv: Generated<string>;
  embedding_model_version: string | null;
  created_at: Generated<Date>;
}

export interface AiFeedbackTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  request_id: string;
  task_key: string;
  prompt_key: string;
  prompt_version: number;
  provider: string | null;
  model: string | null;
  outcome: string;
  reason_code: string | null;
  note: string | null;
  retained_ratio: string | number | null;
  actor_user_id: string | null;
  created_at: Generated<Date>;
}

export interface AiJobsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  module: string;
  task_key: string;
  status: Generated<string>;
  priority: Generated<number>;
  actor_user_id: string | null;
  input_reference: string;
  input_meta: Generated<unknown>;
  result_reference: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  idempotency_key: string | null;
  run_after: Generated<Date>;
  claimed_at: Date | null;
  claimed_by: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}

export interface AiJobAttemptsTable {
  id: Generated<string>;
  job_id: string;
  attempt_no: number;
  provider: string | null;
  model: string | null;
  prompt_key: string | null;
  prompt_version: number | null;
  started_at: Generated<Date>;
  ended_at: Date | null;
  result: string | null;
  error_code: string | null;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  cost_micro_usd: Generated<string | number | bigint>;
}

export interface AiBudgetsTable {
  id: Generated<string>;
  tenant_id: string;
  scope_key: Generated<string>;
  period: string;
  limit_micro_usd: Generated<string | number | bigint>;
  at_limit_behavior: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}

export interface AiBudgetAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  scope_key: string;
  period: string;
  period_start: Date;
  threshold: number;
  spent_micro_usd: string | number | bigint;
  limit_micro_usd: string | number | bigint;
  created_at: Generated<Date>;
}

export interface AiPromptVersionsTable {
  id: Generated<string>;
  prompt_key: string;
  module: string;
  task_key: string;
  version: number;
  system_instructions: string;
  template: string;
  variables: Generated<unknown>;
  output_schema_key: string;
  language_behavior: Generated<string>;
  status: Generated<string>;
  rollout_tenant_ids: Generated<string[]>;
  rollout_percent: Generated<number>;
  content_sha256: string;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  created_at: Generated<Date>;
}

export interface AiPromptRollbacksTable {
  id: Generated<string>;
  prompt_key: string;
  from_version: number;
  to_version: number;
  reason: string;
  actor_user_id: string;
  created_at: Generated<Date>;
}

export interface AiUsageLogsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  package_code: string;
  action: Generated<string>;
  model_provider: string | null;
  model_name: string | null;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  total_tokens: Generated<number>;
  cost_estimate_cents: Generated<number>;
  price_version_id: string | null;
  usage_unit: Generated<string>;
  usage_amount: Generated<number>;
  status: Generated<string>;
  error_message: string | null;
  request_id: string | null;
  created_at: Ts;
  cost_micro_usd: Generated<number>;
  branch_id: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface AlertNotesTable {
  id: Generated<string>;
  alert_id: string;
  actor_user_id: string | null;
  note: string;
  is_internal: Generated<boolean>;
  created_at: Ts;
}
export interface AlertsTable {
  id: Generated<string>;
  tenant_id: string | null;
  tenant_name: string | null;
  title: string;
  message: Generated<string>;
  type: Generated<string>;
  severity: Generated<string>;
  status: Generated<string>;
  related_module: string | null;
  related_record_id: string | null;
  assigned_to_user_id: string | null;
  dedupe_key: string;
  read_at: TsNull;
  resolved_at: TsNull;
  dismissed_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  incident_id: string | null;
  notified_severity: string | null;
  notified_at: TsNull;
  reminder_sent_at: TsNull;
  recovery_notified_at: TsNull;
  notify_failures: Generated<number>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AppointmentChangeLogTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  appointment_id: string;
  change_type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_type: string | null;
  actor_id: string | null;
  source: string | null;
  created_at: Ts;
}
export interface AppointmentReminderAttemptsTable {
  id: Generated<number>;
  tenant_id: string;
  appointment_id: string | null;
  channel: string;
  status: string;
  error: string | null;
  created_at: Ts;
  dispatch_id: string | null; notification_id: string | null; kind: Generated<string>; actor_user_id: string | null;   // migration 747 — the event trail
  idempotency_key: string | null; occurrence_key: string | null; note: string | null;
}
export interface AppointmentRemindersSentTable {
  tenant_id: string;
  appointment_id: string;
  reminded_at: Ts;
  lead_minutes: Generated<number>;   // migration 670 — the rung (one row per appointment per rung)
  // migration 747 — the per-occurrence dispatch record (claimed before the send); nullable until the NOT NULL contract release
  id: Generated<string | null>; occurrence_key: string | null; state: string | null; reason: string | null; channel: string | null; branch_id: string | null; customer_id: string | null;
  intended_send_at: TsNull; appt_start_at: TsNull; notification_id: string | null; attempt_count: Generated<number>; created_at: Generated<TsNull>; updated_at: Generated<TsNull>; updated_by: string | null;
}
export interface AppointmentReminderRunsTable {
  id: Generated<string>; tenant_id: string; trigger: string; started_at: Generated<Ts>; finished_at: TsNull; outcome: Generated<string>;
  candidates: Generated<number>; submitted: Generated<number>; skipped: Generated<number>; deferred: Generated<number>; failed: Generated<number>; cancelled: Generated<number>; error: string | null;
}
export interface AppointmentReschedulesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  appointment_id: string;
  from_technician_id: string | null;
  to_technician_id: string | null;
  from_start_time: TsNull;
  to_start_time: TsNull;
  reason: string | null;
  changed_by_user_id: string | null;
  created_at: Ts;
}
export interface AppointmentWaitlistTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  customer_id: string;
  service_id: string | null;
  preferred_technician_id: string | null;
  eta_time: TsNull;
  position: Generated<number>;
  status: Generated<string>;
  created_at: Ts;
}
export interface AuditEvidenceCustodyTable {
  id: Generated<string>;
  pack_id: string;
  entry_type: string;
  actor: string | null;
  purpose: string | null;
  created_at: Ts;
}
export interface AuditEvidencePacksTable {
  id: Generated<string>;
  pack_ref: string;
  requested_by: string | null;
  requested_by_id: string | null;
  scope: Generated<unknown>;
  format: Generated<string>;
  event_count: Generated<number>;
  checksum: string;
  manifest: Generated<unknown>;
  redaction_applied: Generated<boolean>;
  status: Generated<string>;
  created_at: Ts;
  expires_at: TsNull;
}
export interface AuditExportFlagsTable {
  id: Generated<string>;
  event_ref: string;
  tenant_id: string | null;
  rule_key: string;
  rule_version: Generated<number>;
  risk: string;
  reason: string;
  status: Generated<string>;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  review_note: string | null;
  created_at: Ts;
}
export interface AuditInvestigationTimelineTable {
  id: Generated<string>;
  investigation_id: string;
  entry_type: string;
  payload: Generated<unknown>;
  author: string | null;
  created_at: Ts;
}
export interface AuditInvestigationsTable {
  id: Generated<string>;
  case_ref: string;
  title: string;
  tenant_id: string | null;
  severity: Generated<string>;
  assignee: string | null;
  status: Generated<string>;
  description: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AuditLegalHoldsTable {
  id: Generated<string>;
  hold_ref: string;
  scope_type: string;
  scope_value: string | null;
  reason: string;
  legal_authority: string | null;
  status: Generated<string>;
  created_by: string | null;
  created_at: Ts;
  review_date: ColumnType<string | null, string | null, string | null>;
  expiration_date: ColumnType<string | null, string | null, string | null>;
  released_by: string | null;
  released_at: TsNull;
  release_reason: string | null;
}
export interface AuditLogsTable {
  id: Generated<string>;
  tenant_id: string | null;
  branch_id: string | null;
  user_id: string | null;
  role: string | null;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata_json: unknown | null;
  created_at: Ts;
}
export interface AuditRetentionPoliciesTable {
  id: Generated<string>;
  category: string;
  hot_days: Generated<number>;
  archive_days: Generated<number>;
  version: Generated<number>;
  status: Generated<string>;
  reason: string | null;
  effective_date: ColumnType<string, string, string>;
  approved_by: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface AuditTamperControlsTable {
  id: Generated<string>;
  control_key: string;
  value: string;
  status: Generated<string>;
  detail: string | null;
  last_verified_at: TsNull;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface AutomationExceptionsTable {
  id: Generated<string>;
  rule_id: string;
  tenant_id: string;
  branch_id: string | null;
  exception_type: string;
  original_value: string | null;
  override_value: string | null;
  notes: string | null;
  reason: string | null;
  status: Generated<string>;
  effective_date: TsNull;
  expiration_date: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AutomationExecutionsTable {
  id: Generated<string>;
  execution_reference: string | null;
  rule_id: string;
  rule_version_id: string | null;
  trigger_event_id: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  status: Generated<string>;
  triggered_by: Generated<string>;
  started_at: Ts;
  completed_at: TsNull;
  duration_ms: number | null;
  idempotency_key: string;
  correlation_id: string | null;
  causation_id: string | null;
  retry_count: Generated<number>;
  failure_category: string | null;
  failure_message: string | null;
  action_count: Generated<number>;
  notifications_sent: Generated<number>;
  is_test: Generated<boolean>;
  created_at: Ts;
}
export interface AutomationFailuresTable {
  id: Generated<string>;
  execution_id: string | null;
  rule_id: string;
  tenant_id: string | null;
  failure_reason: string;
  failure_category: Generated<string>;
  severity: Generated<string>;
  status: Generated<string>;
  retry_count: Generated<number>;
  last_attempt_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AutomationRuleVersionsTable {
  id: Generated<string>;
  rule_id: string;
  version_number: number;
  trigger_definition: Generated<unknown>;
  condition_definition: Generated<unknown>;
  action_definitions: Generated<unknown>;
  scope_definition: Generated<unknown>;
  retry_policy: Generated<unknown>;
  timeout_ms: Generated<number>;
  cooldown_seconds: Generated<number>;
  execution_limit: number | null;
  effective_from: TsNull;
  effective_to: TsNull;
  change_notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  published_at: TsNull;
  created_at: Ts;
}
export interface AutomationRulesTable {
  id: Generated<string>;
  rule_reference: string;
  name: string;
  description: string | null;
  rule_type: Generated<string>;
  trigger_id: string;
  trigger_category: Generated<string>;
  status: Generated<string>;
  scope_kind: Generated<string>;
  tenant_id: string | null;
  branch_id: string | null;
  current_version: Generated<number>;
  next_evaluation_at: TsNull;
  owner_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BankAccountsTable {
  id: Generated<string>;
  tenant_id: string;
  nickname: string;
  bank_name: string | null;
  account_type: Generated<string>;
  account_last4: string | null;
  currency: Generated<string>;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  is_default: Generated<boolean>;
  deactivated_at: TsNull;
  deactivated_by_user_id: string | null;
  created_by_user_id: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface BankDepositsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  bank_account_id: string;
  amount_cents: Generated<number>;
  currency: Generated<string>;
  deposit_date: ColumnType<string | null, string | null, string | null>;
  posted_at: TsNull;
  description: string | null;
  reference: string | null;
  external_bank_txn_id: string | null;
  source: Generated<string>;
  status: Generated<string>;
  matched_settlement_id: string | null;
  reconciliation_status: Generated<string>;
  import_batch_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  created_by_user_id: string | null;
  notes: string | null;
  idempotency_key: string | null;
  reference_normalized: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface BankWebhookEndpointsTable {
  id: Generated<string>;
  tenant_id: string;
  bank_account_id: string;
  // token / signing_secret (plaintext) dropped by 542 — Phase 10, Constitution 12 M6
  signing_secret_enc: string | null;
  token_hash: string | null;
  status: Generated<string>;
  created_at: Ts;
}
export interface BillingCreditsTable {
  id: Generated<string>;
  tenant_id: string;
  amount_cents: number;
  remaining_cents: number;
  currency: Generated<string>;
  reason: Generated<string>;
  source: string | null;
  related_invoice_id: string | null;
  status: Generated<string>;
  expires_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
}
export interface BillingDiscountsTable {
  id: Generated<string>;
  tenant_id: string | null;
  code: string;
  discount_type: Generated<string>;
  percent: number | null;
  amount_cents: number | null;
  applies_to: Generated<string>;
  starts_at: ColumnType<string | null, string | null, string | null>;
  ends_at: ColumnType<string | null, string | null, string | null>;
  cycles: number | null;
  status: Generated<string>;
  created_at: Ts;
}
export interface BillingExportJobsTable {
  id: Generated<string>;
  report: string;
  format: Generated<string>;
  filters_json: Generated<unknown>;
  status: Generated<string>;
  row_count: number | null;
  filename: string | null;
  content_type: string | null;
  content_b64: string | null;
  download_token_hash: string;
  error: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  completed_at: TsNull;
  expires_at: TsNull;
  content_key: string | null;    // migration 677 (B-18)
}
export interface BillingInvoiceLinesTable {
  id: Generated<string>;
  invoice_id: string;
  tenant_id: string;
  kind: Generated<string>;
  description: string;
  quantity: Generated<number>;
  unit_price_cents: Generated<number>;
  amount_cents: Generated<number>;
  sort_order: Generated<number>;
}
export interface BillingInvoicesTable {
  id: Generated<string>;
  invoice_number: string;
  tenant_id: string;
  plan_code: string | null;
  currency: Generated<string>;
  subtotal_cents: Generated<number>;
  discount_total_cents: Generated<number>;
  credit_total_cents: Generated<number>;
  tax_total_cents: Generated<number>;
  total_cents: Generated<number>;
  amount_paid_cents: Generated<number>;
  amount_due_cents: Generated<number>;
  status: Generated<string>;
  retry_status: string | null;
  invoice_date: ColumnType<string | null, string | null, string | null>;
  due_date: ColumnType<string | null, string | null, string | null>;
  period_start: ColumnType<string | null, string | null, string | null>;
  period_end: ColumnType<string | null, string | null, string | null>;
  finalized_at: TsNull;
  paid_at: TsNull;
  last_action: string | null;
  created_at: Ts;
}
export interface BillingKpiSnapshotsTable {
  id: Generated<string>;
  snapshot_date: ColumnType<string, string, string>;
  kpi_key: string;
  value_num: Generated<number>;
  created_at: Ts;
}
export interface BillingPaymentAttemptsTable {
  id: Generated<string>;
  invoice_id: string;
  tenant_id: string;
  amount_cents: number;
  status: Generated<string>;
  provider: Generated<string>;
  idempotency_key: string;
  recovered_from_status: string | null;
  attempt_number: Generated<number>;
  created_at: Ts;
}
export interface BillingWebhookEventsTable {
  id: Generated<string>;
  provider: Generated<string>;
  provider_event_id: string;
  event_type: string;
  invoice_id: string | null;
  status: Generated<string>;
  received_at: Ts;
  processed_at: TsNull;
}
export interface BookingCheckinFailedEventsTable {
  id: Generated<string>;
  event_code: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  category: Generated<string>;
  booking_id: string | null;
  checkin_id: string | null;
  appointment_id: string | null;
  device_id: string | null;
  source: string | null;
  check_in_method: string | null;
  failure_type: Generated<string>;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string | null;
  retry_status: Generated<string>;
  retry_count: Generated<number>;
  attempt_count: Generated<number>;
  escalation_state: Generated<string>;
  resolution: string | null;
  occurred_at: Ts;
  last_attempt_at: TsNull;
  created_at: Ts;
}
export interface BookingCheckinRetryAttemptsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  failed_event_id: string;
  idempotency_key: string;
  attempt_number: number;
  status: Generated<string>;
  backoff_seconds: Generated<number>;
  next_retry_at: TsNull;
  requested_by_user_id: string | null;
  requested_by_email: string | null;
  reason: string | null;
  safe_error: string | null;
  created_at: Ts;
}
export interface BookingHoldsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  technician_id: string | null;
  customer_id: string | null;
  service_ids_json: Generated<unknown>;
  start_time: Ts;
  end_time: Ts;
  expires_at: Ts;
  status: Generated<string>;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  booking_session_id: string | null;
  channel: string | null;
  converted_appointment_id: string | null;
  released_at: TsNull;
  release_reason: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  kind: Generated<string>;              // migration 676 (B-22) — slot or draft
  draft_payload: unknown | null;        // migration 676 — the POS New Booking form of a draft
  notes: string | null;                 // migration 676
  draft_title: string | null;           // migration 676
}
export interface BookingVerificationPlatformPolicyTable {
  id: Generated<string>;
  tenant_id: string | null;
  module_enabled: Generated<boolean>;
  emergency_disabled: Generated<boolean>;
  required_for_tenant: Generated<boolean>;
  blocked_for_tenant: Generated<boolean>;
  reason: string | null;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  bypass_blocked: Generated<boolean>;   // migration 521
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BookingVerificationSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  booking_session_id: string;
  booking_hold_id: string | null;
  customer_id: string | null;
  phone_hash: string;
  phone_mask: string;
  channel: string;
  provider: Generated<string>;
  provider_service_sid: string | null;
  provider_verification_sid: string | null;
  status: Generated<string>;
  attempt_count: Generated<number>;
  resend_count: Generated<number>;
  expires_at: Ts;
  verified_at: TsNull;
  last_sent_at: TsNull;
  failure_reason: string | null;
  policy_version: string | null;
  policy_reason: string | null;
  tenant_config_version: number | null;
  branch_config_version: number | null;
  provider_config_version: number | null;
  correlation_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  request_ip: string | null;
  device_id: string | null;
  consumed_at: TsNull;   // migration 521 (a proof is consumed by one appointment)
  consumed_appointment_id: string | null;
  delivered_at: TsNull;
  override_by_user_id: string | null;
  override_at: TsNull;
  override_reason: string | null;
  override_contact_method: string | null;
  code_hash: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BookingVerificationSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  enabled: boolean | null;
  channel_online: Generated<boolean>;
  channel_customer_app: Generated<boolean>;
  channel_ai_receptionist: Generated<boolean>;
  channel_kiosk: Generated<boolean>;
  channel_front_desk: Generated<boolean>;
  channel_walk_in: Generated<boolean>;
  verify_every_booking: Generated<boolean>;
  reverify_after_seconds: Generated<number>;
  reverify_on_group_booking: Generated<boolean>;
  reverify_on_deposit: Generated<boolean>;
  reverify_on_high_value: Generated<boolean>;
  high_value_threshold_cents: number | null;
  hold_seconds: Generated<number>;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BookingVerificationUsageDailyTable {
  id: Generated<string>;
  tenant_id: string;
  usage_date: ColumnType<string, string, string>;
  sent_count: Generated<number>;
  verified_count: Generated<number>;
  failed_count: Generated<number>;
  expired_count: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BookingVerifiedPhonesTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string | null;
  phone_hash: string;
  phone_mask: string;
  provider: string;
  channel: string | null;
  verified_at: Ts;
  expires_at: TsNull;
  last_booking_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  revoked_at: Date | null;
  revoked_reason: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface BusinessCategoriesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sort_order: Generated<number>;
  active: Generated<boolean>;
  is_default: Generated<boolean>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface CampaignComplianceFlagsTable {
  id: Generated<string>;
  subject_type: string;
  subject_id: string;
  subject_name: string | null;
  tenant_id: string | null;
  flag_type: string;
  severity: Generated<string>;
  status: Generated<string>;
  action_taken: string | null;
  detail: string | null;
  reason: string | null;
  raised_by_user_id: string | null;
  resolved_by_user_id: string | null;
  created_at: Ts;
  resolved_at: TsNull;
}
export interface CampaignDeliveryFailuresTable {
  id: Generated<string>;
  subject_type: string;
  subject_id: string;
  tenant_id: string | null;
  channel: string | null;
  provider: string | null;
  failure_category: string;
  masked_destination: string | null;
  provider_response: string | null;
  attempt_count: Generated<number>;
  retryable: Generated<boolean>;
  resolution_status: Generated<string>;
  first_failure_at: Ts;
  last_attempt_at: Ts;
}
export interface CampaignDeliveryRollupsTable {
  id: Generated<string>;
  subject_type: string;
  subject_id: string;
  tenant_id: string | null;
  attempted: Generated<number>;
  delivered: Generated<number>;
  opted_out: Generated<number>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CampaignLimitsTable {
  id: Generated<string>;
  max_sends_per_day: number | null;
  max_campaigns_per_day: number | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  min_hours_between: number | null;
  active: Generated<boolean>;
  updated_by_user_id: string | null;
  created_at: Ts;
}
export interface CampaignMetricSnapshotsTable {
  id: Generated<string>;
  snapshot_date: ColumnType<string, string, string>;
  attempted: Generated<number>;
  delivered: Generated<number>;
  opened: Generated<number>;
  clicked: Generated<number>;
  created_at: Ts;
}
export interface CampaignTemplateVersionsTable {
  id: Generated<string>;
  template_id: string;
  version: number;
  subject: string | null;
  body: string | null;
  channel: string | null;
  notes: string | null;
  published: Generated<boolean>;
  created_by_user_id: string | null;
  created_at: Ts;
}
export interface CampaignTemplatesTable {
  id: Generated<string>;
  name: string;
  campaign_type: Generated<string>;
  channel: Generated<string>;
  subject: string | null;
  body: string | null;
  sms_content: string | null;
  push_title: string | null;
  push_content: string | null;
  suggested_audience: string | null;
  suggested_offer: string | null;
  compliance_note: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface CheckoutSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  credit_card_surcharge_enabled: Generated<boolean>;
  credit_card_surcharge_percent: Generated<number>;
  surcharge_label: Generated<string>;
  tax_rate_percent: Generated<number>;
  cash_discount_enabled: Generated<boolean>;
  default_tip_percents_json: Generated<string>;
  customer_display_pay_button_enabled: Generated<boolean>;
  max_tip_percent: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CommunicationProvidersTable {
  id: Generated<string>;
  name: string;
  channel: string;
  region: string | null;
  account_reference: string | null;
  api_endpoint: string | null;
  webhook_endpoint: string | null;
  webhook_signing_status: Generated<string>;
  priority: Generated<number>;
  failover_priority: number | null;
  rate_limit: number | null;
  monthly_limit: number | null;
  status: Generated<string>;
  credential_enc: string | null;
  credential_last4: string | null;
  last_successful_at: TsNull;
  last_health_check_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface CommunityAppealsTable { id: Generated<string>; post_id: string | null; comment_id: string | null; appellant_tenant_id: string; appellant_user_id: string; subject: string; reason: string; original_decision: string | null; original_decider_user_id: string | null; status: Generated<string>; decided_by_user_id: string | null; decision_note: string | null; moderation_case_id: string | null; created_at: Generated<Ts>; decided_at: Ts | null; }
export interface CommunityCommentsTable { id: Generated<string>; post_id: string; tenant_id: string; visibility: Generated<string>; redacted_body: string; created_by_user_id: string; created_at: Generated<Ts>; parent_id: string | null; depth: Generated<number>; version: Generated<number>; edited_at: Ts | null; removed_reason: string | null; removed_by_user_id: string | null; removed_at: Ts | null; author_label: string | null; privacy_scan_flags: Generated<unknown>; report_count: Generated<number>; }
export interface CommunityDisputesTable { id: Generated<string>; post_id: string; raised_by_tenant_id: string | null; raised_by_kind: Generated<string>; reason: string; status: Generated<string>; resolution_note: string | null; created_at: Generated<Ts>; resolved_at: Ts | null; raised_by_user_id: string | null; case_id: string | null; decided_by_user_id: string | null; }
export interface CommunityEvidenceTable { id: Generated<string>; post_id: string | null; incident_id: string | null; tenant_id: string; storage_key: string; mime_type: string | null; size_bytes: number | null; scan_status: Generated<string>; redaction_status: Generated<string>; uploaded_by_user_id: string; created_at: Generated<Ts>; upload_status: Generated<string>; sha256: string | null; redacted_storage_key: string | null; scanned_at: Ts | null; scan_detail: string | null; uploaded_at: Ts | null; removed_at: Ts | null; }
export interface CommunityFollowsTable { id: Generated<string>; tenant_id: string; category: string | null; region: string | null; created_at: Generated<Ts>; user_id: string | null; severity_min: string | null; channels: Generated<unknown>; }
export interface CommunityModerationActionsTable { id: Generated<string>; case_id: string; action: string; actor_user_id: string; detail: Generated<unknown>; created_at: Generated<Ts>; post_id: string | null; comment_id: string | null; target_tenant_id: string | null; reason: string | null; }
export interface CommunityModerationCasesTable { id: Generated<string>; post_id: string | null; incident_id: string | null; opened_by_user_id: string; reason: string; status: Generated<string>; created_at: Generated<Ts>; closed_at: Ts | null; target_tenant_id: string | null; comment_id: string | null; kind: Generated<string>; priority: Generated<string>; assigned_to_user_id: string | null; resolution_note: string | null; updated_at: Generated<Ts>; }
export interface CommunityPostVersionsTable { id: Generated<string>; post_id: string; version: number; title: string | null; redacted_body: string | null; status: string | null; edited_by_user_id: string | null; created_at: Generated<Ts>; change_note: string | null; snapshot: unknown | null; }
export interface CommunityPostsTable { id: Generated<string>; origin_tenant_id: string; origin_branch_id: string | null; classification: Generated<string>; visibility: Generated<string>; status: Generated<string>; category: string; severity: Generated<string>; region: string | null; title: string; redacted_body: string; privacy_scan_flags: Generated<unknown>; moderation_required: Generated<boolean>; verification_label: Generated<string>; version: Generated<number>; published_at: Ts | null; created_by_user_id: string; approved_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; incident_date: string | null; scam_method: string | null; channels: Generated<unknown>; recommendation: string | null; tags: Generated<unknown>; payment_processor: string | null; amount_range: string | null; official_reference: string | null; author_display: Generated<string>; author_label: string | null; comment_count: Generated<number>; report_count: Generated<number>; similar_count: Generated<number>; follower_count: Generated<number>; last_activity_at: Ts | null; resolved_at: Ts | null; resolution_note: string | null; comments_locked: Generated<boolean>; removed_reason: string | null; submitted_by_user_id: string | null; merged_into_post_id: string | null; search_document: unknown | null; }
export interface CommunityReportsTable { id: Generated<string>; post_id: string; reporter_tenant_id: string; reason: string; detail: string | null; status: Generated<string>; created_at: Generated<Ts>; reporter_user_id: string | null; case_id: string | null; resolved_by_user_id: string | null; resolved_at: Ts | null; resolution: string | null; }
export interface CommunityRiskFingerprintsTable { id: Generated<string>; post_id: string; indicator_kind: string; fingerprint: string; reliability: Generated<string>; created_at: Generated<Ts>; expires_at: Generated<Ts>; retired_at: Ts | null; retired_reason: string | null; }
export interface CustomerAllergiesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  customer_id: string;
  allergy_notes: string | null;
  sensitivity_notes: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerDeletionRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string;
  reason: string;
  status: Generated<string>;
  requested_by_user_id: string | null;
  approved_by_user_id: string | null;
  executed_by_user_id: string | null;
  reject_reason: string | null;
  retention_checked: Generated<boolean>;
  retention_note: string | null;
  legal_hold_blocked: Generated<boolean>;
  requested_at: Ts;
  approved_at: TsNull;
  executed_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerIdentitiesTable {
  id: Generated<string>;
  normalized_phone: string;
  email: string | null;
  full_name: string | null;
  password_hash: string | null;
  status: Generated<string>;
  phone_verified_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface CustomerIdentityLinksTable {
  id: Generated<string>;
  identity_id: string;
  tenant_id: string;
  user_id: string;
  customer_id: string | null;
  linked_at: Ts;
}
export interface CustomerImportJobsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  source: Generated<string>;
  filename: string | null;
  status: Generated<string>;
  total_rows: Generated<number>;
  valid_rows: Generated<number>;
  invalid_rows: Generated<number>;
  imported_rows: Generated<number>;
  failed_rows: Generated<number>;
  requested_by_user_id: string | null;
  approved_by_user_id: string | null;
  reject_reason: string | null;
  created_at: Ts;
  approved_at: TsNull;
  completed_at: TsNull;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerImportRowsTable {
  id: Generated<string>;
  job_id: string;
  tenant_id: string;
  row_number: number;
  raw_json: Generated<unknown>;
  dedup_key: string;
  status: Generated<string>;
  error: string | null;
  customer_id: string | null;
  attempts: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerLegalHoldsTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string | null;
  branch_id: string | null;
  matter_ref: string;
  reason: string;
  scope: Generated<string>;
  status: Generated<string>;
  applied_by_user_id: string | null;
  approved_by_user_id: string | null;
  applied_at: Ts;
  effective_at: Ts;
  review_at: TsNull;
  released_by_user_id: string | null;
  released_at: TsNull;
  release_reason: string | null;
  internal_notes: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerMergeLogsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  source_customer_id: string;
  target_customer_id: string;
  merged_by_user_id: string | null;
  merge_summary_json: Generated<unknown>;
  created_at: Ts;
}
export interface CustomerPhoneUpdateSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string;
  proposed_phone: string;
  proposed_phone_hash: string;
  proposed_phone_mask: string;
  previous_phone_id: string | null;
  state: Generated<string>;
  update_source: string;
  requested_by_user_id: string | null;
  requested_by_role: string | null;
  change_reason: string | null;
  verification_session_id: string | null;
  duplicate_outcome: string | null;
  duplicate_resolved_by: string | null;
  customer_version: number | null;
  idempotency_key: string | null;
  correlation_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  completed_at: TsNull;
  new_phone_id: string | null;
  expires_at: Date | null;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  display_requested_at: Date | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerPhonesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string;
  normalized_phone: string;
  phone_display: string | null;
  phone_mask: string;
  country_code: string | null;
  phone_hash: string;
  status: Generated<string>;
  verification_provider: string | null;
  verified_at: TsNull;
  added_by_user_id: string | null;
  update_source: string | null;
  change_reason: string | null;
  effective_from: Ts;
  replaced_by_phone_id: string | null;
  risk_status: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerPrivacyRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string | null;
  request_type: string;
  status: Generated<string>;
  requester_name: string | null;
  requester_contact: string | null;
  scope: string | null;
  legal_basis: string | null;
  assigned_to_user_id: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  action_history: Generated<unknown>;
  due_at: TsNull;
  completed_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DataRetentionPurgeRunsTable {
  id: Generated<string>;
  data_class: string;
  mode: Generated<string>;
  cutoff: TsNull;
  eligible_count: Generated<number>;
  net_count: Generated<number>;
  actor_user_id: string | null;
  occurred_at: Ts;
  error: string | null; triggered_by: string | null; table_name: string | null; held_count: Generated<number>; duration_ms: number | null; action: string | null; batches: Generated<number>;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DataRetentionRulesTable {
  id: Generated<string>;
  data_class: string;
  version: Generated<number>;
  status: Generated<string>;
  retention_days: number;
  action: Generated<string>;
  scope: Generated<string>;
  target: string | null;
  description: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface DealAnalyticsEventsTable {
  id: Generated<string>;
  deal_id: string;
  tenant_id: string;
  customer_id: string | null;
  event_type: string;
  created_at: Ts;
}
export interface DealApprovalsTable {
  id: Generated<string>;
  deal_id: string;
  tenant_id: string;
  approver_user_id: string | null;
  decision: string;
  reason: string | null;
  deal_version: number;
  terms_snapshot: unknown | null;
  created_at: Ts;
}
export interface DealCodeLookupFailuresTable {
  id: Generated<number>;
  tenant_id: string;
  actor_key: string;
  created_at: Ts;
}
export interface DealCouponBatchesTable {
  id: Generated<string>;
  tenant_id: string;
  deal_id: string;
  quantity: number;
  prefix: string | null;
  single_use: Generated<boolean>;
  purpose: Generated<string>;
  campaign_id: string | null;
  expires_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
}
export interface DealCouponCodesTable {
  id: Generated<string>;
  tenant_id: string;
  deal_id: string;
  batch_id: string | null;
  code_hash: string;
  code_hint: string;
  single_use: Generated<boolean>;
  max_uses: number | null;
  use_count: Generated<number>;
  status: Generated<string>;
  customer_id: string | null;
  expires_at: TsNull;
  revoked_at: TsNull;
  revoked_reason: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DealDailyStatsTable {
  deal_id: string;
  tenant_id: string;
  day: ColumnType<string, string, string>;
  views: Generated<number>;
  saves: Generated<number>;
  booking_starts: Generated<number>;
  bookings: Generated<number>;
  applications: Generated<number>;
  redemptions: Generated<number>;
  reversals: Generated<number>;
  discounted_cents: Generated<number>;
  reversed_cents: Generated<number>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DealVersionsTable {
  id: Generated<string>;
  deal_id: string;
  tenant_id: string;
  version: number;
  terms: unknown;
  changed_by_user_id: string | null;
  created_at: Ts;
}
export interface PosQueueStatusHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  queue_item_id: string;
  version: number;
  from_status: string | null;
  to_status: string;
  from_technician: string | null;
  to_technician: string | null;
  action: string;
  source: Generated<string>;
  actor_id: string | null;
  reason: string | null;
  created_at: Ts;
  idempotency_key: string | null;
}
export interface QueueAssignmentLocksTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  queue_item_id: string;
  technician_id: string | null;
  reason: string;
  locked_by: string | null;
  expires_at: TsNull;
  released_at: TsNull;
  released_by: string | null;
  release_reason: string | null;
  created_at: Ts;
}
export interface QueueGroupsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  label: string;
  size: number;
  together: Generated<boolean>;
  status: Generated<string>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface QueueServiceAssignmentsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  queue_item_id: string;
  service_id: string;
  technician_id: string | null;
  status: Generated<string>;
  sequence: Generated<number>;
  assigned_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 569 (multi-technician routing)
  version: Generated<number>; timing: Generated<string>; after_service_id: string | null; planned_start_offset_min: number | null;
  source: string | null; tech_queue_ticket_id: string | null; started_at: TsNull; completed_at: TsNull;
}
export interface QueueAssignmentTenantSettingsTable {
  tenant_id: string;
  version: Generated<number>;
  wait_approaching_min: Generated<number>;
  wait_exceeded_min: Generated<number>;
  wait_severe_min: Generated<number>;
  wait_critical_min: Generated<number>;
  stuck_minutes: Generated<number>;
  long_service_factor: Generated<number>;
  congestion_waiting_per_tech: Generated<number>;
  late_grace_min: Generated<number>;
  rotation_policy: Generated<string>;
  auto_enabled: Generated<boolean>;
  auto_killed: Generated<boolean>;
  auto_killed_reason: string | null;
  auto_confidence_floor: Generated<number>;
  auto_max_per_run: Generated<number>;
  auto_delay_seconds: Generated<number>;
  auto_exclusions: Generated<unknown>;
  updated_by: string | null;
  updated_at: Ts;
  assignment_mode: Generated<string>;   // migration 600 (Fair Turn §9) — AUTOMATIC | RECOMMEND_AND_CONFIRM | MANUAL
  turn_policy: Generated<unknown>;      // migration 600 — the salon's turn house rules (turn-core.ts TurnPolicy)
}
export interface QueueAssignmentSettingsVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  version: number;
  settings: unknown;
  change: string;
  reason: string | null;
  changed_by: string | null;
  created_at: Ts;
}
export interface DealRedemptionHoldsTable {
  id: Generated<string>;
  deal_id: string;
  tenant_id: string;
  customer_id: string | null;
  idempotency_key: string;
  status: Generated<string>;
  expires_at: Ts;
  created_at: Ts;
  appointment_id: string | null;
  deal_version: number | null;
  ticket_id: string | null;
  released_reason: string | null;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DealRedemptionsTable {
  id: Generated<string>;
  deal_id: string;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string;
  appointment_id: string | null;
  ticket_id: string | null;
  technician_id: string | null;
  amount_discounted_cents: Generated<number>;
  deal_version: number;
  created_at: Ts;
  status: Generated<string>;
  kind: Generated<string>;
  hold_id: string | null;
  coupon_code_id: string | null;
  line_allocations: unknown | null;
  terms_snapshot: unknown | null;
  applied_by_user_id: string | null;
  applied_at: Ts;
  redeemed_at: TsNull;
  reversed_at: TsNull;
  reversal_reason: string | null;
  reversed_cents: Generated<number>;
  budget_reserved_cents: Generated<number>;
  idempotency_key: string | null;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DealSavesTable {
  deal_id: string;
  customer_id: string | null;
  tenant_id: string;
  created_at: Ts;
  user_id: string | null;
}
export interface DealServicesTable {
  deal_id: string;
  service_id: string;
  tenant_id: string;
}
export interface DealSettingsTable {
  tenant_id: string;
  allow_technician_deals: Generated<string>;
  max_discount_percent: number | null;
  max_fixed_discount_cents: number | null;
  min_service_price_cents: number | null;
  max_active_deals_per_tech: number | null;
  max_redemptions_cap: number | null;
  max_campaign_duration_days: number | null;
  allowed_new_customer: Generated<boolean>;
  allowed_existing_customer: Generated<boolean>;
  allow_stack_loyalty: Generated<boolean>;
  allow_stack_membership: Generated<boolean>;
  editable_after_redemption: Generated<boolean>;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  stacking_policy: Generated<string>;
  price_floor_percent: Generated<number>;
  max_total_discount_percent: number | null;
  deals_enabled: Generated<boolean>;
  platform_disabled: Generated<boolean>;
  platform_disabled_reason: string | null;
  platform_max_active_deals: number | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DealsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  owner_type: string;
  technician_id: string | null;
  title: string;
  short_description: string | null;
  terms: string | null;
  image_url: string | null;
  discount_type: string;
  discount_percent: number | null;
  discount_cents: number | null;
  original_price_cents: number | null;
  final_price_cents: number | null;
  starts_at: TsNull;
  ends_at: TsNull;
  days_of_week: number[] | null;
  valid_from_minute: number | null;
  valid_to_minute: number | null;
  new_customers_only: Generated<boolean>;
  member_only: Generated<boolean>;
  min_spend_cents: number | null;
  booking_lead_minutes: number | null;
  deposit_cents: number | null;
  max_redemptions: number | null;
  max_per_customer: number | null;
  stackable: Generated<boolean>;
  allow_tech_substitution: Generated<boolean>;
  status: Generated<string>;
  created_by_user_id: string | null;
  created_by_technician_id: string | null;
  approved_by_user_id: string | null;
  redemption_count: Generated<number>;
  version: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  kind: Generated<string>;
  rules: Generated<unknown>;
  priority: Generated<number>;
  stack_group: string | null;
  max_discount_cents: number | null;
  budget_cents: number | null;
  budget_reserved_cents: Generated<number>;
  channels: string[] | null;
  requires_code: Generated<boolean>;
  legacy_source: string | null;
  legacy_id: string | null;
  suspended_reason: string | null;
  suspended_by: string | null;
  suspended_at: TsNull;
  published_at: TsNull;
  expired_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DeviceCatalogTable {
  id: Generated<string>;
  device_type: string;
  display_name: string;
  model_count: Generated<number>;
  availability: Generated<string>;
  sort_order: Generated<number>;
  created_at: Ts;
}
export interface DeviceMaintenanceTable {
  id: Generated<string>;
  ticket_reference: string;
  device_id: string | null;
  device_label: string | null;
  tenant_id: string | null;
  branch_name: string | null;
  reason: string | null;
  status: Generated<string>;
  started_at: TsNull;
  expected_return_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DeviceSecurityAlertsTable {
  id: Generated<string>;
  device_id: string | null;
  device_label: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  issue: string;
  severity: Generated<string>;
  status: Generated<string>;
  last_action: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DeviceSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  device_name: string | null;
  device_type: string | null;
  trusted_device: Generated<boolean>;
  last_seen_at: TsNull;
  created_at: Ts;
}
export interface DeviceShipmentsTable {
  id: Generated<string>;
  shipment_reference: string;
  tenant_id: string | null;
  destination_branch: string | null;
  device_label: string | null;
  device_type: string | null;
  status: Generated<string>;
  carrier: string | null;
  tracking_masked: string | null;
  eta_at: TsNull;
  delivered_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface DisputeEvidenceTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  branch_id: string | null;
  evidence_type: string;
  file_name: string | null;
  storage_ref: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  file_hash: string | null;
  scan_status: Generated<string>;
  review_status: Generated<string>;
  included_in_submission: Generated<boolean>;
  description: string | null;
  source: string | null;
  uploaded_by: string | null;
  created_at: Ts;
}
export interface DisputeFundsEventsTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  kind: string;
  amount_cents: Generated<number>;
  currency: Generated<string>;
  settlement_id: string | null;
  effective_at: TsNull;
  source: Generated<string>;
  created_at: Ts;
}
export interface DisputeOutcomesTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  result: string;
  amount_won_cents: Generated<number>;
  amount_lost_cents: Generated<number>;
  funds_recovered_cents: Generated<number>;
  processor_fee_cents: Generated<number>;
  decision_reason: string | null;
  is_manual_override: Generated<boolean>;
  override_reason: string | null;
  original_processor_decision: string | null;
  recorded_by: string | null;
  decided_at: TsNull;
  created_at: Ts;
}
export interface DisputeStatusEventsTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  from_status: string | null;
  to_status: string;
  source: Generated<string>;
  reason: string | null;
  actor_user_id: string | null;
  created_at: Ts;
}
export interface DisputeSubmissionsTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  idempotency_key: string;
  processor_type: string | null;
  processor_ref: string | null;
  manifest_json: unknown | null;
  result: Generated<string>;
  safe_error: string | null;
  submitted_by: string | null;
  created_at: Ts;
}
export interface DisputeTenantNotificationsTable {
  id: Generated<string>;
  chargeback_id: string;
  tenant_id: string;
  branch_id: string | null;
  channel: Generated<string>;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  delivery_status: Generated<string>;
  idempotency_key: string | null;
  sent_by: string | null;
  created_at: Ts;
}
export interface DuplicateCheckinCandidatesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  customer_ref: string | null;
  appointment_id: string | null;
  device_id: string | null;
  check_in_method: string | null;
  match_reasons: Generated<unknown>;
  confidence: Generated<number>;
  review_state: Generated<string>;
  resolution: string | null;
  reviewer_user_id: string | null;
  detected_at: Ts;
  created_at: Ts;
}
export interface EmergencyLockdownEventsTable {
  id: Generated<string>;
  lockdown_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  note: string | null;
  occurred_at: Ts;
}
export interface EmergencyLockdownsTable {
  id: Generated<string>;
  lockdown_ref: string;
  scope: string;
  target: string | null;
  reason: string;
  status: Generated<string>;
  step_up_verified: Generated<boolean>;
  affected_estimate: number | null;
  affected_sessions: number | null;
  correlation_id: string | null;
  initiated_by: string | null;
  confirmed_by: string | null;
  activated_at: TsNull;
  lifted_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface FeeSchedulesTable {
  id: Generated<string>;
  tenant_id: string;
  processor_type: string;
  label: string;
  version: Generated<number>;
  effective_from: ColumnType<string, string, string>;
  percentage_bps: Generated<number>;
  per_transaction_cents: Generated<number>;
  batch_cents: Generated<number>;
  monthly_cents: Generated<number>;
  notes: string | null;
  created_at: Ts;
}
export interface ForecastPointsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  run_id: string;
  domain: string;
  entity_id: string | null;
  model: string;
  model_version: Generated<string>;
  horizon_step: number;
  target_date: ColumnType<string, string, string>;
  point_value: number;
  lower_value: number;
  upper_value: number;
  interval_level: Generated<number>;
  confidence: string | null;
  data_quality: string | null;
  backtest_wape: number | null;
  realized_value: number | null;
  abs_error: number | null;
  within_interval: boolean | null;
  realized_at: TsNull;
  generated_at: Ts;
}
export interface GrandfatheredAssignmentsTable {
  id: Generated<string>;
  tenant_id: string;
  plan_version_id: string | null;
  locked_monthly_price_cents: number | null;
  effective_from: Ts;
  end_date: TsNull;
  migration_target_plan_code: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwarePackageDevicesTable {
  id: Generated<string>;
  hardware_package_id: string;
  tenant_id: string | null;
  device_type: string;
  device_name: string;
  serial_number: string | null;
  asset_tag: string | null;
  quantity: Generated<number>;
  status: Generated<string>;
  warranty_start_at: TsNull;
  warranty_end_at: TsNull;
  assigned_at: Ts;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface HardwarePackageNotesTable {
  id: Generated<string>;
  hardware_package_id: string;
  actor_user_id: string | null;
  note: string;
  is_internal: Generated<boolean>;
  created_at: Ts;
}
export interface HelpArticleFeedbackTable {
  id: Generated<string>;
  article_id: string;
  tenant_id: string;
  user_id: string | null;
  helpful: boolean;
  comment: string | null;
  created_at: Ts;
}
export interface HelpArticleVersionsTable {
  id: Generated<string>;
  article_id: string;
  version: number;
  title: string;
  summary: string | null;
  body: string | null;
  status: string | null;
  changed_by: string | null;
  created_at: Ts;
}
export interface HelpArticleViewsTable {
  id: Generated<string>;
  article_id: string;
  tenant_id: string;
  user_id: string;
  viewed_on: ColumnType<string, string, string>;
  created_at: Ts;
}
export interface HelpArticlesTable {
  id: Generated<string>;
  category_id: string | null;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  status: Generated<string>;
  roles: Generated<string[]>;
  plans: Generated<string[]>;
  platforms: Generated<string[]>;
  app_version: string | null;
  author: string | null;
  reviewer: string | null;
  reading_minutes: Generated<number>;
  view_count: Generated<number>;
  last_reviewed_at: TsNull;
  last_updated_at: Ts;
  created_at: Ts;
}
export interface HelpCategoriesTable {
  id: Generated<string>;
  slug: string;
  label: string;
  description: string | null;
  sort_order: Generated<number>;
  created_at: Ts;
}
export interface IntegrationCircuitBreakersTable {
  connection_id: string;
  state: Generated<string>;
  failure_count: Generated<number>;
  success_count: Generated<number>;
  failure_threshold: Generated<number>;
  cooldown_seconds: Generated<number>;
  opened_at: TsNull;
  half_opened_at: TsNull;
  last_failure_at: TsNull;
  last_state_change_at: Ts;
  updated_at: Ts;
}
export interface IntegrationOauthStatesTable {
  id: Generated<string>;
  connection_id: string | null;
  provider_key: string;
  state: string;
  code_verifier_enc: string | null;
  redirect_uri: string;
  requested_scopes: Generated<string[]>;
  status: Generated<string>;
  created_by_user_id: string | null;
  created_at: Ts;
  expires_at: Ts;
  consumed_at: TsNull;
}
export interface IntegrationRateLimitsTable {
  id: Generated<string>;
  scope_type: string;
  scope_key: string;
  window_seconds: Generated<number>;
  limit_per_window: Generated<number>;
  window_start: Ts;
  count: Generated<number>;
  retry_after_until: TsNull;
  updated_at: Ts;
}
export interface IntegrationSyncCursorsTable {
  connection_id: string;
  sync_type: string;
  cursor_value: string | null;
  updated_at: Ts;
}
export interface IntegrationSyncJobsTable {
  id: Generated<string>;
  connection_id: string;
  tenant_id: string | null;
  branch_id: string | null;
  sync_type: Generated<string>;
  status: Generated<string>;
  cursor_before: string | null;
  cursor_after: string | null;
  items_read: Generated<number>;
  items_created: Generated<number>;
  items_updated: Generated<number>;
  items_skipped: Generated<number>;
  items_failed: Generated<number>;
  idempotency_key: string | null;
  retry_count: Generated<number>;
  max_attempts: Generated<number>;
  failed_record_ids: Generated<string[]>;
  error_category: string | null;
  error_message: string | null;
  correlation_id: string | null;
  next_attempt_at: TsNull;
  started_at: TsNull;
  completed_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface IntegrationSyncRecordsTable {
  id: Generated<string>;
  connection_id: string;
  tenant_id: string | null;
  provider_record_id: string;
  last_sync_job_id: string | null;
  action: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface IntegrationWebhookEventsTable {
  id: Generated<string>;
  connection_id: string;
  tenant_id: string | null;
  provider_event_id: string;
  event_type: string | null;
  signature_result: Generated<string>;
  replay_result: Generated<string>;
  status: Generated<string>;
  attempt_count: Generated<number>;
  max_attempts: Generated<number>;
  redacted_summary: unknown | null;
  correlation_id: string | null;
  error_category: string | null;
  error_message: string | null;
  next_attempt_at: TsNull;
  received_at: Ts;
  processed_at: TsNull;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  status: string;
  on_hand: number;
  created_at: Ts;
  acknowledged_at: TsNull;
  acknowledged_by_user_id: string | null;
  resolved_at: TsNull;
}
export interface InventoryBrandsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  code: string | null;
  website: string | null;
  notes: string | null;
  active: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryCategoriesTable {
  id: Generated<string>;
  tenant_id: string;
  parent_category_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  display_color: string | null;
  sort_order: Generated<number>;
  tracking_mode: Generated<string>;
  active: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryCountLinesTable {
  id: Generated<string>;
  tenant_id: string;
  count_id: string;
  product_id: string;
  expected_qty: Generated<number>;
  counted_qty: number | null;
  is_counted: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryCountsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  count_number: string | null;
  status: Generated<string>;
  scope_type: Generated<string>;
  scope_id: string | null;
  notes: string | null;
  line_count: Generated<number>;
  counted_count: Generated<number>;
  variance_units: Generated<number>;
  started_by_user_id: string | null;
  reconciled_by_user_id: string | null;
  reconciled_at: TsNull;
  cancelled_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryLocationStockTable {
  version: Generated<number>;   // Phase 10 (539): optimistic concurrency, bumped by trigger on every update
  reorder_level_override: number | null; reorder_quantity_override: number | null; preferred_vendor_id_override: string | null; lead_time_days_override: number | null; critical_level_override: number | null;   // migration 476
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  quantity_on_hand: Generated<number>;
  quantity_available: Generated<number>;
  quantity_reserved: Generated<number>;
  quantity_unopened: Generated<number>;
  quantity_open: Generated<number>;
  quantity_low: Generated<number>;
  quantity_empty: Generated<number>;
  quantity_damaged: Generated<number>;
  average_cost_cents: number | null;
  last_counted_at: TsNull;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryProductsTable {
  lead_time_days: number | null;   // migration 476
  id: Generated<string>;
  tenant_id: string;
  category_id: string | null;
  brand_id: string | null;
  preferred_vendor_id: string | null;
  name: string;
  product_line: string | null;
  color_name: string | null;
  color_number: string | null;
  color_family: string | null;
  finish: string | null;
  sku: string | null;
  barcode: string | null;
  upc: string | null;
  unit_type: Generated<string>;
  size_value: number | null;
  size_unit: string | null;
  tracking_mode: Generated<string>;
  cost_cents: number | null;
  retail_price_cents: number | null;
  reorder_level: Generated<number>;
  reorder_quantity: Generated<number>;
  maximum_stock: number | null;
  track_expiration: Generated<boolean>;
  is_retail: Generated<boolean>;
  is_service: Generated<boolean>;
  allow_negative_stock: Generated<boolean>;
  active: Generated<boolean>;
  archived_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  critical_level: number | null;
  image_url: string | null;
  button_color: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryServiceRecipeLinesTable {
  id: Generated<string>;
  tenant_id: string;
  recipe_id: string;
  product_id: string;
  expected_quantity: Generated<number>;
  consumption_unit: string;
  waste_allowance_pct: Generated<number>;
  required: Generated<boolean>;
  sort_order: Generated<number>;
}
export interface InventoryServiceRecipesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  service_id: string;
  version: Generated<number>;
  status: Generated<string>;
  source: Generated<string>;
  effective_date: ColumnType<string | null, string | null, string | null>;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryStockMovementsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  inventory_unit_id: string | null;
  movement_type: string;
  quantity_before: number | null;
  quantity_change: number | null;
  quantity_after: number | null;
  unit: string | null;
  related_type: string | null;
  related_id: string | null;
  actor_user_id: string | null;
  reason: string | null;
  metadata_json: unknown | null;
  created_at: Ts;
}
export interface InventoryTechnicianReportsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  inventory_unit_id: string | null;
  technician_user_id: string;
  service_ticket_id: string | null;
  report_type: string;
  reported_quantity: number | null;
  estimated_remaining_percent: number | null;
  photo_url: string | null;
  note: string | null;
  status: Generated<string>;
  reviewed_by_user_id: string | null;
  reviewed_at: TsNull;
  resolution_note: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryTransferLinesTable {
  id: Generated<string>;
  tenant_id: string;
  transfer_id: string;
  product_id: string;
  quantity_requested: Generated<number>;
  quantity_moved: Generated<number>;
  created_at: Ts;
}
export interface InventoryTransfersTable {
  id: Generated<string>;
  tenant_id: string;
  from_branch_id: string;
  to_branch_id: string;
  transfer_number: string | null;
  status: Generated<string>;
  notes: string | null;
  item_count: Generated<number>;
  unit_count: Generated<number>;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InventoryUnitsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  internal_barcode: string | null;
  lot_number: string | null;
  expiration_date: ColumnType<string | null, string | null, string | null>;
  status: Generated<string>;
  estimated_remaining_percent: number | null;
  received_at: TsNull;
  opened_at: TsNull;
  opened_by_user_id: string | null;
  emptied_at: TsNull;
  emptied_by_user_id: string | null;
  storage_location: string | null;
  notes: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  sold_ticket_id: string | null;   // migration 667 (B-17): the ticket a retail sale took this unit for
  sold_line_id: string | null;     // migration 667 (B-17): … and the ticket line
}
export interface InventoryVendorsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  account_number: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
  active: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  trade_name: string | null;
  supplier_code: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  notes: string | null;
  is_preferred: Generated<boolean>;
  minimum_order_cents: number | null;
  currency: Generated<string>;
  deactivated_at: TsNull;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface IpBlockRulesTable {
  id: Generated<string>;
  target: string;
  block_kind: Generated<string>;
  ip_version: Generated<number>;
  is_allowlist: Generated<boolean>;
  threat_type: string | null;
  source: string | null;
  reason: string | null;
  country: string | null;
  tenant_id: string | null;
  status: Generated<string>;
  review_status: Generated<string>;
  blocked_at: Ts;
  expires_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface LeadActivitiesTable {
  id: Generated<string>;
  lead_id: string;
  activity_type: string;
  title: string | null;
  message: string | null;
  created_by_user_id: string | null;
  metadata_json: unknown | null;
  created_at: Ts;
}
export interface LeadFollowUpsTable {
  id: Generated<string>;
  lead_id: string;
  assigned_to_user_id: string | null;
  due_at: TsNull;
  completed_at: TsNull;
  status: Generated<string>;
  notes: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface LegalDocumentAcceptancesTable {
  id: Generated<string>;
  doc_type: string;
  version_id: string;
  version: string;
  subject_type: Generated<string>;
  subject_id: string;
  decision: Generated<string>;
  accepted_at: Ts;
}
export interface LegalDocumentVersionsTable {
  id: Generated<string>;
  doc_type: string;
  version: string;
  title: string;
  content: Generated<string>;
  summary: string | null;
  status: Generated<string>;
  required_acceptance: Generated<boolean>;
  effective_date: TsNull;
  published_at: TsNull;
  published_by: string | null;
  created_by: string | null;
  superseded_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface LoginAttemptsTable {
  id: Generated<string>;
  tenant_id: string | null;
  identifier: string | null;
  ip_address: string | null;
  success: boolean;
  reason: string | null;
  created_at: Ts;
}
export interface LoyaltyCalculationCorrectionsTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string | null;
  discrepancy_type: string;
  expected_points: Generated<number>;
  actual_points: Generated<number>;
  difference_points: Generated<number>;
  status: Generated<string>;
  proposed_adjustment_points: number | null;
  root_cause: string | null;
  reason: string | null;
  bucket_key: string;
  detail_json: Generated<unknown>;
  reviewed_by: string | null;
  detected_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface LoyaltyPlatformConfigTable {
  scope: Generated<string>;
  config: Generated<unknown>;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface LoyaltySuspiciousCasesTable {
  id: Generated<string>;
  tenant_id: string;
  customer_id: string | null;
  signal_type: string;
  severity: Generated<string>;
  status: Generated<string>;
  bucket_key: string;
  detail_json: Generated<unknown>;
  reviewed_by: string | null;
  detected_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface LoyaltyTemplatesTable {
  id: Generated<string>;
  name: string;
  program_type: Generated<string>;
  structure_json: Generated<unknown>;
  active: Generated<boolean>;
  created_by: string | null;
  created_at: Ts;
}
export interface MaintenanceEventsTable {
  id: Generated<string>;
  title: string;
  reason: string | null;
  status: Generated<string>;
  scope: Generated<string>;
  mode: Generated<string>;
  starts_at: TsNull;
  ends_at: TsNull;
  duration_minutes: number | null;
  timezone: string | null;
  read_only: Generated<boolean>;
  affected_services: Generated<unknown>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  completed_at: TsNull;
}
export interface MaintenanceStateTable {
  id: Generated<string>;
  active: Generated<boolean>;
  mode: Generated<string>;
  message: Generated<string>;
  expected_restoration: TsNull;
  allowed_roles: Generated<unknown>;
  announcement_banner: Generated<string>;
  active_event_id: string | null;
  enabled_by: string | null;
  enabled_at: TsNull;
  updated_at: Ts;
}
export interface MembershipKpiSnapshotsTable {
  id: Generated<string>;
  snapshot_date: ColumnType<string, string, string>;
  kpi_key: string;
  value_num: Generated<number>;
  created_at: Ts;
}
export interface MembershipPlatformConfigTable {
  id: Generated<string>;
  singleton: Generated<boolean>;
  enabled_globally: Generated<boolean>;
  plan_gating: Generated<unknown>;
  limits: Generated<unknown>;
  rules: Generated<unknown>;
  updated_by_user_id: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface MembershipTemplatesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  product_type: Generated<string>;
  billing_interval: Generated<string>;
  interval_count: Generated<number>;
  price_cents: Generated<number>;
  trial_days: Generated<number>;
  benefits: Generated<unknown>;
  status: Generated<string>;
  version: Generated<number>;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface MerchantAccountAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  merchant_id: string | null;
  alert_type: string;
  severity: Generated<string>;
  summary: string;
  status: Generated<string>;
  assigned_reviewer_user_id: string | null;
  assigned_reviewer_name: string | null;
  created_at: Ts;
  updated_at: Ts;
  resolved_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MerchantFundingProfilesTable {
  id: Generated<string>;
  tenant_id: string;
  funding_schedule: Generated<string>;
  bank_verification_status: Generated<string>;
  verification_method: string | null;
  verified_at: TsNull;
  funding_hold: Generated<boolean>;
  bank_name: string | null;
  account_type: string | null;
  account_last4: string | null;
  routing_last4: string | null;
  bank_account_enc: string | null;
  routing_number_enc: string | null;
  has_funding_issue: Generated<boolean>;
  funding_issue_type: string | null;
  effective_at: Ts;
  superseded_at: TsNull;
  created_by: string | null;
  created_at: Ts;
}
export interface MerchantPricingPlansTable {
  id: Generated<string>;
  key: string;
  name: string;
  description: string | null;
  sort: Generated<number>;
  created_at: Ts;
}
export interface MerchantRateSchedulesTable {
  id: Generated<string>;
  tenant_id: string;
  pricing_plan_id: string | null;
  percentage_basis_points: number;
  per_txn_fee_minor: Generated<number>;
  monthly_fee_minor: Generated<number>;
  refund_fee_minor: Generated<number>;
  chargeback_fee_minor: Generated<number>;
  currency: Generated<string>;
  effective_at: Ts;
  expires_at: TsNull;
  status: Generated<string>;
  change_reason: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface MerchantRiskReviewsTable {
  id: Generated<string>;
  tenant_id: string;
  merchant_account_id: string | null;
  risk_level: Generated<string>;
  risk_reason: string | null;
  supporting_metrics: unknown | null;
  recommended_action: string | null;
  reviewer_user_id: string | null;
  reviewed_at: Ts;
  next_review_at: TsNull;
  created_at: Ts;
}
export interface MessageTemplateVersionsTable {
  id: Generated<string>;
  template_id: string;
  version: number;
  subject: string | null;
  body: string;
  push_title: string | null;
  placeholders: Generated<string[]>;
  status: Generated<string>;
  created_by: string | null;
  published_at: TsNull;
  created_at: Ts;
}
export interface MessageTemplatesTable {
  id: Generated<string>;
  tenant_id: string | null;
  name: string;
  channel: string;
  category: string | null;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MobilePayDevicesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  device_id: string;
  label: string | null;
  platform: Generated<string>;
  os_version: string | null;
  app_version: string | null;
  tap_to_pay_capable: Generated<boolean>;
  status: Generated<string>;
  registered_by: string | null;
  approved_by: string | null;
  approved_at: TsNull;
  last_seen_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  bound_user_id: string | null; revoked_at: TsNull; revoked_by: string | null; revoke_reason: string | null;   // migration 660 (device trust — user binding + revocation)
  last_payment_at: TsNull; last_error_at: TsNull; last_error_code: string | null; risk_flags: unknown | null;   // migration 660
  public_key: string | null; key_alg: string | null; key_fingerprint: string | null; key_registered_at: TsNull; attestation_status: Generated<string>; paired_via: string | null;   // migration 687 (device key)
  shared: Generated<boolean>;   // migration 688 (shared salon phone)
}
export interface MobilePayDeviceBranchesTable { tenant_id: string; device_id: string; branch_id: string; created_by: string | null; created_at: Ts }   // migration 687
export interface MobilePayDeviceNoncesTable { tenant_id: string; device_id: string; nonce: string; created_at: Ts }   // migration 687
export interface PaymentDevicePairingsTable {   // migration 687 (+ 688 shared)
  id: Generated<string>; tenant_id: string; branch_id: string; purpose: Generated<string>; code_hash: string; label: string | null;
  created_by: string; created_at: Ts; expires_at: Ts; used_at: TsNull; used_by_user_id: string | null; used_device_id: string | null; shared: Generated<boolean>;
}
export interface NotificationsTable {
  id: Generated<string>;
  tenant_id: string;
  channel: string;
  to_address: string;
  subject: string | null;
  body: string;
  customer_id: string | null;
  status: string;
  provider_id: string | null;
  failure_reason: string | null;
  created_at: Ts;
  delivered_at: TsNull;
  // migration 640 (wave 3 PAYI §77 / §87 / §173): segment accounting + the provider's own status / error / cost
  segment_count: number | null;
  provider_status: string | null;
  provider_error_code: string | null;
  provider_cost_micros: number | null;
  // migration 678 (mandate §65): which sending path carried the text, and its From / Messaging Service
  sender_route: string | null;
  sender_from: string | null;
  purpose: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
  // migration 741 (Customer Notifications): branch, what produced it, and the attempt this row re-sends
  branch_id: string | null;
  source_type: string | null;
  source_id: string | null;
  retry_of_notification_id: string | null;
}
export interface OverageChargesTable {
  id: Generated<string>;
  tenant_id: string;
  metric: string;
  billing_period: string;
  included_qty: number;
  used_qty: number;
  overage_qty: number;
  unit_price_cents: number;
  amount_cents: number;
  status: Generated<string>;
  computed_at: Ts;
}
export interface OverageRulesTable {
  id: Generated<string>;
  metric: string;
  unit_price_cents: number;
  grace_amount: Generated<number>;
  warning_threshold_pct: Generated<number>;
  hard_stop_threshold_pct: number | null;
  billing_period: Generated<string>;
  rounding: Generated<string>;
  min_charge_cents: Generated<number>;
  max_charge_cents: number | null;
  effective_from: Ts;
  plan_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface OverviewMonthlySnapshotsTable {
  id: Generated<string>;
  month: string;
  total_tenants: Generated<number>;
  active_salons: Generated<number>;
  pending_applications: Generated<number>;
  payment_setup_needed: Generated<number>;
  monthly_card_volume_cents: Generated<number>;
  open_support_tickets: Generated<number>;
  system_health_percent: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  paused_tenants: Generated<number>;
  trial_tenants: Generated<number>;
}
export interface PartnerPayoutsTable {
  id: Generated<string>;
  agreement_id: string | null;
  processor: string;
  accounting_period_id: string | null;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  tenant_id: string | null;
  branch_id: string | null;
  currency: Generated<string>;
  eligible_revenue_cents: Generated<number>;
  partner_pct: number | null;
  partner_gross_share_cents: Generated<number>;
  refund_allocation_cents: Generated<number>;
  adjustment_allocation_cents: Generated<number>;
  prior_balance_cents: Generated<number>;
  amount_paid_cents: Generated<number>;
  amount_due_cents: Generated<number>;
  payout_date: ColumnType<string | null, string | null, string | null>;
  status: Generated<string>;
  payment_reference: string | null;
  idempotency_key: string;
  calc_snapshot: unknown | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: TsNull;
  created_at: Ts;
}
export interface PayrollSyncEventsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  provider: string;
  event_type: string;
  status: Generated<string>;
  error_code: string | null;
  error_message: string | null;
  attempt_count: Generated<number>;
  max_attempts: Generated<number>;
  idempotency_key: string;
  external_ref: string | null;
  last_attempt_at: TsNull;
  next_retry_at: TsNull;
  resolution: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface PermissionsTable {
  id: Generated<string>;
  key: string;
}
export interface PlanAddOnsTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  pricing_model: Generated<string>;
  unit_price_cents: Generated<number>;
  billing_interval: Generated<string>;
  prerequisite_plan_code: string | null;
  status: Generated<string>;
  display_order: Generated<number>;
  effective_from: Ts;
  expires_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  feature_key: string | null;
}
export interface PlanFeaturesTable {
  id: Generated<string>;
  plan_id: string;
  feature_key: string;
  state: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}
export interface PlanLimitsTable {
  id: Generated<string>;
  plan_id: string;
  metric: string;
  limit_value: number | null;
  enforcement: Generated<string>;
  warning_threshold_pct: Generated<number>;
  overage_allowed: Generated<boolean>;
  overage_price_cents: number | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface PlatformAnnouncementTargetsTable {
  id: Generated<string>;
  announcement_id: string;
  tenant_id: string;
  created_at: Ts;
}
export interface PlatformAnnouncementsTable {
  id: Generated<string>;
  title: string;
  body: string | null;
  channel: Generated<string>;
  audience_scope: Generated<string>;
  status: Generated<string>;
  scheduled_at: TsNull;
  audience_size: Generated<number>;
  sent_count: Generated<number>;
  open_count: Generated<number>;
  click_count: Generated<number>;
  booking_count: Generated<number>;
  revenue_cents: Generated<number>;
  template_id: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  scheduled_by_user_id: string | null;
  sent_at: TsNull;
  cancelled_at: TsNull;
  cancel_reason: string | null;
  subject: string | null;
  priority: Generated<string>;
  recipient_roles: Generated<string[]>;
  target_scope: Generated<string>;
  target_tenant_ids: Generated<string[]>;
  recipient_estimate: Generated<number>;
  idempotency_key: string | null;
  created_by: string | null;
}
export interface PlatformBrandingTable {
  id: Generated<number>;
  data: Generated<unknown>;
  updated_by: string | null;
  updated_at: Ts;
}
export interface PlatformSettingChangesTable {
  id: Generated<string>;
  setting_key: string;
  setting_group: string;
  previous_value: unknown | null;
  new_value: unknown | null;
  version: number;
  actor: string | null;
  actor_role: string | null;
  reason: string | null;
  source: Generated<string>;
  correlation_id: string | null;
  created_at: Ts;
}
export interface PlatformSettingsTable {
  id: Generated<string>;
  setting_key: string;
  setting_group: string;
  value: unknown;
  value_type: Generated<string>;
  version: Generated<number>;
  override_policy: Generated<string>;
  is_sensitive: Generated<boolean>;
  is_mandatory: Generated<boolean>;
  effective_from: Ts;
  changed_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface PosBookingIntegrationsTable {
  tenant_id: string;
  online_booking_enabled: Generated<boolean>;
  tenant_slug: string | null;
  google_reserve_connected: Generated<boolean>;
  google_booking_link: string | null;
  ai_phone_enabled: Generated<boolean>;
  ai_actions: Generated<unknown>;
}
export interface PosDisplayDevicesTable {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  name: string;
  station_id: string | null;
  status: Generated<string>;
  last_seen_at: TsNull;
}
// pos_message_templates: + category … last_used_at (migration 740, Message Templates & Automation Center)
export interface PosMessageTemplatesTable {
  id: string;
  tenant_id: string;
  channel: string;
  name: string;
  body: string;
  category: string | null; subject: string | null; description: string | null; branch_id: string | null; status: Generated<string>;
  current_version: Generated<number>; record_version: Generated<number>; created_by: string | null; updated_by: string | null;
  created_at: Generated<TsNull>; updated_at: Generated<TsNull>; archived_at: TsNull; last_used_at: TsNull;
}
// migration 740: append-only template version snapshots
export interface PosMessageTemplateVersionsTable {
  id: Generated<string>; tenant_id: string; template_id: string; version: number; name: string; channel: string; category: string | null;
  subject: string | null; body: string; variables: Generated<string[]>; backfilled: Generated<boolean>; created_by: string | null; created_at: Generated<Ts>;
}
// migration 740: which automation uses which template
export interface PosMessageTemplateBindingsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; workflow: string; channel: string; template_id: string;
  version_strategy: Generated<string>; pinned_version: number | null; active: Generated<boolean>; record_version: Generated<number>;
  created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>;
}
// migration 740: one row per message a template produced
export interface PosMessageTemplateUsageTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; template_id: string; template_version: number; workflow: string; channel: string;
  customer_id: string | null; appointment_id: string | null; thread_id: string | null; message_id: string | null; notification_id: string | null; test_id: string | null;
  recipient_masked: string | null; rendered_subject: string | null; rendered_body: string; send_outcome: string; outcome_reason: string | null;
  created_by: string | null; created_at: Generated<Ts>;
}
// migration 740: confirmed Test Sends
export interface PosMessageTemplateTestsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; template_id: string; template_version: number; channel: string;
  target_masked: string; target_hash: string; idempotency_key: string; status: Generated<string>; provider_ref: string | null; notification_id: string | null;
  error_code: string | null; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>;
}
export interface PosMessagingSenderTable {
  tenant_id: string;
  sender_brand: string | null;
  a2p_status: Generated<string>;
}
export interface PosProjectStatusChecksTable {
  id: Generated<number>;
  tenant_id: string;
  module_key: string;
  last_checked_at: Ts;
  checked_by: string | null;
}
export interface PosQueueAuditTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  user_id: string | null;
  role: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  metadata: unknown | null;
  created_at: Ts;
}
export interface PrivilegedAccessGrantEventsTable {
  id: Generated<string>;
  grant_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  note: string | null;
  occurred_at: Ts;
}
export interface PrivilegedAccessGrantsTable {
  id: Generated<string>;
  grant_ref: string;
  user_id: string;
  privilege: string;
  scope: string;
  target: string | null;
  reason: string;
  status: Generated<string>;
  requested_by: string | null;
  approved_by: string | null;
  granted_at: TsNull;
  expires_at: Ts;
  revoked_at: TsNull;
  correlation_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface ProcessorReconciliationsTable {
  id: Generated<string>;
  statement_id: string;
  agreement_id: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  processor: string | null;
  period_start: ColumnType<string | null, string | null, string | null>;
  period_end: ColumnType<string | null, string | null, string | null>;
  currency: Generated<string>;
  expected_amount_cents: Generated<number>;
  actual_amount_cents: Generated<number>;
  difference_cents: Generated<number>;
  difference_type: Generated<string>;
  expected_ai_cents: Generated<number>;
  expected_processor_cents: Generated<number>;
  expected_salon_cents: Generated<number>;
  status: Generated<string>;
  reviewer: string | null;
  notes: string | null;
  resolution: string | null;
  created_at: Ts;
}
export interface ProductBarcodesTable {
  id: Generated<string>;
  master_product_id: string;
  barcode: string;
  barcode_type: Generated<string>;
  is_primary: Generated<boolean>;
  valid: Generated<boolean>;
  source: string | null;
  reason: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  retired_at: TsNull;
}
export interface ProductCategoryMergeLogsTable {
  id: Generated<string>;
  tenant_id: string;
  source_category_id: string;
  target_category_id: string;
  reattributed_product_count: Generated<number>;
  merged_by_user_id: string | null;
  merge_summary_json: unknown | null;
  created_at: Ts;
}
export interface ProductDistributionsTable {
  id: Generated<string>;
  master_product_id: string;
  tenant_id: string;
  status: Generated<string>;
  tenant_product_id: string | null;
  master_version_note: string | null;
  reason: string | null;
  detail: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  completed_at: TsNull;
}
export interface ProductImportErrorsTable {
  id: Generated<string>;
  job_id: string;
  row_number: number | null;
  error_type: string;
  product_name: string | null;
  source_file: string | null;
  detail: string | null;
  status: Generated<string>;
  retryable: Generated<boolean>;
  created_at: Ts;
}
export interface ProductImportJobsTable {
  id: Generated<string>;
  source: Generated<string>;
  filename: string | null;
  status: Generated<string>;
  total_rows: Generated<number>;
  valid_rows: Generated<number>;
  invalid_rows: Generated<number>;
  imported_rows: Generated<number>;
  failed_rows: Generated<number>;
  error_summary: string | null;
  idempotency_key: string | null;
  created_by_user_id: string | null;
  created_at: Ts;
  approved_at: TsNull;
  completed_at: TsNull;
}
export interface ProductMasterTable {
  id: Generated<string>;
  code: string | null;
  name: string;
  normalized_name: string;
  brand_name: string | null;
  sku: string | null;
  normalized_sku: string | null;
  manufacturer_sku: string | null;
  upc: string | null;
  barcode: string | null;
  category_name: string | null;
  product_type: string | null;
  description: string | null;
  cost_cents: number | null;
  suggested_retail_cents: number | null;
  currency: Generated<string>;
  tax_category: string | null;
  inventory_unit: Generated<string>;
  vendor_name: string | null;
  is_retail: Generated<boolean>;
  is_service: Generated<boolean>;
  optional_product: Generated<boolean>;
  tenant_may_customize_price: Generated<boolean>;
  tenant_may_customize_cost: Generated<boolean>;
  tenant_may_customize_vendor: Generated<boolean>;
  tenant_may_customize_tax: Generated<boolean>;
  tenant_may_customize_category: Generated<boolean>;
  tenant_may_deactivate: Generated<boolean>;
  status: Generated<string>;
  internal_notes: string | null;
  version_note: string | null;
  created_by_user_id: string | null;
  retired_by_user_id: string | null;
  retired_reason: string | null;
  retired_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface OutboxEventsTable {
  id: string;
  event_type: string;
  event_version: Generated<number>;
  tenant_id: string | null;
  branch_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number | null;
  actor_id: string | null;
  actor_type: string | null;
  request_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  payload_json: unknown;
  occurred_at: Ts;
  publish_status: Generated<string>;
  published_at: TsNull;
  attempt_count: Generated<number>;
  next_attempt_at: Generated<Ts>;
  last_error_code: string | null;
  claimed_by: string | null;
  claimed_at: TsNull;
  created_at: Generated<Ts>;
  traceparent: string | null;   // migration 548 (Phase 11 tracing)
}
export interface ProcessedEventsTable {
  consumer_name: string;
  event_id: string;
  tenant_id: string | null;
  processed_at: Generated<Ts>;
}
export interface EventDeadLettersTable {
  id: Generated<string>;
  event_id: string;
  consumer_name: string;
  tenant_id: string | null;
  event_type: string;
  correlation_id: string | null;
  envelope_json: unknown;
  attempts: Generated<number>;
  error_class: string;
  last_error_code: string | null;
  first_failed_at: Generated<Ts>;
  last_failed_at: Generated<Ts>;
  status: Generated<string>;
  resolved_by: string | null;
  resolved_at: TsNull;
  next_attempt_at: TsNull;
}
export interface LoyaltyPointEarningsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string;
  payment_id: string;
  ticket_id: string | null;
  amount_cents: number;
  points: number;
  source: Generated<string>;
  event_id: string | null;
  created_at: Generated<Ts>;
  excluded_cents: Generated<number>;    // migration 675 (D3) — the part of the tender that bought gift-card value
  reversed_points: Generated<number>;   // migration 675 (D3) — points given back by refunds / voids
}
export interface ProductUpdatesTable {
  id: Generated<string>;
  version: string | null;
  title: string;
  category: string | null;
  body: string | null;
  published_at: Ts;
  created_at: Ts;
}
export interface PromotionRedemptionsTable {
  id: Generated<string>;
  promotion_id: string;
  tenant_id: string;
  redeemed_at: Ts;
  status: Generated<string>;
}
export interface PromotionsTable {
  id: Generated<string>;
  code: string;
  name: string;
  discount_type: string;
  discount_percent: number | null;
  discount_cents: number | null;
  free_months: number | null;
  eligible_plan_codes: string | null;
  start_date: Ts;
  end_date: TsNull;
  max_redemptions: number | null;
  per_tenant_limit: Generated<number>;
  new_tenant_only: Generated<boolean>;
  stackable: Generated<boolean>;
  conversion_plan_code: string | null;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}
export interface PublicCheckInSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  customer_id: string | null;
  appointment_id: string | null;
  queue_item_id: string | null;
  ticket_id: string | null;
  status: Generated<string>;
  estimated_wait_min: Generated<number>;
  estimated_wait_max: Generated<number>;
  expires_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface PurchaseOrderLinesTable {
  id: Generated<string>;
  tenant_id: string;
  purchase_order_id: string;
  product_id: string;
  quantity_ordered: Generated<number>;
  quantity_received: Generated<number>;
  unit_cost_cents: Generated<number>;
  lot_number: string | null;
  expiration_date: ColumnType<string | null, string | null, string | null>;
  storage_location: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface PurchaseOrdersTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  vendor_id: string | null;
  po_number: string | null;
  status: Generated<string>;
  expected_date: ColumnType<string | null, string | null, string | null>;
  notes: string | null;
  subtotal_cents: Generated<number>;
  shipping_cents: Generated<number>;
  tax_cents: Generated<number>;
  total_cents: Generated<number>;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: TsNull;
  ordered_at: TsNull;
  received_at: TsNull;
  cancelled_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface QueueAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  queue_entry_id: string;
  type: string;
  severity: string;
  reason: string;
  age_minutes: Generated<number>;
  status: Generated<string>;
  acknowledged_by: string | null;
  acknowledged_at: TsNull;
  resolved_by: string | null;
  resolved_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  auto_resolved: Generated<boolean>;
  resolution: string | null;
  review_note: string | null;
  technician_id: string | null;
  last_seen_at: TsNull;
  notified_severity: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface QueueAssignmentCandidatesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  recommendation_id: string;
  technician_id: string;
  rank: number;
  match_score: number;
  eligible: Generated<boolean>;
  reasons: Generated<unknown>;
  warnings: Generated<unknown>;
  est_start_min: number | null;
  est_completion_min: number | null;
  created_at: Ts;
}
export interface QueueAssignmentDecisionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  recommendation_id: string | null;
  queue_entry_id: string;
  decision: string;
  chosen_technician: string | null;
  reason: string | null;
  decided_by: string;
  created_at: Ts;
  applied: Generated<boolean>;
  idempotency_key: string | null;
  previous_technician: string | null;
  feedback_code: string | null;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  plan: unknown;   // migration 569
}
export interface QueueAssignmentRecommendationsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  queue_entry_id: string;
  recommended_tech: string | null;
  match_score: number | null;
  confidence: Generated<number>;
  required_action: string;
  conflicts: Generated<unknown>;
  warnings: Generated<unknown>;
  rule_version: string;
  reco_version: string;
  envelope: unknown;
  created_at: Ts;
  config_version: number | null;
  queue_version: number | null;
  source: Generated<string>;
}
export interface QueueAssignmentRotationStateTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  policy: string | null;
  last_served_tech: string | null;
  updated_by: string | null;
  updated_at: Ts;
  last_served_at: TsNull;
  fixed_order: Generated<unknown>;
  version: Generated<number>;
}
export interface QueueAssignmentSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  wait_approaching_min: number | null;
  wait_exceeded_min: number | null;
  wait_severe_min: number | null;
  wait_critical_min: number | null;
  updated_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  auto_enabled: boolean | null;
  auto_confidence_floor: number | null;
  auto_max_per_run: number | null;
  auto_updated_by: string | null;
  auto_updated_at: TsNull;
  version: Generated<number>;
  inherit: Generated<boolean>;
  stuck_minutes: number | null;
  long_service_factor: number | null;
  congestion_waiting_per_tech: number | null;
  late_grace_min: number | null;
  auto_delay_seconds: number | null;
  auto_exclusions: unknown | null;
  last_auto_run_at: TsNull;
  last_scan_at: TsNull;
  assignment_mode: string | null;   // migration 600 — null = the salon's
  turn_policy: unknown | null;      // migration 600 — keys present override the salon's
}
export interface QueueMetricsSnapshotsTable {
  id: Generated<string>;
  scope_key: string;
  tenant_id: string | null;
  captured_at: Ts;
  metrics: Generated<unknown>;
  created_at: Ts;
}
export interface QueueRepairActionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  queue_entry_id: string;
  alert_id: string | null;
  action: string;
  reason: string | null;
  performed_by: string;
  created_at: Ts;
}
export interface ReceiptDeliveryLogsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  ticket_id: string;
  channel: string;
  destination: string | null;
  status: Generated<string>;
  created_at: Ts;
}
export interface ReceptionCopilotActionLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  idempotency_key: string;
  action_type: string;
  ok: Generated<boolean>;
  resource_id: string | null;
  created_at: Ts;
  // migration 757 — claim-before-run ledger (Reception Copilot guide)
  state: Generated<string | null>; actor_user_id: string | null; payload_hash: string | null; correlation_id: string | null;
  error_code: string | null; summary: string | null; finished_at: Ts | null; updated_at: Generated<Ts>; updated_by: string | null;
}
export interface CustomerSearchHealthRunsTable {   // migration 760 — read-only "Check Customer Search System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ChurnWatchReviewsTable {   // migration 764 — Churn Watch's internal review state (never a customer status)
  tenant_id: string; customer_id: string; status: string; level_at_review: string | null; due_on: string | null; reviewed_by: string | null; reviewed_at: Generated<Ts>; updated_by: string | null; version: Generated<number>;
}
export interface ChurnWatchReviewEventsTable {   // migration 764 — append-only review history
  id: Generated<string>; tenant_id: string; customer_id: string; event_type: string; level: string | null; note: string | null; actor_user_id: string | null; created_at: Generated<Ts>;
}
export interface ChurnWatchHealthRunsTable {   // migration 764 — read-only "Check Churn Watch System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface RebookingReviewsTable {   // migration 765 — Rebooking's internal review state, pinned to the opportunity it reviewed
  tenant_id: string; customer_id: string; status: string; opportunity_since: Ts | null; due_on: string | null; reviewed_by: string | null; reviewed_at: Generated<Ts>; updated_by: string | null; version: Generated<number>;
}
export interface RebookingReviewEventsTable {   // migration 765 — append-only review + Booking Assistant handoff history (never an appointment)
  id: Generated<string>; tenant_id: string; customer_id: string; event_type: string; opportunity_since: Ts | null; service_id: string | null; technician_id: string | null; note: string | null;
  actor_user_id: string | null; created_at: Generated<Ts>;
}
export interface RebookingHealthRunsTable {   // migration 765 — read-only "Check Rebooking System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ServiceRecommendationScansTable {   // migration 766 — Service Recommendations evaluations
  id: Generated<string>; tenant_id: string; actor_user_id: string | null; trigger_kind: Generated<string>; rule_version: string; tunables: Generated<unknown>; status: Generated<string>;
  customers_evaluated: Generated<number>; generated: Generated<number>; counts: Generated<unknown>; duration_ms: number | null; error_code: string | null; started_at: Generated<Ts>; finished_at: Ts | null;
}
export interface ServiceRecommendationsTable {   // migration 766 — current suggestions (customer + catalog service + type); superseded, never deleted
  id: Generated<string>; tenant_id: string; customer_id: string; service_id: string; rec_type: string; confidence: string; times_completed: Generated<number>; last_completed_at: Ts | null;
  preferred_technician_id: string | null; status: Generated<string>; generated_at: Generated<Ts>; evaluated_at: Generated<Ts>; superseded_at: Ts | null; scan_id: string | null; rule_version: string;
}
export interface ServiceRecommendationReviewsTable {   // migration 766 — staff review state, pinned to the suggestion it reviewed
  tenant_id: string; recommendation_id: string; status: string; generated_at_reviewed: Ts | null; due_on: string | null; reviewed_by: string | null; reviewed_at: Generated<Ts>; updated_by: string | null; version: Generated<number>;
}
export interface ServiceRecommendationEventsTable {   // migration 766 — append-only review + Booking Assistant handoff history (never an appointment)
  id: Generated<string>; tenant_id: string; recommendation_id: string; customer_id: string; event_type: string; technician_id: string | null; note: string | null; actor_user_id: string | null; created_at: Generated<Ts>;
}
export interface ServiceRecommendationHealthRunsTable {   // migration 766 — read-only "Check Service Recommendations System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface AiCustomerProfileSettingsEventsTable {   // migration 767 — append-only history of Customer AI Settings changes
  id: Generated<string>; tenant_id: string; level: string; branch_id: string | null; user_id: string | null; event_type: string; before: Generated<unknown>; after: Generated<unknown>;
  changed_keys: Generated<string[]>; reason: string | null; version: number; actor_user_id: string | null; actor_role: string | null; created_at: Generated<Ts>;
}
export interface CustomerAiSettingsHealthRunsTable {   // migration 767 — read-only "Check Customer AI System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface CustomerIntelligenceScansTable {   // migration 763 — Customer Intelligence scans (counts per state, rule version, tunables)
  id: Generated<string>; tenant_id: string; actor_user_id: string | null; trigger_kind: Generated<string>; rule_version: string; tunables: Generated<unknown>; status: Generated<string>;
  scanned: Generated<number>; counts: Generated<unknown>; archived_excluded: Generated<number>; duration_ms: number | null; error_code: string | null; started_at: Generated<Ts>; finished_at: Ts | null;
}
export interface CustomerIntelligenceSnapshotsTable {   // migration 763 — latest per-customer classification (derived, rebuildable)
  tenant_id: string; customer_id: string; scan_id: string; status: string; completed_visits: Generated<number>; first_visit_at: Ts | null; last_visit_at: Ts | null;
  typical_interval_days: number | null; days_since_last: number | null; has_upcoming: Generated<boolean>; next_appointment_date: string | null; churn_watch: Generated<boolean>;
  rebooking: Generated<boolean>; rebooking_reason: string | null; evidence: Generated<string[]>; computed_at: Generated<Ts>;
  churn_level: string | null; churn_confidence: string | null; churn_evidence: Generated<string[]>; canceled_count: Generated<number>; no_show_count: Generated<number>;   // 764
  membership_canceled: Generated<boolean>; churn_since: Ts | null;
  rebooking_since: Ts | null; rebooking_due_on: string | null; rebooking_window_end: string | null;   // 765
}
export interface CustomerIntelligenceHealthRunsTable {   // migration 763 — read-only "Check Customer Intelligence System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface CustomerTimelineHealthRunsTable {   // migration 762 — read-only "Check Customer Timeline System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface CustomerDuplicateScansTable {   // migration 761 — Duplicate Review detection runs (= real data freshness)
  id: Generated<string>; tenant_id: string; actor_user_id: string | null; trigger_kind: Generated<string>; rule_version: string; status: Generated<string>;
  customers_scanned: Generated<number>; groups_found: Generated<number>; groups_new: Generated<number>; groups_reopened: Generated<number>; groups_resolved: Generated<number>;
  oversized_keys: Generated<number>; error_code: string | null; started_at: Generated<Ts>; finished_at: Ts | null;
}
export interface CustomerDuplicateGroupsTable {   // migration 761 — one candidate group per distinct member set (review record, not a customer)
  id: Generated<string>; tenant_id: string; group_key: string; member_ids: string[]; member_count: number; reasons: string[]; confidence: string; rule_version: string;
  evidence: Generated<unknown>; evidence_hash: string; status: Generated<string>; assigned_to: string | null; due_on: string | null; detected_at: Generated<Ts>;
  updated_at: Generated<Ts>; updated_by: string | null; last_seen_at: Generated<Ts>; last_scan_id: string | null; reviewed_at: Ts | null; reviewed_by: string | null; merged_at: Ts | null;
  survivor_id: string | null; merge_op_id: string | null; version: Generated<number>;
}
export interface CustomerDuplicateEventsTable {   // migration 761 — append-only review timeline (trigger refuses UPDATE / DELETE)
  id: Generated<string>; tenant_id: string; group_id: string; event_type: string; actor_user_id: string | null; note: string | null; payload: Generated<unknown>; created_at: Generated<Ts>;
}
export interface CustomerDuplicateMergeOpsTable {   // migration 761 — confirmed merge attempts; idempotency key unique per salon
  id: Generated<string>; tenant_id: string; group_id: string; idempotency_key: string; preview_hash: string; survivor_id: string; source_ids: string[]; status: string;
  error_code: string | null; result: Generated<unknown>; actor_user_id: string | null; created_at: Generated<Ts>;
}
export interface CustomerDuplicateHealthRunsTable {   // migration 761 — read-only "Check Duplicate Review System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface AiCalendarHealthRunsTable {   // migration 758 — read-only "Check Calendar System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; calendar_date: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReceptionCopilotHealthRunsTable {   // migration 757 — read-only "Check Copilot System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReceptionCopilotFeedbackTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  recommendation_id: string | null;
  session_id: string | null;
  receptionist_user_id: string | null;
  rating: string;
  reason: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReceptionCopilotKnowledgeVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  version: number;
  source_suggestion_id: string | null;
  content: Generated<unknown>;
  created_by: string | null;
  created_at: Ts;
  active: Generated<boolean>;
}
export interface ReceptionCopilotLearningSuggestionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  kind: string;
  suggestion: string;
  evidence: Generated<unknown>;
  status: Generated<string>;
  created_at: Ts;
  decided_by: string | null;
  decided_at: TsNull;
}
export interface ReceptionCopilotRecommendationsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  session_id: string | null;
  receptionist_user_id: string | null;
  kind: string;
  payload: Generated<unknown>;
  acted_on: Generated<boolean>;
  created_at: Ts;
}
export interface ReceptionCopilotSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  receptionist_user_id: string;
  channel: Generated<string>;
  status: Generated<string>;
  started_at: Ts;
  ended_at: TsNull;
}
export interface ReconciliationExceptionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  kind: string;
  severity: Generated<string>;
  title: string;
  detail: string | null;
  amount_cents: Generated<number>;
  currency: Generated<string>;
  status: Generated<string>;
  source_ref: string | null;
  assigned_to_user_id: string | null;
  resolution_note: string | null;
  resolved_by_user_id: string | null;
  resolved_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReconciliationPeriodsTable {
  id: Generated<string>;
  tenant_id: string;
  label: string;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  status: Generated<string>;
  closed_by_user_id: string | null;
  closed_at: TsNull;
  notes: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReferralRedemptionsTable {
  id: Generated<string>;
  tenant_id: string;
  referrer_customer_id: string;
  referred_customer_id: string | null;
  code: string;
  status: Generated<string>;
  reward_cents: Generated<number>;
  redeemed_at: Ts;
  rewarded_at: TsNull;
  state: Generated<string>; branch_id: string | null; code_id: string | null; policy_version: number | null; recorded_by: string | null;
  qualifying_ticket_id: string | null; qualified_at: TsNull; decided_at: TsNull; review_reason: string | null; fraud_flags: Generated<unknown>;
  legacy_marked_reward_cents: number | null; row_version: Generated<number>; updated_at: TsNull; updated_by: string | null;
}
export interface ReferralProgramSettingsTable {
  tenant_id: string; enabled: Generated<boolean>; reward_type: string | null; reward_points: number | null; reward_cents: number | null;
  requires_approval: Generated<boolean>; separation_of_duties: Generated<boolean>; min_qualifying_spend_cents: Generated<number>;
  qualification_window_days: number | null; record_grace_hours: Generated<number>; version: Generated<number>;
  created_at: Generated<Ts>; created_by: string | null; updated_at: Generated<Ts>; updated_by: string | null;
}
export interface ReferralRewardsTable {
  id: Generated<string>; tenant_id: string; referral_id: string; recipient_customer_id: string; reward_type: string; points: number | null; amount_cents: number | null;
  policy_version: number; state: Generated<string>; requested_at: Generated<Ts>; decided_at: TsNull; decided_by: string | null; decision_reason: string | null;
  issued_at: TsNull; issued_by: string | null; issuance_key: string | null; ledger_entry_id: string | null; issue_error: string | null;
  reversed_at: TsNull; reversed_by: string | null; reversal_reason: string | null; reversal_ledger_id: string | null; reversal_shortfall: number | null;
  row_version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null;
}
export interface ReviewModerationEventsTable {   // migration 752 — append-only moderation trail
  id: Generated<string>; tenant_id: string; branch_id: string | null; review_id: string; actor_user_id: string | null; action: string;
  previous_hidden: boolean; new_hidden: boolean; reason_code: string | null; reason_text: string | null; evidence: string | null;
  source: Generated<string>; idempotency_key: string | null; created_at: Generated<Ts>;
}
export interface ReferralEventsTable {
  id: Generated<string>; tenant_id: string; referral_id: string; reward_id: string | null; event_type: string; from_state: string | null; to_state: string | null;
  actor_user_id: string | null; reason: string | null; source_ref: string | null; idempotency_key: string | null; metadata: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReminderChannelConfigTable {
  id: Generated<string>;
  tenant_id: string | null;
  reminder_type: string;
  primary_channel: string;
  fallback_channels: Generated<string[]>;
  fallback_on: Generated<string>;
  max_fallback_attempts: Generated<number>;
  stop_on_success: Generated<boolean>;
  recheck_suppression: Generated<boolean>;
  recheck_quiet_hours: Generated<boolean>;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface ReminderFlowStateTable {
  id: Generated<string>;
  tenant_id: string | null;
  reminder_type: string;
  status: Generated<string>;
  reason: string | null;
  disabled_by: string | null;
  disabled_at: TsNull;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface ReminderPlanFeaturesTable {
  id: Generated<string>;
  plan_code: string;
  feature_key: string;
  state: Generated<string>;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface ReminderSettingsTable {
  tenant_id: string;
  enabled: Generated<boolean>;
  lead_minutes: Generated<number>;
  window_minutes: Generated<number>;
  channel: Generated<string>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  ladder_minutes: number[] | null;   // migration 670 — the reminder ladder, longest first; NULL = the single lead_minutes
}
export interface ReminderTemplateVersionsTable {
  id: Generated<string>;
  template_id: string;
  version: number;
  sms_content: string | null;
  email_subject: string | null;
  email_body: string | null;
  push_title: string | null;
  push_body: string | null;
  placeholders: Generated<string[]>;
  status: Generated<string>;
  created_by: string | null;
  published_at: TsNull;
  created_at: Ts;
}
export interface ReminderTemplatesTable {
  id: Generated<string>;
  tenant_id: string | null;
  reminder_type: string;
  name: string;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ReminderTenantOverridesTable {
  id: Generated<string>;
  tenant_id: string;
  reminder_type: string;
  enabled: Generated<boolean>;
  direction: string | null;
  offset_minutes: number | null;
  channels: string[] | null;
  quiet_hours_policy: string | null;
  approval_state: Generated<string>;
  effective_date: TsNull;
  end_date: TsNull;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface ReminderTimingDefaultsTable {
  id: Generated<string>;
  tenant_id: string | null;
  reminder_type: string;
  direction: Generated<string>;
  offset_minutes: Generated<number>;
  min_offset_minutes: Generated<number>;
  max_offset_minutes: Generated<number>;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  quiet_hours_policy: Generated<string>;
  timezone_source: Generated<string>;
  enabled: Generated<boolean>;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface ReportExportsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  user_id: string | null;
  role: string | null;
  report_key: string;
  format: string;
  start_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string>;
  file_url: string | null;
  created_at: Ts;
}
export interface ResidualStatementLinesTable {
  id: Generated<string>;
  statement_id: string;
  merchant_account: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  gross_volume_cents: Generated<number>;
  eligible_revenue_cents: Generated<number>;
  residual_cents: Generated<number>;
  matched: Generated<boolean>;
  agreement_id: string | null;
  note: string | null;
  created_at: Ts;
}
export interface ResidualStatementsTable {
  id: Generated<string>;
  processor: string;
  statement_ref: string;
  merchant_account: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  currency: Generated<string>;
  transaction_volume_cents: Generated<number>;
  eligible_revenue_cents: Generated<number>;
  processing_residual_cents: Generated<number>;
  applicable_costs_cents: Generated<number>;
  fees_cents: Generated<number>;
  refunds_cents: Generated<number>;
  chargebacks_cents: Generated<number>;
  adjustments_cents: Generated<number>;
  processor_calculated_cents: Generated<number>;
  import_hash: string;
  source_file: string | null;
  import_status: Generated<string>;
  review_status: Generated<string>;
  review_notes: string | null;
  unmatched_lines: Generated<number>;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  created_by: string | null;
  created_at: Ts;
}
export interface RevenueAccountingPeriodsTable {
  id: Generated<string>;
  name: string;
  start_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string>;
  currency: Generated<string>;
  status: Generated<string>;
  locked_by: string | null;
  locked_at: TsNull;
  lock_reason: string | null;
  reopened_by: string | null;
  reopened_at: TsNull;
  reopen_reason: string | null;
  created_at: Ts;
}
export interface RevenueAdjustmentsTable {
  id: Generated<string>;
  adjustment_ref: string;
  agreement_id: string | null;
  revenue_record_id: string | null;
  accounting_period_id: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  processor: string | null;
  adjustment_type: string;
  amount_cents: number;
  direction: string;
  reason: string;
  supporting_evidence: string | null;
  requires_dual_approval: Generated<boolean>;
  requested_by: string | null;
  approved_by: string | null;
  second_approved_by: string | null;
  status: Generated<string>;
  ledger_record_id: string | null;
  rejected_reason: string | null;
  created_at: Ts;
  approved_at: TsNull;
  applied_at: TsNull;
}
export interface RevenueAgreementVersionsTable {
  id: Generated<string>;
  agreement_id: string;
  version_number: number;
  ai_powersalon_pct: number;
  processor_pct: number;
  salon_pct: number;
  effective_date: ColumnType<string, string, string>;
  expiration_date: ColumnType<string | null, string | null, string | null>;
  currency: Generated<string>;
  rounding_policy: Generated<string>;
  refund_allocation: Generated<string>;
  minimum_volume_cents: number | null;
  maximum_volume_cents: number | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface RevenueAgreementsTable {
  id: Generated<string>;
  code: string;
  name: string;
  agreement_type: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  processor: string | null;
  revenue_source: string | null;
  current_version_id: string | null;
  status: Generated<string>;
  created_by: string | null;
  approved_by: string | null;
  created_at: Ts;
  approved_at: TsNull;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface RevenueAuditLogTable {
  id: Generated<string>;
  action: string;
  agreement_id: string | null;
  agreement_version_id: string | null;
  revenue_record_id: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  accounting_period_id: string | null;
  processor: string | null;
  actor_id: string | null;
  actor_role: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: Ts;
}
export interface RevenueExportJobsTable {
  id: Generated<string>;
  dataset: string;
  format: string;
  filters: unknown | null;
  status: Generated<string>;
  row_count: number | null;
  filename: string | null;
  mime: string | null;
  encoding: string | null;
  content: string | null;
  error: string | null;
  requested_by: string | null;
  created_at: Ts;
  started_at: TsNull;
  completed_at: TsNull;
  content_key: string | null;    // migration 677 (B-18)
}
export interface RevenueRecordsTable {
  id: Generated<string>;
  agreement_id: string | null;
  agreement_version_id: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  processor: string | null;
  revenue_source: string | null;
  source_reference: string | null;
  accounting_period_id: string | null;
  currency: Generated<string>;
  gross_revenue_cents: Generated<number>;
  ai_powersalon_pct: number | null;
  processor_pct: number | null;
  salon_pct: number | null;
  ai_powersalon_share_cents: Generated<number>;
  processor_share_cents: Generated<number>;
  salon_incentive_share_cents: Generated<number>;
  refunds_credits_cents: Generated<number>;
  adjustments_cents: Generated<number>;
  rounding_adjustment_cents: Generated<number>;
  net_revenue_cents: Generated<number>;
  outstanding_balance_cents: Generated<number>;
  forecasted_revenue_cents: Generated<number>;
  effective_date: ColumnType<string | null, string | null, string | null>;
  status: Generated<string>;
  calculated_at: TsNull;
  approved_at: TsNull;
  paid_at: TsNull;
  locked_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
}
export interface RolesTable {
  id: Generated<string>;
  name: string;
}
export interface ScheduledReportsTable {
  id: Generated<string>;
  name: string;
  report_key: Generated<string>;
  filters: Generated<unknown>;
  cadence: Generated<string>;
  recipient_email: string | null;
  format: Generated<string>;
  enabled: Generated<boolean>;
  last_run_at: TsNull;
  last_status: string | null;
  next_run_at: Ts;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface SecurityIncidentEventsTable {
  id: Generated<string>;
  incident_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  reason: string | null;
  correlation_id: string | null;
  occurred_at: Ts;
}
export interface SecurityIncidentsTable {
  id: Generated<string>;
  incident_ref: string;
  title: string;
  description: string | null;
  category: Generated<string>;
  severity: Generated<string>;
  status: Generated<string>;
  detection_source: string | null;
  tenant_id: string | null;
  branch_id: string | null;
  assigned_to_user_id: string | null;
  correlation_id: string | null;
  detected_at: Ts;
  contained_at: TsNull;
  resolved_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SecurityPoliciesTable {
  id: Generated<string>;
  kind: string;
  version: Generated<number>;
  status: Generated<string>;
  config: Generated<unknown>;
  compliant: Generated<boolean>;
  created_by: string | null;
  activated_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface ServiceCategoryMergeLogsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  source_category_id: string;
  target_category_id: string;
  reattributed_service_count: Generated<number>;
  merged_by_user_id: string | null;
  merge_summary_json: unknown | null;
  created_at: Ts;
}
export interface ServiceProductRecipesTable {
  id: Generated<string>;
  tenant_id: string;
  service_id: string;
  product_id: string;
  quantity: Generated<number>;
  notes: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface ServiceProgressEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  ticket_id: string;
  service_line_id: string | null;
  customer_id: string;
  technician_id: string | null;
  event_type: string;
  old_status: string | null;
  new_status: string;
  metadata_json: Generated<unknown>;
  created_by_user_id: string | null;
  created_at: Ts;
}
export interface ServiceTemplateAddonsTable {
  id: Generated<string>;
  template_id: string;
  name: string;
  price_cents: Generated<number>;
  display_order: Generated<number>;
}
export interface ServiceTemplateCategoriesTable {
  id: Generated<string>;
  code: string;
  name: string;
  icon_key: string | null;
  display_order: Generated<number>;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}
export interface ServiceTemplateDeploymentsTable {
  id: Generated<string>;
  template_id: string;
  tenant_id: string;
  copied_at: Ts;
  customizable: Generated<boolean>;
  customized: Generated<boolean>;
  copied_service_id: string | null;
  deployed_by: string | null;
  deploy_status: Generated<string>;
}
export interface ServiceTemplateResourcesTable {
  id: Generated<string>;
  template_id: string;
  resource_label: string;
  quantity: Generated<number>;
  display_order: Generated<number>;
}
export interface ServiceTemplateVersionsTable {
  id: Generated<string>;
  template_id: string;
  version_number: number;
  version_label: string | null;
  snapshot: unknown | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface ServiceTemplatesTable {
  id: Generated<string>;
  code: string;
  name: string;
  category_code: string | null;
  description: string | null;
  suggested_duration_minutes: Generated<number>;
  suggested_price_min_cents: Generated<number>;
  suggested_price_max_cents: Generated<number>;
  tax_setting: Generated<string>;
  commission_eligible: Generated<boolean>;
  status: Generated<string>;
  version: Generated<number>;
  version_label: Generated<string>;
  is_customizable: Generated<boolean>;
  display_order: Generated<number>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  published_at: TsNull;
  published_by: string | null;
  retired_at: TsNull;
  retired_by: string | null;
  retire_reason: string | null;
  updated_by: string | null;
}
export interface SettlementNotesTable {
  id: Generated<string>;
  settlement_id: string;
  tenant_id: string;
  branch_id: string | null;
  category: Generated<string>;
  body: string;
  author_user_id: string | null;
  author_role: string | null;
  support_case_id: string | null;
  created_at: Ts;
}
export interface SmsDeliveryLogsTable {
  id: Generated<string>;
  tenant_id: string | null;
  user_id: string | null;
  phone_masked: string;
  template: string;
  provider_sid: string | null;
  status: Generated<string>;
  error_message: string | null;
  created_at: Ts;
}
export interface SocialPostsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  platform: string;
  caption: string;
  scheduled_at: TsNull;
  status: Generated<string>;
  posted_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface StatusCommunicationsTable {
  id: Generated<string>;
  incident_reference: string | null;
  channel: Generated<string>;
  audience: Generated<string>;
  message: string;
  sent_by: string | null;
  sent_at: Ts;
}
export interface SystemHealthSnapshotsTable {
  id: Generated<string>;
  component_key: string;
  status: string;
  previous: string | null;
  reason_code: string;
  summary: Generated<unknown>;
  observed_at: Ts;
}

export interface TenantHealthSnapshotsTable {
  id: Generated<string>;
  tenant_id: string;
  observed_at: Ts;
  snapshot_hour: Ts;
  overall_status: string;
  payments_status: string;
  communications_status: string;
  booking_status: string;
  devices_status: string;
  jobs_status: string;
  realtime_status: string | null;
  failed_queries: Generated<string[]>;
  components: Generated<unknown>;
  created_at: Generated<Ts>;
}

export interface UsageAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  metric: string;
  threshold: number;
  period: string;
  used: string;
  limit_value: string;
  pct: string;
  created_at: Generated<Ts>;
}

export interface MfaRecoveryTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  created_by: string | null;
  reason: string;
  expires_at: Ts;
  started_at: Ts | null;
  used_at: Ts | null;
  failed_attempts: Generated<number>;
  created_at: Generated<Ts>;
}

export interface PlatformApprovalsTable {
  id: Generated<string>;
  action_type: string;
  target_ref: string | null;
  payload: Generated<unknown>;
  reason: string;
  requested_by: string;
  required_permission: string;
  status: Generated<string>;
  approved_by: string | null;
  decision_note: string | null;
  decided_at: Ts | null;
  executed_at: Ts | null;
  result: unknown | null;
  expires_at: Ts;
  created_at: Generated<Ts>;
}

export interface PlatformFeaturesTable {
  feature_key: string;
  name: string;
  description: Generated<string>;
  category: string;
  status: Generated<string>;
  minimum_plan: string | null;
  requires_configuration: Generated<boolean>;
  platform_kill_switch_supported: Generated<boolean>;
  kill_switch_key: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface TechnicianManagerMessagesTable {
  id: Generated<string>;
  tenant_id: string;
  technician_id: string;
  technician_name: Generated<string>;
  topic: Generated<string>;
  message: string;
  status: Generated<string>;
  created_at: Generated<Ts>;
  resolved_at: Ts | null;
}

export interface StatusComponentsTable {
  id: Generated<string>;
  key: string;
  name: string;
  status: Generated<string>;
  sort_order: Generated<number>;
  updated_at: Ts;
  category: string | null;
  uptime_pct: number | null;
  response_time_ms: number | null;
  owner_team: string | null;
  affected_tenants: Generated<number>;
  last_incident_at: TsNull;
  criticality: string | null;
  runbook: string | null;
  status_page_visible: Generated<boolean>;
  status_source: Generated<string>;
  reason_code: string | null;
  computed_at: TsNull;
  expires_at: TsNull;
}
export interface StatusHealthSnapshotsTable {
  id: Generated<string>;
  snapshot_date: ColumnType<string, string, string>;
  health_score: number;
  uptime_pct: number | null;
  created_at: Ts;
}
export interface StatusIncidentImpactTable {
  id: Generated<string>;
  incident_reference: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  branch_name: string | null;
  service: string | null;
  impact_level: Generated<string>;
  comm_status: Generated<string>;
  created_at: Ts;
}
export interface EphemeralGrantsTable {
  token_hash: string;
  kind: string;
  payload: unknown;
  expires_at: Ts;
  created_at: Generated<Ts>;
}

export interface SecretFingerprintsTable {
  name: string;
  fingerprint: string;
  first_seen_at: Generated<Ts>;
  last_rotated_at: TsNull;
  last_seen_at: Generated<Ts>;
}

export interface SecurityEventsTable {
  id: Generated<string>;
  event_type: string;
  severity: string;
  tenant_id: string | null;
  actor_type: string | null;
  actor_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  reason: string | null;
  request_id: string | null;
  correlation_id: string | null;
  ip: string | null;
  device: string | null;
  occurred_at: Generated<Ts>;
}

export interface BackupReportsTable {
  id: Generated<string>;
  kind: string;
  status: string;
  started_at: TsNull;
  completed_at: Ts;
  size_bytes: number | null;
  pitr_enabled: boolean | null;
  integrity_ok: boolean | null;
  smoke_test_ok: boolean | null;
  detail: string | null;
  reported_at: Ts;
}

export interface SyntheticProbeHeartbeatsTable {
  instance_id: string;
  token: string;
  updated_at: Ts;
}

export interface StatusIncidentEventsTable {
  id: Generated<string>;
  incident_id: string;
  kind: string;
  body: string;
  actor: string | null;
  ref: string | null;
  created_at: Ts;
}

export interface StatusIncidentsTable {
  id: Generated<string>;
  title: string;
  status: Generated<string>;
  impact: Generated<string>;
  body: string | null;
  started_at: Ts;
  resolved_at: TsNull;
  created_at: Ts;
  incident_reference: string | null;
  component_key: string | null;
  severity: Generated<string | null>;
  recovery_owner: string | null;
  eta_at: TsNull;
  affected_tenants: Generated<number>;
  root_cause: string | null;
  recovery_percentage: Generated<number>;
  next_milestone: string | null;
  detected_at: TsNull;
  resolution: string | null;
  promoted_from_alert_id: string | null;
}
export interface StatusPostIncidentReportsTable {
  id: Generated<string>;
  report_reference: string;
  incident_reference: string | null;
  title: string;
  summary: string | null;
  root_cause: string | null;
  owner: string | null;
  status: Generated<string>;
  published_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface StatusPublicUpdatesTable {
  id: Generated<string>;
  incident_id: string | null;
  title: string;
  body: string | null;
  audience: Generated<string>;
  status: Generated<string>;
  published_at: TsNull;
  created_at: Ts;
}
export interface StatusScheduledMaintenanceTable {
  id: Generated<string>;
  service: string | null;
  component_key: string | null;
  scope: string | null;
  window_start: Ts;
  window_end: Ts;
  tenant_impact: Generated<number>;
  notice_status: Generated<string>;
  owner_team: string | null;
  created_at: Ts;
}
export interface StoreHoursSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  timezone: Generated<string>;
  auto_logout_enabled: Generated<boolean>;
  warning_minutes: Generated<unknown>;
  grace_period_minutes: Generated<number>;
  monday_is_open: Generated<boolean>;
  monday_close_time: Generated<string | null>;
  tuesday_is_open: Generated<boolean>;
  tuesday_close_time: Generated<string | null>;
  wednesday_is_open: Generated<boolean>;
  wednesday_close_time: Generated<string | null>;
  thursday_is_open: Generated<boolean>;
  thursday_close_time: Generated<string | null>;
  friday_is_open: Generated<boolean>;
  friday_close_time: Generated<string | null>;
  saturday_is_open: Generated<boolean>;
  saturday_close_time: Generated<string | null>;
  sunday_is_open: Generated<boolean>;
  sunday_close_time: string | null;
  apply_to_roles: Generated<unknown>;
  created_at: Ts;
  updated_at: Ts;
  updated_by_user_id: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SubscriptionChangesTable {
  id: Generated<string>;
  tenant_id: string;
  from_plan_code: string | null;
  to_plan_code: string;
  change_type: string;
  strategy: Generated<string>;
  status: Generated<string>;
  effective_at: Ts;
  proration_credit_cents: Generated<number>;
  proration_charge_cents: Generated<number>;
  net_cents: Generated<number>;
  reason: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface SubscriptionPlanVersionsTable {
  id: Generated<string>;
  plan_id: string;
  version_number: number;
  monthly_price_cents: number;
  annual_price_cents: number | null;
  setup_fee_cents: Generated<number>;
  currency: Generated<string>;
  billing_interval: Generated<string>;
  limits_snapshot: Generated<unknown>;
  features_snapshot: Generated<unknown>;
  status: Generated<string>;
  effective_from: Ts;
  end_date: TsNull;
  change_reason: string | null;
  created_by: string | null;
  created_at: Ts;
}
export interface SubscriptionPlansTable {
  id: Generated<string>;
  code: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  plan_type: Generated<string>;
  status: Generated<string>;
  monthly_price_cents: Generated<number>;
  annual_price_cents: number | null;
  setup_fee_cents: Generated<number>;
  currency: Generated<string>;
  billing_interval: Generated<string>;
  is_recommended: Generated<boolean>;
  is_public: Generated<boolean>;
  display_order: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}
export interface SuperAdminLoginOtpTable {
  user_id: string;
  code_hash: string;
  expires_at: Ts;
  attempts: Generated<number>;
  consumed_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
}
export interface SuperAdminProjectStatusTable {
  module_key: string;
  label: string;
  route: string;
  completion_percent: Generated<number>;
  status: Generated<string>;
  missing_reasons: Generated<unknown>;
  frontend_route_exists: Generated<boolean>;
  frontend_component_exists: Generated<boolean>;
  backend_endpoint_exists: Generated<boolean>;
  api_client_connected: Generated<boolean>;
  clicks_working: Generated<boolean>;
  tests_passing: Generated<boolean>;
  parent_module_key: string | null;
  last_checked_at: TsNull;
  updated_at: Ts;
}
export interface SuperAdminSavedViewsTable {
  id: Generated<string>;
  owner_user_id: string;
  surface: string;
  name: string;
  filters_json: string;
  is_default: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
}
export interface SupportSessionEventsTable {
  id: Generated<string>;
  request_id: string;
  tenant_id: string;
  kind: string;
  detail: string | null;
  actor_user_id: string | null;
  created_at: Ts;
}
export interface SupportSessionRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  requested_by_user_id: string;
  kind: string;
  topic: string | null;
  ticket_id: string | null;
  consent_granted: Generated<boolean>;
  consent_text: string | null;
  contact_method: string | null;
  contact_value: string | null;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SupportTicketEventsTable {
  id: Generated<string>;
  ticket_id: string;
  tenant_id: string;
  kind: string;
  detail: string | null;
  actor_user_id: string | null;
  created_at: Ts;
}
export interface SupportTicketMessagesTable {
  id: Generated<string>;
  ticket_id: string;
  tenant_id: string;
  author_user_id: string | null;
  author_kind: Generated<string>;
  body: string;
  created_at: Ts;
}
export interface SupportTicketsTable {
  id: Generated<string>;
  ticket_number: string;
  tenant_id: string;
  branch_id: string | null;
  created_by_user_id: string;
  subject: string;
  description: string | null;
  category: Generated<string>;
  subcategory: string | null;
  priority: Generated<string>;
  status: Generated<string>;
  affected_module: string | null;
  affected_branch_id: string | null;
  app_version: string | null;
  assigned_agent: string | null;
  response_target_minutes: number | null;
  needs_review: Generated<boolean>;
  idempotency_key: string | null;
  created_at: Ts;
  updated_at: Ts;
  csat_score: number | null;
  csat_comment: string | null;
  csat_submitted_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TechAccountStatusEventsTable {
  id: Generated<string>;
  global_tech_profile_id: string;
  from_status: string | null;
  to_status: string;
  action: string;
  scope: Generated<string>;
  reason: string | null;
  actor_user_id: string | null;
  expires_at: TsNull;
  created_at: Ts;
  target_id: string | null;
  target_kind: string | null;
}
export interface TechDmMessagesTable {
  id: Generated<string>;
  thread_id: string;
  sender: string;
  body: string;
  created_at: Ts;
}
export interface TechDmReportsTable {
  id: Generated<string>;
  thread_id: string;
  reported_by: string;
  reporter_user_id: string | null;
  reason: string | null;
  created_at: Ts;
  status: Generated<string>;
  resolution: string | null;
  resolved_at: TsNull;
  resolved_by_user_id: string | null;
}
export interface TechDmThreadsTable {
  id: Generated<string>;
  global_tech_profile_id: string;
  customer_user_id: string;
  status: Generated<string>;
  last_message_at: TsNull;
  last_message_preview: string | null;
  customer_unread: Generated<number>;
  technician_unread: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
}
export interface TechProfileEventsTable {
  id: Generated<string>;
  global_tech_profile_id: string;
  event_type: string;
  viewer_user_id: string | null;
  ref: string | null;
  created_at: Ts;
}
export interface TechnicianStatusEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  technician_id: string;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  changed_by_user_id: string | null;
  created_at: Ts;
}
export interface TenantA2pRegistrationsTable {
  id: Generated<string>;
  tenant_id: string;
  customer_profile_bundle_sid: string | null;
  a2p_profile_bundle_sid: string | null;
  brand_type: Generated<string>;
  is_mock: Generated<boolean>;
  campaign_usecase: string | null;
  campaign_description: string | null;
  message_samples: unknown | null;
  message_flow: string | null;
  opt_in_message: string | null;
  opt_out_message: string | null;
  help_message: string | null;
  privacy_policy_url: string | null;
  terms_and_conditions_url: string | null;
  has_embedded_links: Generated<boolean>;
  has_embedded_phone: Generated<boolean>;
  brand_sid: string | null;
  brand_status: string | null;
  messaging_service_sid: string | null;
  campaign_sid: string | null;
  campaign_status: string | null;
  number_sid: string | null;
  status: Generated<string>;
  last_error: string | null;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  business_info: unknown | null;
  secondary_profile_status: string | null;
  a2p_profile_status: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAddOnsTable {
  id: Generated<string>;
  tenant_id: string;
  add_on_id: string;
  quantity: Generated<number>;
  price_cents: number;
  status: Generated<string>;
  started_at: Ts;
  cancelled_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAiPlanSubscriptionsTable {
  id: Generated<string>;
  tenant_id: string;
  plan_code: string;
  status: Generated<string>;
  price_cents: Generated<number>;
  full_cents: Generated<number>;
  discount_cents: Generated<number>;
  started_at: Ts;
  cancelled_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  billing_period: Generated<string>;
  trial_ends_at: TsNull;
  current_period_starts_at: TsNull;
  current_period_ends_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAiSubscriptionsTable {
  id: Generated<string>;
  tenant_id: string;
  package_code: string;
  status: Generated<string>;
  billing_period: Generated<string>;
  price_cents: Generated<number>;
  currency: Generated<string>;
  trial_starts_at: TsNull;
  trial_ends_at: TsNull;
  current_period_starts_at: Ts;
  current_period_ends_at: TsNull;
  cancelled_at: TsNull;
  payment_provider: string | null;
  payment_subscription_id: string | null;
  payment_customer_id: string | null;
  last_payment_status: string | null;
  usage_limit: Generated<number>;
  overage_enabled: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantBackupRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  requested_by_user_id: string | null;
  status: Generated<string>;
  requested_at: Ts;
  completed_at: TsNull;
  size_bytes: number | null;
  error: string | null;
  created_at: Ts;
}
export interface TenantCommunitySettingsTable { tenant_id: string; enabled: Generated<boolean>; receptionist_approval_required: Generated<boolean>; manager_approval_required: Generated<boolean>; role_grants: Generated<unknown>; role_removals: Generated<unknown>; notify_categories: Generated<unknown>; updated_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; critical_sms_enabled: Generated<boolean>; display_name: string | null; author_display: Generated<string>; allow_anonymous: Generated<boolean>; branch_visibility: Generated<string>; retention_days: Generated<number>; region_preferences: Generated<unknown>; risk_matching_enabled: Generated<boolean>; push_enabled: Generated<boolean>; email_enabled: Generated<boolean>; version: Generated<number>; updated_by: string | null; }
export interface TenantCustomerPhoneSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  allow_receptionist_updates: Generated<boolean>;
  require_manager_approval: Generated<boolean>;
  require_sms_verification: Generated<boolean>;
  allow_pending_unverified: Generated<boolean>;
  allow_shared_family_phones: Generated<boolean>;
  customer_app_self_service: Generated<boolean>;
  require_reauthentication: Generated<boolean>;
  notify_old_number: Generated<boolean>;
  allow_manual_confirmation: Generated<boolean>;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailyBookingSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  bookings: Generated<number>;
  completed: Generated<number>;
  cancelled: Generated<number>;
  no_show: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailyCustomerSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  new_customers: Generated<number>;
  returning_customers: Generated<number>;
  active_customers: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailyReviewSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  rating_sum: Generated<number>;
  rating_count: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailySalesSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  revenue_cents: Generated<number>;
  refunds_cents: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailyServiceSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  service_id: string;
  revenue_cents: Generated<number>;
  service_count: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantDailyTechnicianSummaryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  summary_date: ColumnType<string, string, string>;
  technician_id: string;
  revenue_cents: Generated<number>;
  completed_services: Generated<number>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantFeatureFlagsTable {
  tenant_id: string;
  feature: string;
  enabled: Generated<boolean>;
}
export interface TenantFeatureOverridesTable {
  id: Generated<string>;
  tenant_id: string;
  feature_key: string;
  state: string;
  reason: string | null;
  effective_from: Ts;
  expires_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantIncentivesTable {
  id: Generated<string>;
  agreement_id: string | null;
  tenant_id: string;
  branch_id: string | null;
  accounting_period_id: string | null;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  currency: Generated<string>;
  eligible_gross_revenue_cents: Generated<number>;
  salon_pct: number | null;
  incentive_earned_cents: Generated<number>;
  refund_allocation_cents: Generated<number>;
  adjustment_allocation_cents: Generated<number>;
  prior_unpaid_balance_cents: Generated<number>;
  amount_paid_cents: Generated<number>;
  current_amount_due_cents: Generated<number>;
  status: Generated<string>;
  idempotency_key: string;
  calc_snapshot: unknown | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: TsNull;
  created_at: Ts;
}
export interface TenantLocationHoursTable {
  id: Generated<string>;
  tenant_id: string;
  location_id: string;
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: Generated<boolean>;
  effective_from: ColumnType<string | null, string | null, string | null>;
  effective_to: ColumnType<string | null, string | null, string | null>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantLocationMapHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  location_id: string;
  previous_latitude: number | null;
  previous_longitude: number | null;
  new_latitude: number | null;
  new_longitude: number | null;
  previous_address: string | null;
  new_address: string | null;
  changed_by: string | null;
  change_source: string | null;
  change_reason: string | null;
  created_at: Ts;
}
export interface BookingDepositsTable {   // migration 669 (D11, Oct 21 2026): a booking deposit, card-on-file, through the ONE payment domain
  id: Generated<string>; tenant_id: string; branch_id: string; appointment_id: string; customer_id: string | null;
  amount_cents: number; status: Generated<string>;
  processor_type: string | null; processor_transaction_id: string | null; card_profile_id: string | null; card_last4: string | null; captured_at: TsNull;
  refundable_until: TsNull; forfeit_on_no_show: Generated<boolean>;
  applied_ticket_id: string | null; applied_payment_id: string | null; applied_cents: number | null; refund_transaction_id: string | null; refunded_cents: number | null;
  ended_reason: string | null; failure_reason: string | null; idempotency_key: string | null;
  created_at: Ts; updated_at: Ts; updated_by: string | null;
}
export interface TenantMessagingCredentialsTable {
  id: Generated<string>;
  tenant_id: string;
  provider: Generated<string>;
  account_sid: string | null;
  auth_token_enc: string | null;
  auth_token_last4: string | null;
  from_number: string | null;
  status: Generated<string>;
  updated_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  verify_service_sid: string | null;
  branch_id: string | null;
  last_validated_at: TsNull;
  last_validation_error: string | null;
  api_key_sid: string | null;   // migration 521
  api_key_secret_enc: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 639 (wave 3 PAYI §58 / §60 / §168): the TenantMessagingIntegration
  account_mode: Generated<string>;        // 'platform_managed' | 'tenant_owned'
  messaging_service_sid: string | null;   // MG… — sends name it instead of a bare From when set
  config_version: Generated<number>;
  provisioning_step: string | null;          // migration 668 (B-16): subaccount | messaging_service | number | done | offboarded (705)
  offboarded_at: Ts | null; offboarding_error: string | null;   // migration 705 (§149 offboarding)
  provisioning_error: string | null;
  provisioning_claimed_at: Ts | null;
  provisioned_at: Ts | null;
}
export interface TenantMessagingLimitsTable {
  tenant_id: string;
  monthly_sms: number | null;
  monthly_email: number | null;
  monthly_push: number | null;
  daily_limit: number | null;
  enforcement: Generated<string>;
  opt_out_rate_threshold_bps: number | null;
  failure_rate_threshold_bps: number | null;
  status: Generated<string>;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface TenantMessagingNumbersTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  phone_number: string;
  channel: Generated<string>;
  provider: Generated<string>;
  created_at: Ts;
  // migration 639 (wave 3 PAYI §59): the tenant phone-number registry
  provider_phone_number_sid: string | null;   // PN…
  purpose: Generated<string>;                 // general_sms | booking | marketing | voice
  status: Generated<string>;                  // pending | active | suspended | released
  released_at: TsNull;
  updated_at: TsNull;
  updated_by: string | null;                  // migration 641 (actor stamp)
}
export interface TenantPlanLimitOverridesTable {
  id: Generated<string>;
  tenant_id: string;
  metric: string;
  limit_value: number | null;
  enforcement: Generated<string>;
  reason: string | null;
  effective_from: Ts;
  expires_at: TsNull;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantPresetsTable {
  id: Generated<string>;
  name: string;
  scope: Generated<string>;
  category_slug: string | null;
  description: string | null;
  settings: Generated<unknown>;
  active: Generated<boolean>;
  is_default: Generated<boolean>;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
}
export interface TenantPrivateIncidentsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; visibility: Generated<string>; category: string; severity: Generated<string>; occurred_on: string | null; raw_detail: string | null; customer_ref: string | null; advisory_post_id: string | null; created_by_user_id: string; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TenantPromotionRedemptionsTable {
  id: Generated<string>;
  promotion_id: string;
  tenant_id: string;
  branch_id: string | null;
  customer_id: string | null;
  ticket_id: string | null;
  checkout_id: string | null;
  eligible_subtotal_cents: Generated<number>;
  discount_cents: Generated<number>;
  final_subtotal_cents: Generated<number>;
  currency: Generated<string>;
  status: Generated<string>;
  idempotency_key: string;
  rule_version: Generated<number>;
  redeemed_at: Ts;
  reversed_at: TsNull;
  reversal_reason: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantPromotionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  owner_type: Generated<string>;
  name: string;
  promotion_type: string;
  discount_value: Generated<number>;
  max_discount_cents: number | null;
  min_purchase_cents: Generated<number>;
  currency: Generated<string>;
  start_at: TsNull;
  end_at: TsNull;
  customer_limit: Generated<number>;
  branch_limit: Generated<number>;
  tenant_limit: Generated<number>;
  global_limit: Generated<number>;
  stacking_policy: Generated<string>;
  approval_required: Generated<boolean>;
  approval_status: Generated<string>;
  status: Generated<string>;
  disabled_at: TsNull;
  disabled_reason: string | null;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  decision_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantRolePermissionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  role: string;
  permission: string;
  allowed: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantTapToPayOnboardingTable {
  tenant_id: string;
  apple_entitlement_status: Generated<string>;
  commercehub_status: Generated<string>;
  notes: string | null;
  updated_by: string | null;
  updated_at: Ts;
  created_at: Ts;
}
export interface TenantTrialsTable {
  id: Generated<string>;
  tenant_id: string;
  trial_definition_id: string;
  started_at: Ts;
  ends_at: Ts;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantWarningsTable {
  id: Generated<string>;
  tenant_id: string;
  actor_user_id: string | null;
  warning_type: Generated<string>;
  severity: Generated<string>;
  subject: string;
  message: string;
  send_email: Generated<boolean>;
  send_sms: Generated<boolean>;
  show_in_tenant_dashboard: Generated<boolean>;
  internal_note: string | null;
  delivery_status: Generated<string>;
  created_at: Ts;
}
export interface TrialDefinitionsTable {
  id: Generated<string>;
  code: string;
  name: string;
  plan_id: string | null;
  duration_days: number;
  payment_required: Generated<boolean>;
  conversion_plan_id: string | null;
  expiration_behavior: Generated<string>;
  status: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
}
export interface UnmatchedCustomerRecordsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  display_name: string | null;
  normalized_phone: string | null;
  normalized_email: string | null;
  source: string | null;
  possible_matches: Generated<number>;
  review_state: Generated<string>;
  resolution: string | null;
  reviewer_user_id: string | null;
  last_contact_at: TsNull;
  created_at: Ts;
}
export interface UsageCountersTable {
  id: Generated<string>;
  tenant_id: string;
  metric: string;
  billing_period: string;
  used_value: Generated<number>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UserAvatarsTable {
  tenant_id: string;
  user_id: string;
  data_url: string;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UserInvitationsTable {
  platform_role: string | null;   // Constitution 7 §24 (migration 468)
  id: Generated<string>;
  tenant_id: string | null;
  branch_id: string | null;
  email: string | null;
  role: string;
  invited_by_user_id: string | null;
  token_hash: string;
  token_prefix: string;
  status: Generated<string>;
  delivery_channel: string | null;
  delivery_status: Generated<string>;
  delivery_error: string | null;
  send_count: Generated<number>;
  last_sent_at: TsNull;
  expires_at: Ts;
  accepted_at: TsNull;
  accepted_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  normalized_phone: string | null;
  user_id: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UserLoginAlertPrefsTable {
  tenant_id: string;
  user_id: string;
  enabled: Generated<boolean>;
  new_device: Generated<boolean>;
  new_location: Generated<boolean>;
  password_changed: Generated<boolean>;
  email_changed: Generated<boolean>;
  phone_changed: Generated<boolean>;
  twofa_changed: Generated<boolean>;
  recovery_codes_changed: Generated<boolean>;
  session_revoked: Generated<boolean>;
  suspicious_blocked: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UserNotificationPrefsTable {
  tenant_id: string;
  user_id: string;
  sms_notifications: Generated<boolean>;
  email_notifications: Generated<boolean>;
  push_notifications: Generated<boolean>;
  missed_call_alerts: Generated<boolean>;
  booking_alerts: Generated<boolean>;
  low_stock_alerts: Generated<boolean>;
  payroll_approvals: Generated<boolean>;
  weekly_report_summaries: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UserPermissionsTable {
  user_id: string;
  permission_id: string;
  granted: Generated<boolean>;
}
export interface UserRolesTable {
  user_id: string;
  role_id: string;
}
export interface UserUiPrefsTable {
  tenant_id: string;
  user_id: string;
  default_landing: Generated<string>;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface UtilizationSnapshotsTable {
  id: Generated<string>;
  captured_on: ColumnType<string, string, string>;
  tenants: Generated<number>;
  tenants_near: Generated<number>;
  tenants_over: Generated<number>;
  avg_max_pct: Generated<number>;
  created_at: Ts;
}
export interface VideoProgressTable {
  id: Generated<string>;
  video_id: string;
  tenant_id: string;
  user_id: string;
  position_seconds: Generated<number>;
  completed: Generated<boolean>;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface VideoTutorialsTable {
  id: Generated<string>;
  category_id: string | null;
  slug: string;
  title: string;
  description: string | null;
  duration_seconds: Generated<number>;
  thumbnail_url: string | null;
  video_url: string | null;
  captions_url: string | null;
  transcript: string | null;
  status: Generated<string>;
  roles: Generated<string[]>;
  view_count: Generated<number>;
  published_at: TsNull;
  created_at: Ts;
}
export interface VoiceCallOutcomesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  provider: Generated<string>;
  provider_call_id: string;
  prompt_version: string | null;
  started_at: TsNull;
  ended_at: TsNull;
  duration_seconds: number | null;
  language: string | null;
  intents: Generated<unknown>;
  tool_calls: Generated<unknown>;
  booking_outcome: string | null;
  handoff_outcome: string | null;
  sentiment: string | null;
  error_category: string | null;
  interruption_count: Generated<number>;
  repeated_question_count: Generated<number>;
  abandoned: Generated<boolean>;
  follow_up_required: Generated<boolean>;
  summary: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  last_event_at: TsNull;   // migration 755 — AI Calls: provider event time / sync facts
  last_synced_at: TsNull;
  agent_ref: string | null;
  disconnection_reason: string | null;
  direction: string | null;
}
export interface VoiceImprovementSuggestionsTable {
  id: Generated<string>;
  tenant_id: string;
  source_call_id: string | null;
  category: string;
  target_type: string;
  detail: string;
  status: Generated<string>;
  reviewed_by: string | null;
  resulting_version_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface VoiceIntegrationKeysTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  label: string;
  provider: Generated<string>;
  prefix: string;
  secret_hash: string;
  last_used_at: TsNull;
  expires_at: TsNull;
  revoked_at: TsNull;
  created_by_user_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface VoicePromptVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  scope: Generated<string>;
  version_label: string;
  body: string;
  status: Generated<string>;
  parent_version_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  activated_at: TsNull;
  created_at: Ts;
  updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface WorkerCrossTenantTransferRequestsTable {
  id: Generated<string>;
  user_id: string;
  from_tenant_id: string | null;
  to_tenant_id: string;
  to_branch_id: string | null;
  effective_date: ColumnType<string | null, string | null, string | null>;
  status: Generated<string>;
  reason: string;
  requested_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: TsNull;
  decision_note: string | null;
  created_at: Ts;
  updated_at: Ts;
}

export interface SchedulerRunsTable {
  name: string;
  lease_owner: string | null;
  lease_until: Date | null;
  last_started_at: Date | null;
  last_finished_at: Date | null;
  last_outcome: string | null;
  last_error: string | null;
  runs: Generated<number>;
  failures: Generated<number>;
  skipped: Generated<number>;
  every_ms: number | null;
  updated_at: Generated<Date>;
}

export interface JobsTable {
  id: Generated<string>;
  job_class: string;
  job_type: string;
  tenant_id: string | null;
  priority: Generated<number>;
  payload: Generated<unknown>;
  idempotency_key: string | null;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Generated<Date>;
  lease_owner: string | null;
  lease_until: Date | null;
  last_error: string | null;
  result: unknown | null;
  correlation_id: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  traceparent: string | null;   // migration 548 (Phase 11 tracing)
}

export interface DB {
  ai_control_modes: AiControlModesTable;
  workflow_runs: WorkflowRunsTable;
  ai_revenue_attributions: AiRevenueAttributionsTable;
  call_intelligence_events: CallIntelligenceEventsTable;
  pos_kpi_daily_snapshots: PosKpiDailySnapshotsTable;
  payment_intents: PaymentIntentsTable;
  cash_payment_confirmations: CashPaymentConfirmationsTable;
  tech_cash_handoffs: TechCashHandoffsTable;
  cash_drawer_sessions: CashDrawerSessionsTable;
  cash_drawer_movements: CashDrawerMovementsTable;
  account_deletion_requests: AccountDeletionRequestsTable;
  skip_line_checkout_settings: SkipLineCheckoutSettingsTable;
  hardware_card_volume: HardwareCardVolumeTable;
  hardware_payment_plans: HardwarePaymentPlansTable;
  hardware_revenue_split_settings: HardwareRevenueSplitSettingsTable;
  hardware_payment_invoices: HardwarePaymentInvoicesTable;
  hardware_payment_ledger: HardwarePaymentLedgerTable;
  hardware_payment_methods: HardwarePaymentMethodsTable;
  hardware_autopay_consents: HardwareAutopayConsentsTable;
  hardware_payment_transactions: HardwarePaymentTransactionsTable;
  hardware_reconciliation_runs: HardwareReconciliationRunsTable;
  tenant_applications: TenantApplicationsTable;
  website_leads: WebsiteLeadsTable;
  hardware_packages: HardwarePackagesTable;
  support_access_sessions: SupportAccessSessionsTable;
  support_ticket_attachments: SupportTicketAttachmentsTable;
  owner_alerts: OwnerAlertsTable;
  owner_audit_log: OwnerAuditLogTable;
  audit_events: AuditEventsTable;
  campaigns: CampaignsTable;
  campaign_recipients: CampaignRecipientsTable;
  campaign_health_runs: CampaignHealthRunsTable;
  communication_threads: CommunicationThreadsTable;
  communication_messages: CommunicationMessagesTable;
  payroll_periods: PayrollPeriodsTable;
  payroll_lines: PayrollLinesTable;
  expenses: ExpensesTable;
  expense_categories: ExpenseCategoriesTable;
  expense_category_rules: ExpenseCategoryRulesTable;
  expense_line_items: ExpenseLineItemsTable;
  expense_allocations: ExpenseAllocationsTable;
  expense_documents: ExpenseDocumentsTable;
  expense_bill_payments: ExpenseBillPaymentsTable;
  expense_history: ExpenseHistoryTable;
  expense_settings: ExpenseSettingsTable;
  payments: PaymentsTable;
  payment_signatures: PaymentSignaturesTable;
  payment_attempts: PaymentAttemptsTable;
  technician_blocked_times: TechnicianBlockedTimesTable;
  tickets: TicketsTable;
  ticket_number_counters: TicketNumberCountersTable;
  ticket_service_lines: TicketServiceLinesTable;
  ticket_change_requests: TicketChangeRequestsTable;
  reviews: ReviewsTable;
  pos_queue_items: PosQueueItemsTable;
  technician_shifts: TechnicianShiftsTable;
  technician_statuses: TechnicianStatusesTable;
  inventory_items: InventoryItemsTable;
  bundles: BundlesTable;
  bundle_items: BundleItemsTable;
  membership_plans: MembershipPlansTable;
  membership_plan_versions: MembershipPlanVersionsTable;
  membership_benefits: MembershipBenefitsTable;
  customer_memberships: CustomerMembershipsTable;
  membership_credit_ledger: MembershipCreditLedgerTable;
  membership_payments: MembershipPaymentsTable;
  membership_redemptions: MembershipRedemptionsTable;
  membership_activity: MembershipActivityTable;
  membership_audit: MembershipAuditTable;
  technicians: TechniciansTable;
  technician_clock_pins: TechnicianClockPinsTable;
  technician_timecard_adjustments: TechnicianTimecardAdjustmentsTable;
  technician_help_requests: TechnicianHelpRequestsTable;
  service_categories: ServiceCategoriesTable;
  services: ServicesCatalogTable;
  technician_services: TechnicianServicesTable;
  customers: CustomersTable;
  customer_loyalty_profiles: CustomerLoyaltyProfilesTable;
  customer_preferences: CustomerPreferencesTable;
  receipts: ReceiptsTable;
  technician_schedules: TechnicianSchedulesTable;
  pos_tech_appointments: PosTechAppointmentsTable;
  ticket_compensation_snapshots: TicketCompensationSnapshotsTable;
  compensation_adjustments: CompensationAdjustmentsTable;
  compensation_policies: CompensationPoliciesTable;
  compensation_policy_versions: CompensationPolicyVersionsTable;
  technician_tier_plans: TechnicianTierPlansTable;
  bonus_rules: BonusRulesTable;
  technician_classifications: TechnicianClassificationsTable;
  compensation_agreements: CompensationAgreementsTable;
  technician_guarantee_policies: TechnicianGuaranteePoliciesTable;
  pos_tech_queue_tickets: PosTechQueueTicketsTable;
  customer_display_devices: CustomerDisplayDevicesTable;
  customer_display_pairings: CustomerDisplayPairingsTable;
  pos_stations: PosStationsTable;
  display_ad_media: DisplayAdMediaTable;
  display_ads: DisplayAdsTable;
  display_ad_branches: DisplayAdBranchesTable;
  display_ad_device_settings: DisplayAdDeviceSettingsTable;
  display_ad_display_stats: DisplayAdDisplayStatsTable;
  display_ad_report_batches: DisplayAdReportBatchesTable;
  customer_display_sessions: CustomerDisplaySessionsTable;
  pos_payment_terminals: PosPaymentTerminalsTable;
  tenant_settings: TenantSettingsTable;
  settings_audit_logs: SettingsAuditLogsTable;
  technician_audit_logs: TechnicianAuditLogsTable;
  ticket_tip_allocations: TicketTipAllocationsTable;
  technician_skill_change_requests: TechnicianSkillChangeRequestsTable;
  tenants: TenantsTable;
  branches: BranchesTable;
  tenant_api_keys: TenantApiKeysTable;
  tenant_webhooks: TenantWebhooksTable;
  tenant_deployments: TenantDeploymentsTable;
  tenant_event_logs: TenantEventLogsTable;
  tenant_webhook_deliveries: TenantWebhookDeliveriesTable;
  users: UsersTable;
  tenant_subscriptions: TenantSubscriptionsTable;
  tenant_payment_config: TenantPaymentConfigTable;
  payment_merchant_accounts: PaymentMerchantAccountsTable;
  payment_gateway_events: PaymentGatewayEventsTable;
  payment_refunds: PaymentRefundsTable;
  payment_settlements: PaymentSettlementsTable;
  payment_terminal_leases: PaymentTerminalLeasesTable;
  customer_duplicate_decisions: CustomerDuplicateDecisionsTable;
  customer_duplicate_events: CustomerDuplicateEventsTable;
  customer_duplicate_groups: CustomerDuplicateGroupsTable;
  customer_duplicate_health_runs: CustomerDuplicateHealthRunsTable;
  customer_duplicate_merge_ops: CustomerDuplicateMergeOpsTable;
  customer_duplicate_scans: CustomerDuplicateScansTable;
  staff_role_assignments: StaffRoleAssignmentsTable;
  tenant_custom_roles: TenantCustomRolesTable;
  chargebacks: ChargebacksTable;
  tenant_hardware_payoff: TenantHardwarePayoffTable;
  tenant_ai_packages: TenantAiPackagesTable;
  tenant_ai_features: TenantAiFeaturesTable;
  tenant_app_flags: TenantAppFlagsTable;
  customer_favorite_salons: CustomerFavoriteSalonsTable;
  technician_notifications: TechnicianNotificationsTable;
  customer_favorite_techs: CustomerFavoriteTechsTable;
  user_branch_access: UserBranchAccessTable;
  technician_permissions: TechnicianPermissionsTable;
  commission_change_audit_logs: CommissionChangeAuditLogsTable;
  admin_commission_auth_codes: AdminCommissionAuthCodesTable;
  technician_app_settings: TechnicianAppSettingsTable;
  technician_skills: TechnicianSkillsTable;
  customer_tags: CustomerTagsTable;
  global_tech_profiles: GlobalTechProfilesTable;
  global_tech_delete_requests: GlobalTechDeleteRequestsTable;
  tech_salon_memberships: TechSalonMembershipsTable;
  tech_portfolio_photos: TechPortfolioPhotosTable;
  nail_photo_consent: NailPhotoConsentTable;
  before_after_sets: BeforeAfterSetsTable;
  ticket_revisions: TicketRevisionsTable;
  ticket_deletion_codes: TicketDeletionCodesTable;
  checkout_locks: CheckoutLocksTable;
  onboarding_records: OnboardingRecordsTable;
  onboarding_stage_history: OnboardingStageHistoryTable;
  onboarding_approvals: OnboardingApprovalsTable;
  onboarding_documents: OnboardingDocumentsTable;
  onboarding_notes: OnboardingNotesTable;
  platform_request_metrics: PlatformRequestMetricsTable;
  platform_request_metrics_minute: PlatformRequestMetricsMinuteTable;
  super_admin_report_definitions: SuperAdminReportDefinitionsTable;
  super_admin_scheduled_reports: SuperAdminScheduledReportsTable;
  super_admin_scheduled_report_runs: SuperAdminScheduledReportRunsTable;
  branch_transfer_requests: BranchTransferRequestsTable;
  worker_transfer_requests: WorkerTransferRequestsTable;
  tenant_usage_limits: TenantUsageLimitsTable;
  sessions: SessionsTable;
  refresh_tokens: RefreshTokensTable;
  webauthn_credentials: WebauthnCredentialsTable;
  webauthn_challenges: WebauthnChallengesTable;
  password_reset_tokens: PasswordResetTokensTable;
  mfa_factors: MfaFactorsTable;
  mfa_recovery_codes: MfaRecoveryCodesTable;
  auth_devices: AuthDevicesTable;
  platform_device_approvals: PlatformDeviceApprovalsTable;
  auth_events: AuthEventsTable;
  tenant_api_key_uses: TenantApiKeyUsesTable;
  security_not_me_tokens: SecurityNotMeTokensTable;
  oauth_clients: OauthClientsTable;
  oauth_grants: OauthGrantsTable;
  api_idempotency: ApiIdempotencyTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
  global_customers: GlobalCustomersTable;
  customer_global_links: CustomerGlobalLinksTable;
  customer_recon_runs: CustomerReconRunsTable;
  customer_recon_tenant_stats: CustomerReconTenantStatsTable;
  customer_identity_conflicts: CustomerIdentityConflictsTable;
  security_audit_runs: SecurityAuditRunsTable;
  security_audit_findings: SecurityAuditFindingsTable;
  gift_cards: GiftCardsTable;
  salon_promotions: SalonPromotionsTable;
  ai_marketing_campaign_sends: AiMarketingCampaignSendsTable;
  ai_marketing_campaign_plans: AiMarketingCampaignPlansTable;
  money_protection_alerts: MoneyProtectionAlertsTable;
  money_protection_investigations: MoneyProtectionInvestigationsTable;
  money_protection_investigation_notes: MoneyProtectionInvestigationNotesTable;
  money_protection_rule_settings: MoneyProtectionRuleSettingsTable;
  call_consent_records: CallConsentRecordsTable;
  call_transcripts: CallTranscriptsTable;
  call_transcript_segments: CallTranscriptSegmentsTable;
  call_redaction_events: CallRedactionEventsTable;
  call_transcript_intelligence: CallTranscriptIntelligenceTable;
  call_deletion_events: CallDeletionEventsTable;
  voice_transcription_settings: VoiceTranscriptionSettingsTable;
  gift_card_transactions: GiftCardTransactionsTable;
  gift_card_programs: GiftCardProgramsTable;
  gift_card_clearing_entries: GiftCardClearingEntriesTable;
  gift_card_settlement_batches: GiftCardSettlementBatchesTable;
  gift_card_stock: GiftCardStockTable;
  gift_card_program_members: GiftCardProgramMembersTable;
  gift_card_designs: GiftCardDesignsTable;
  gift_card_recipients: GiftCardRecipientsTable;
  gift_card_deliveries: GiftCardDeliveriesTable;
  gift_card_claim_tokens: GiftCardClaimTokensTable;
  gift_card_presentation_tokens: GiftCardPresentationTokensTable;
  gift_card_redemption_holds: GiftCardRedemptionHoldsTable;
  gift_card_fraud_flags: GiftCardFraudFlagsTable;
  gift_card_adjustments: GiftCardAdjustmentsTable;
  customer_wallet_ledger: CustomerWalletLedgerTable;
  wallet_topup_intents: WalletTopupIntentsTable;   // migration 679 (B-79: durable top-up intents)
  customer_notifications: CustomerNotificationsTable;
  customer_addresses: CustomerAddressesTable;
  customer_deals: CustomerDealsTable;
  customer_referrals: CustomerReferralsTable;
  customer_payment_methods: CustomerPaymentMethodsTable;
  loyalty_rewards: LoyaltyRewardsTable;
  loyalty_redemptions: LoyaltyRedemptionsTable;
  loyalty_ledger: LoyaltyLedgerTable;
  customer_phone_verifications: CustomerPhoneVerificationsTable;
  nail_showcase_posts: NailShowcasePostsTable;
  nail_showcase_photos: NailShowcasePhotosTable;
  nail_showcase_reactions: NailShowcaseReactionsTable;
  nail_showcase_comments: NailShowcaseCommentsTable;
  nail_showcase_reports: NailShowcaseReportsTable;
  customer_social_profiles: CustomerSocialProfilesTable;
  customer_follows: CustomerFollowsTable;
  customer_blocks: CustomerBlocksTable;
  nail_showcase_customer_score_snapshots: NailShowcaseCustomerScoreSnapshotsTable;
  service_follow_up_tasks: ServiceFollowUpTasksTable;
  daily_follow_up_generation_runs: DailyFollowUpGenerationRunsTable;
  daily_follow_up_settings: DailyFollowUpSettingsTable;
  device_push_tokens: DevicePushTokensTable;
  notification_delivery_logs: NotificationDeliveryLogsTable;
  go_checkin_devices: GoCheckinDevicesTable;
  go_checkin_sessions: GoCheckinSessionsTable;
  go_checkin_logs: GoCheckinLogsTable;
  tenant_checkin_settings: TenantCheckinSettingsTable;
  ai_business_saved_questions: AiBusinessSavedQuestionsTable;
  ai_business_alerts: AiBusinessAlertsTable;
  ai_business_report_jobs: AiBusinessReportJobsTable;
  schedule_optimization_runs: ScheduleOptimizationRunsTable;
  time_clock_break_policies: TimeClockBreakPoliciesTable;
  technician_turn_events: TechnicianTurnEventsTable;
  technician_turn_state: TechnicianTurnStateTable;
  turn_unit_rules: TurnUnitRulesTable;
  compensation_deduction_types: CompensationDeductionTypesTable;
  technician_pay_plans: TechnicianPayPlansTable;
  payroll_inquiries: PayrollInquiriesTable;
  compensation_exceptions: CompensationExceptionsTable;
  payroll_exports: PayrollExportsTable;
  payroll_payouts: PayrollPayoutsTable;
  payroll_schedules: PayrollSchedulesTable;
  payroll_statement_counters: PayrollStatementCountersTable;
  payroll_statements: PayrollStatementsTable;
  platform_notices: PlatformNoticesTable;   // 674 Platform Announcements (POS top bar)
  platform_notice_targets: PlatformNoticeTargetsTable;
  platform_notice_receipts: PlatformNoticeReceiptsTable;
  platform_notice_revisions: PlatformNoticeRevisionsTable;
  payroll_payout_plans: PayrollPayoutPlansTable;
  payroll_payout_instructions: PayrollPayoutInstructionsTable;
  ticket_service_line_allocations: TicketServiceLineAllocationsTable;
  ticket_service_sessions: TicketServiceSessionsTable;
  technician_certification_reminders: TechnicianCertificationRemindersTable;
  technician_certifications: TechnicianCertificationsTable;
  technician_breaks: TechnicianBreaksTable;
  technician_workforce_state: TechnicianWorkforceStateTable;
  nail_showcase_tenant_policy: NailShowcaseTenantPolicyTable;
  technician_employment_events: TechnicianEmploymentEventsTable;   // 646
  technician_profile_tenant_policy: TechnicianProfileTenantPolicyTable;   // 646
  tech_profile_change_requests: TechProfileChangeRequestsTable;   // 646
  technician_import_runs: TechnicianImportRunsTable;   // 646
  tech_portfolio_photo_tenant_hides: TechPortfolioPhotoTenantHidesTable;
  process_heartbeats: ProcessHeartbeatsTable;
  branch_health_snapshots: BranchHealthSnapshotsTable;
  observability_signal_state: ObservabilitySignalStateTable;
  synthetic_probe_results: SyntheticProbeResultsTable;
  synthetic_monitoring_settings: SyntheticMonitoringSettingsTable;
  slo_validations: SloValidationsTable;
  alert_escalations: AlertEscalationsTable;
  oncall_contacts: OncallContactsTable;
  telemetry_spans: TelemetrySpansTable;
  telemetry_log_events: TelemetryLogEventsTable;
  code_lookup_attempts: CodeLookupAttemptsTable;
  realtime_stream_tickets: RealtimeStreamTicketsTable;
  device_biometric_credentials: DeviceBiometricCredentialsTable;
  mobile_app_installs_seen: MobileAppInstallsSeenTable;
  mobile_app_versions: MobileAppVersionsTable;
  api_operations: ApiOperationsTable;
  tenant_load_minute: TenantLoadMinuteTable;
  tenant_storage_usage: TenantStorageUsageTable;
  tenant_quotas: TenantQuotasTable;
  plan_quota_defaults: PlanQuotaDefaultsTable;
  platform_flag_rollouts: PlatformFlagRolloutsTable;
  db_slow_query_samples: DbSlowQuerySamplesTable;
  db_table_size_snapshots: DbTableSizeSnapshotsTable;
  schema_backfills: SchemaBackfillsTable;
  schema_deferred_constraints: SchemaDeferredConstraintsTable;
  export_snapshots: ExportSnapshotsTable;
  dormant_account_alerts: DormantAccountAlertsTable;
  access_review_items: AccessReviewItemsTable;
  access_reviews: AccessReviewsTable;
  tenant_approval_request_events: TenantApprovalRequestEventsTable;
  tenant_approval_requests: TenantApprovalRequestsTable;
  tenant_approval_policy_changes: TenantApprovalPolicyChangesTable;
  tenant_approval_policies: TenantApprovalPoliciesTable;
  authorization_denials: AuthorizationDenialsTable;
  authorization_audit_events: AuthorizationAuditEventsTable;
  tenant_user_permission_overrides: TenantUserPermissionOverridesTable;
  community_similar_experiences: CommunitySimilarExperiencesTable;
  community_rules_acknowledgments: CommunityRulesAcknowledgmentsTable;
  community_restrictions: CommunityRestrictionsTable;
  community_related_posts: CommunityRelatedPostsTable;
  community_redactions: CommunityRedactionsTable;
  community_post_updates: CommunityPostUpdatesTable;
  community_post_follows: CommunityPostFollowsTable;
  community_evidence_access_log: CommunityEvidenceAccessLogTable;
  community_comment_versions: CommunityCommentVersionsTable;
  community_comment_reports: CommunityCommentReportsTable;
  service_scheduling_profiles: ServiceSchedulingProfilesTable;
  appointment_schedule_locks: AppointmentScheduleLocksTable;
  technician_time_off: TechnicianTimeOffTable;
  schedule_optimization_recommendations: ScheduleOptimizationRecommendationsTable;
  schedule_recommendation_impacts: ScheduleRecommendationImpactsTable;
  schedule_recommendation_decisions: ScheduleRecommendationDecisionsTable;
  schedule_change_proposals: ScheduleChangeProposalsTable;
  schedule_change_applications: ScheduleChangeApplicationsTable;
  service_duration_statistics: ServiceDurationStatisticsTable;
  service_duration_recommendations: ServiceDurationRecommendationsTable;
  staffing_coverage_recommendations: StaffingCoverageRecommendationsTable;
  appointment_availability_recommendations: AppointmentAvailabilityRecommendationsTable;
  schedule_conflicts: ScheduleConflictsTable;
  schedule_gaps: ScheduleGapsTable;
  tenant_scheduling_ai_settings: TenantSchedulingAiSettingsTable;
  scheduling_rule_versions: SchedulingRuleVersionsTable;
  ocr_documents: OcrDocumentsTable;
  ocr_document_files: OcrDocumentFilesTable;
  ocr_document_pages: OcrDocumentPagesTable;
  ocr_jobs: OcrJobsTable;
  ocr_extracted_fields: OcrExtractedFieldsTable;
  ocr_line_items: OcrLineItemsTable;
  ocr_validation_results: OcrValidationResultsTable;
  ocr_duplicate_matches: OcrDuplicateMatchesTable;
  ocr_vendor_matches: OcrVendorMatchesTable;
  ocr_category_suggestions: OcrCategorySuggestionsTable;
  ocr_inventory_matches: OcrInventoryMatchesTable;
  ocr_reviews: OcrReviewsTable;
  ocr_approvals: OcrApprovalsTable;
  ocr_postings: OcrPostingsTable;
  ocr_posting_attempts: OcrPostingAttemptsTable;
  tenant_ocr_ai_settings: TenantOcrAiSettingsTable;
  ocr_ai_config_versions: OcrAiConfigVersionsTable;
  integration_connections: IntegrationConnectionsTable;
  integration_credential_references: IntegrationCredentialReferencesTable;
  notification_opt_outs: NotificationOptOutsTable;
  notification_delivery_events: NotificationDeliveryEventsTable;
  notification_consent_events: NotificationConsentEventsTable;
  notification_retry_requests: NotificationRetryRequestsTable;
  email_send_keys: EmailSendKeysTable;
  email_health_checks: EmailHealthChecksTable;
  retention_health_runs: RetentionHealthRunsTable;
  tenant_birthday_settings: TenantBirthdaySettingsTable;
  birthday_message_claims: BirthdayMessageClaimsTable;
  review_analysis: ReviewAnalysisTable;
  review_response_drafts: ReviewResponseDraftsTable;
  review_response_versions: ReviewResponseVersionsTable;
  review_approvals: ReviewApprovalsTable;
  review_publications: ReviewPublicationsTable;
  review_escalations: ReviewEscalationsTable;
  review_internal_notes: ReviewInternalNotesTable;
  review_recovery_actions: ReviewRecoveryActionsTable;
  review_request_campaigns: ReviewRequestCampaignsTable;
  review_requests: ReviewRequestsTable;
  review_request_events: ReviewRequestEventsTable;
  review_reputation_health_runs: ReviewReputationHealthRunsTable;
  review_reputation_settings_health_runs: ReviewReputationSettingsHealthRunsTable;
  receipt_scanner_health_runs: ReceiptScannerHealthRunsTable;
  ai_usage_health_runs: AiUsageHealthRunsTable;
  scheduling_optimizer_health_runs: SchedulingOptimizerHealthRunsTable;
  ai_checkout_upsell_settings_history: AiCheckoutUpsellSettingsHistoryTable;
  checkout_upsell_health_runs: CheckoutUpsellHealthRunsTable;
  reputation_snapshots: ReputationSnapshotsTable;
  tenant_ai_reputation_settings: TenantAiReputationSettingsTable;
  ai_reputation_config_versions: AiReputationConfigVersionsTable;
  ai_customer_profile_settings: AiCustomerProfileSettingsTable;
  ai_customer_profile_settings_events: AiCustomerProfileSettingsEventsTable;
  customer_ai_settings_health_runs: CustomerAiSettingsHealthRunsTable;
  ai_checkout_upsell_settings: AiCheckoutUpsellSettingsTable;
  ai_checkout_upsell_recommendations: AiCheckoutUpsellRecommendationsTable;
  ai_checkout_upsell_dismissals: AiCheckoutUpsellDismissalsTable;
  ai_checkout_upsell_feedback: AiCheckoutUpsellFeedbackTable;
  invoices: InvoicesTable;
  invoice_lines: InvoiceLinesTable;
  service_add_ons: ServiceAddOnsTable;
  access_requests: AccessRequestsTable;
  ai_billing_events: AiBillingEventsTable;
  ai_booking_conversion_events: AiBookingConversionEventsTable;
  ai_booking_revoked_links: AiBookingRevokedLinksTable;
  ai_global_prompts: AiGlobalPromptsTable;
  ai_insights: AiInsightsTable;
  ai_insight_feedback: AiInsightFeedbackTable;
  ai_narrative_model_versions: AiNarrativeModelVersionsTable;
  ai_plan_settings: AiPlanSettingsTable;
  ai_providers: AiProvidersTable;
  ai_receptionist_agent_versions: AiReceptionistAgentVersionsTable;
  ai_receptionist_agents: AiReceptionistAgentsTable;
  ai_receptionist_faqs: AiReceptionistFaqsTable;
  ai_receptionist_faq_revisions: AiReceptionistFaqRevisionsTable;
  ai_receptionist_faq_events: AiReceptionistFaqEventsTable;
  ai_receptionist_control: AiReceptionistControlTable;
  ai_receptionist_control_events: AiReceptionistControlEventsTable;
  ai_receptionist_agent_events: AiReceptionistAgentEventsTable;
  ai_receptionist_health_runs: AiReceptionistHealthRunsTable;
  voice_call_events: VoiceCallEventsTable;
  voice_tool_executions: VoiceToolExecutionsTable;
  ai_calls_health_runs: AiCallsHealthRunsTable;
  ai_receptionist_actions: AiReceptionistActionsTable;
  ai_business_setup_preview_runs: AiBusinessSetupPreviewRunsTable;
  ai_receptionist_follow_ups: AiReceptionistFollowUpsTable;
  ai_handoff_events: AiHandoffEventsTable;
  ai_follow_up_activity: AiFollowUpActivityTable;
  ai_follow_up_contact_attempts: AiFollowUpContactAttemptsTable;
  ai_follow_up_escalations: AiFollowUpEscalationsTable;
  ai_follow_up_health_runs: AiFollowUpHealthRunsTable;
  ai_receptionist_handoffs: AiReceptionistHandoffsTable;
  ai_receptionist_provisioning_jobs: AiReceptionistProvisioningJobsTable;
  ai_receptionist_settings: AiReceptionistSettingsTable;
  ai_report_deliveries: AiReportDeliveriesTable;
  ai_report_narratives: AiReportNarrativesTable;
  ai_report_runs: AiReportRunsTable;
  ai_report_schedules: AiReportSchedulesTable;
  ai_report_templates: AiReportTemplatesTable;
  ai_support_conversations: AiSupportConversationsTable;
  ai_support_messages: AiSupportMessagesTable;
  ai_feedback: AiFeedbackTable;
  ai_price_versions: AiPriceVersionsTable;
  ai_knowledge_documents: AiKnowledgeDocumentsTable;
  ai_knowledge_chunks: AiKnowledgeChunksTable;
  ai_jobs: AiJobsTable;
  jobs: JobsTable;
  scheduler_runs: SchedulerRunsTable;
  ai_job_attempts: AiJobAttemptsTable;
  ai_budgets: AiBudgetsTable;
  ai_budget_alerts: AiBudgetAlertsTable;
  ai_prompt_versions: AiPromptVersionsTable;
  ai_prompt_rollbacks: AiPromptRollbacksTable;
  ai_usage_logs: AiUsageLogsTable;
  alert_notes: AlertNotesTable;
  alerts: AlertsTable;
  appointment_change_log: AppointmentChangeLogTable;
  appointment_reminder_attempts: AppointmentReminderAttemptsTable;
  appointment_reminders_sent: AppointmentRemindersSentTable;
  appointment_reminder_runs: AppointmentReminderRunsTable;
  appointment_reschedules: AppointmentReschedulesTable;
  appointment_waitlist: AppointmentWaitlistTable;
  audit_evidence_custody: AuditEvidenceCustodyTable;
  audit_evidence_packs: AuditEvidencePacksTable;
  audit_export_flags: AuditExportFlagsTable;
  audit_investigation_timeline: AuditInvestigationTimelineTable;
  audit_investigations: AuditInvestigationsTable;
  audit_legal_holds: AuditLegalHoldsTable;
  audit_logs: AuditLogsTable;
  audit_retention_policies: AuditRetentionPoliciesTable;
  audit_tamper_controls: AuditTamperControlsTable;
  automation_exceptions: AutomationExceptionsTable;
  automation_executions: AutomationExecutionsTable;
  automation_failures: AutomationFailuresTable;
  automation_rule_versions: AutomationRuleVersionsTable;
  automation_rules: AutomationRulesTable;
  bank_accounts: BankAccountsTable;
  bank_deposits: BankDepositsTable;
  bank_webhook_endpoints: BankWebhookEndpointsTable;
  billing_credits: BillingCreditsTable;
  billing_discounts: BillingDiscountsTable;
  billing_export_jobs: BillingExportJobsTable;
  billing_invoice_lines: BillingInvoiceLinesTable;
  billing_invoices: BillingInvoicesTable;
  billing_kpi_snapshots: BillingKpiSnapshotsTable;
  billing_payment_attempts: BillingPaymentAttemptsTable;
  billing_webhook_events: BillingWebhookEventsTable;
  booking_checkin_failed_events: BookingCheckinFailedEventsTable;
  booking_checkin_retry_attempts: BookingCheckinRetryAttemptsTable;
  booking_holds: BookingHoldsTable;
  booking_verification_platform_policy: BookingVerificationPlatformPolicyTable;
  booking_verification_sessions: BookingVerificationSessionsTable;
  booking_verification_settings: BookingVerificationSettingsTable;
  booking_verification_usage_daily: BookingVerificationUsageDailyTable;
  booking_verified_phones: BookingVerifiedPhonesTable;
  business_categories: BusinessCategoriesTable;
  campaign_compliance_flags: CampaignComplianceFlagsTable;
  campaign_delivery_failures: CampaignDeliveryFailuresTable;
  campaign_delivery_rollups: CampaignDeliveryRollupsTable;
  campaign_limits: CampaignLimitsTable;
  campaign_metric_snapshots: CampaignMetricSnapshotsTable;
  campaign_template_versions: CampaignTemplateVersionsTable;
  campaign_templates: CampaignTemplatesTable;
  checkout_settings: CheckoutSettingsTable;
  communication_providers: CommunicationProvidersTable;
  community_appeals: CommunityAppealsTable;
  community_comments: CommunityCommentsTable;
  community_disputes: CommunityDisputesTable;
  community_evidence: CommunityEvidenceTable;
  community_follows: CommunityFollowsTable;
  community_moderation_actions: CommunityModerationActionsTable;
  community_moderation_cases: CommunityModerationCasesTable;
  community_post_versions: CommunityPostVersionsTable;
  community_posts: CommunityPostsTable;
  community_reports: CommunityReportsTable;
  community_risk_fingerprints: CommunityRiskFingerprintsTable;
  customer_allergies: CustomerAllergiesTable;
  customer_deletion_requests: CustomerDeletionRequestsTable;
  customer_identities: CustomerIdentitiesTable;
  customer_identity_links: CustomerIdentityLinksTable;
  customer_import_jobs: CustomerImportJobsTable;
  customer_import_rows: CustomerImportRowsTable;
  customer_legal_holds: CustomerLegalHoldsTable;
  customer_merge_logs: CustomerMergeLogsTable;
  customer_phone_update_sessions: CustomerPhoneUpdateSessionsTable;
  customer_phones: CustomerPhonesTable;
  customer_privacy_requests: CustomerPrivacyRequestsTable;
  data_retention_purge_runs: DataRetentionPurgeRunsTable;
  data_retention_rules: DataRetentionRulesTable;
  deal_analytics_events: DealAnalyticsEventsTable;
  deal_approvals: DealApprovalsTable;
  deal_code_lookup_failures: DealCodeLookupFailuresTable;
  deal_coupon_batches: DealCouponBatchesTable;
  deal_coupon_codes: DealCouponCodesTable;
  deal_daily_stats: DealDailyStatsTable;
  deal_versions: DealVersionsTable;
  pos_queue_status_history: PosQueueStatusHistoryTable;
  queue_assignment_locks: QueueAssignmentLocksTable;
  queue_groups: QueueGroupsTable;
  queue_service_assignments: QueueServiceAssignmentsTable;
  queue_assignment_tenant_settings: QueueAssignmentTenantSettingsTable;
  queue_assignment_settings_versions: QueueAssignmentSettingsVersionsTable;
  deal_redemption_holds: DealRedemptionHoldsTable;
  deal_redemptions: DealRedemptionsTable;
  deal_saves: DealSavesTable;
  deal_services: DealServicesTable;
  deal_settings: DealSettingsTable;
  deals: DealsTable;
  device_catalog: DeviceCatalogTable;
  device_maintenance: DeviceMaintenanceTable;
  device_security_alerts: DeviceSecurityAlertsTable;
  device_sessions: DeviceSessionsTable;
  device_shipments: DeviceShipmentsTable;
  dispute_evidence: DisputeEvidenceTable;
  dispute_funds_events: DisputeFundsEventsTable;
  dispute_outcomes: DisputeOutcomesTable;
  dispute_status_events: DisputeStatusEventsTable;
  dispute_submissions: DisputeSubmissionsTable;
  dispute_tenant_notifications: DisputeTenantNotificationsTable;
  duplicate_checkin_candidates: DuplicateCheckinCandidatesTable;
  emergency_lockdown_events: EmergencyLockdownEventsTable;
  emergency_lockdowns: EmergencyLockdownsTable;
  fee_schedules: FeeSchedulesTable;
  forecast_points: ForecastPointsTable;
  grandfathered_assignments: GrandfatheredAssignmentsTable;
  hardware_package_devices: HardwarePackageDevicesTable;
  hardware_package_notes: HardwarePackageNotesTable;
  help_article_feedback: HelpArticleFeedbackTable;
  help_article_versions: HelpArticleVersionsTable;
  help_article_views: HelpArticleViewsTable;
  help_articles: HelpArticlesTable;
  help_categories: HelpCategoriesTable;
  integration_circuit_breakers: IntegrationCircuitBreakersTable;
  integration_oauth_states: IntegrationOauthStatesTable;
  integration_rate_limits: IntegrationRateLimitsTable;
  integration_sync_cursors: IntegrationSyncCursorsTable;
  integration_sync_jobs: IntegrationSyncJobsTable;
  integration_sync_records: IntegrationSyncRecordsTable;
  integration_webhook_events: IntegrationWebhookEventsTable;
  inventory_alerts: InventoryAlertsTable;
  inventory_brands: InventoryBrandsTable;
  inventory_categories: InventoryCategoriesTable;
  inventory_count_lines: InventoryCountLinesTable;
  inventory_counts: InventoryCountsTable;
  inventory_location_stock: InventoryLocationStockTable;
  inventory_products: InventoryProductsTable;
  inventory_service_recipe_lines: InventoryServiceRecipeLinesTable;
  inventory_service_recipes: InventoryServiceRecipesTable;
  inventory_stock_movements: InventoryStockMovementsTable;
  inventory_technician_reports: InventoryTechnicianReportsTable;
  inventory_transfer_lines: InventoryTransferLinesTable;
  inventory_transfers: InventoryTransfersTable;
  inventory_units: InventoryUnitsTable;
  inventory_vendors: InventoryVendorsTable;
  ip_block_rules: IpBlockRulesTable;
  lead_activities: LeadActivitiesTable;
  lead_follow_ups: LeadFollowUpsTable;
  legal_document_acceptances: LegalDocumentAcceptancesTable;
  legal_document_versions: LegalDocumentVersionsTable;
  login_attempts: LoginAttemptsTable;
  loyalty_calculation_corrections: LoyaltyCalculationCorrectionsTable;
  loyalty_platform_config: LoyaltyPlatformConfigTable;
  loyalty_suspicious_cases: LoyaltySuspiciousCasesTable;
  loyalty_templates: LoyaltyTemplatesTable;
  maintenance_events: MaintenanceEventsTable;
  maintenance_state: MaintenanceStateTable;
  membership_kpi_snapshots: MembershipKpiSnapshotsTable;
  membership_platform_config: MembershipPlatformConfigTable;
  membership_templates: MembershipTemplatesTable;
  merchant_account_alerts: MerchantAccountAlertsTable;
  merchant_funding_profiles: MerchantFundingProfilesTable;
  merchant_pricing_plans: MerchantPricingPlansTable;
  merchant_rate_schedules: MerchantRateSchedulesTable;
  merchant_risk_reviews: MerchantRiskReviewsTable;
  message_template_versions: MessageTemplateVersionsTable;
  message_templates: MessageTemplatesTable;
  mobile_pay_devices: MobilePayDevicesTable;
  mobile_pay_device_branches: MobilePayDeviceBranchesTable;
  mobile_pay_device_nonces: MobilePayDeviceNoncesTable;
  payment_device_pairings: PaymentDevicePairingsTable;
  notifications: NotificationsTable;
  overage_charges: OverageChargesTable;
  overage_rules: OverageRulesTable;
  overview_monthly_snapshots: OverviewMonthlySnapshotsTable;
  partner_payouts: PartnerPayoutsTable;
  payroll_sync_events: PayrollSyncEventsTable;
  permissions: PermissionsTable;
  plan_add_ons: PlanAddOnsTable;
  plan_features: PlanFeaturesTable;
  plan_limits: PlanLimitsTable;
  platform_announcement_targets: PlatformAnnouncementTargetsTable;
  platform_announcements: PlatformAnnouncementsTable;
  platform_branding: PlatformBrandingTable;
  platform_setting_changes: PlatformSettingChangesTable;
  platform_settings: PlatformSettingsTable;
  pos_booking_integrations: PosBookingIntegrationsTable;
  pos_display_devices: PosDisplayDevicesTable;
  pos_message_templates: PosMessageTemplatesTable;
  pos_message_template_versions: PosMessageTemplateVersionsTable;
  pos_message_template_bindings: PosMessageTemplateBindingsTable;
  pos_message_template_usage: PosMessageTemplateUsageTable;
  pos_message_template_tests: PosMessageTemplateTestsTable;
  pos_messaging_sender: PosMessagingSenderTable;
  pos_project_status_checks: PosProjectStatusChecksTable;
  pos_queue_audit: PosQueueAuditTable;
  privileged_access_grant_events: PrivilegedAccessGrantEventsTable;
  privileged_access_grants: PrivilegedAccessGrantsTable;
  processor_reconciliations: ProcessorReconciliationsTable;
  product_barcodes: ProductBarcodesTable;
  product_category_merge_logs: ProductCategoryMergeLogsTable;
  product_distributions: ProductDistributionsTable;
  product_import_errors: ProductImportErrorsTable;
  product_import_jobs: ProductImportJobsTable;
  product_master: ProductMasterTable;
  product_updates: ProductUpdatesTable;
  outbox_events: OutboxEventsTable;
  processed_events: ProcessedEventsTable;
  event_dead_letters: EventDeadLettersTable;
  loyalty_point_earnings: LoyaltyPointEarningsTable;
  promotion_redemptions: PromotionRedemptionsTable;
  promotions: PromotionsTable;
  public_check_in_sessions: PublicCheckInSessionsTable;
  purchase_order_lines: PurchaseOrderLinesTable;
  purchase_orders: PurchaseOrdersTable;
  queue_alerts: QueueAlertsTable;
  queue_assignment_candidates: QueueAssignmentCandidatesTable;
  queue_assignment_decisions: QueueAssignmentDecisionsTable;
  queue_assignment_recommendations: QueueAssignmentRecommendationsTable;
  queue_assignment_rotation_state: QueueAssignmentRotationStateTable;
  queue_assignment_settings: QueueAssignmentSettingsTable;
  queue_metrics_snapshots: QueueMetricsSnapshotsTable;
  queue_repair_actions: QueueRepairActionsTable;
  receipt_delivery_logs: ReceiptDeliveryLogsTable;
  reception_copilot_action_ledger: ReceptionCopilotActionLedgerTable;
  reception_copilot_health_runs: ReceptionCopilotHealthRunsTable;
  ai_calendar_health_runs: AiCalendarHealthRunsTable;
  customer_search_health_runs: CustomerSearchHealthRunsTable;
  customer_timeline_health_runs: CustomerTimelineHealthRunsTable;
  churn_watch_health_runs: ChurnWatchHealthRunsTable;
  churn_watch_review_events: ChurnWatchReviewEventsTable;
  churn_watch_reviews: ChurnWatchReviewsTable;
  rebooking_health_runs: RebookingHealthRunsTable;
  rebooking_review_events: RebookingReviewEventsTable;
  rebooking_reviews: RebookingReviewsTable;
  service_recommendation_events: ServiceRecommendationEventsTable;
  service_recommendation_health_runs: ServiceRecommendationHealthRunsTable;
  service_recommendation_reviews: ServiceRecommendationReviewsTable;
  service_recommendation_scans: ServiceRecommendationScansTable;
  service_recommendations: ServiceRecommendationsTable;
  customer_intelligence_health_runs: CustomerIntelligenceHealthRunsTable;
  customer_intelligence_scans: CustomerIntelligenceScansTable;
  customer_intelligence_snapshots: CustomerIntelligenceSnapshotsTable;
  reception_copilot_feedback: ReceptionCopilotFeedbackTable;
  reception_copilot_knowledge_versions: ReceptionCopilotKnowledgeVersionsTable;
  reception_copilot_learning_suggestions: ReceptionCopilotLearningSuggestionsTable;
  reception_copilot_recommendations: ReceptionCopilotRecommendationsTable;
  reception_copilot_sessions: ReceptionCopilotSessionsTable;
  reconciliation_exceptions: ReconciliationExceptionsTable;
  reconciliation_periods: ReconciliationPeriodsTable;
  referral_redemptions: ReferralRedemptionsTable;
  referral_program_settings: ReferralProgramSettingsTable;
  referral_rewards: ReferralRewardsTable;
  referral_events: ReferralEventsTable;
  review_moderation_events: ReviewModerationEventsTable;
  reminder_channel_config: ReminderChannelConfigTable;
  reminder_flow_state: ReminderFlowStateTable;
  reminder_plan_features: ReminderPlanFeaturesTable;
  reminder_settings: ReminderSettingsTable;
  reminder_template_versions: ReminderTemplateVersionsTable;
  reminder_templates: ReminderTemplatesTable;
  reminder_tenant_overrides: ReminderTenantOverridesTable;
  reminder_timing_defaults: ReminderTimingDefaultsTable;
  report_exports: ReportExportsTable;
  residual_statement_lines: ResidualStatementLinesTable;
  residual_statements: ResidualStatementsTable;
  revenue_accounting_periods: RevenueAccountingPeriodsTable;
  revenue_adjustments: RevenueAdjustmentsTable;
  revenue_agreement_versions: RevenueAgreementVersionsTable;
  revenue_agreements: RevenueAgreementsTable;
  revenue_audit_log: RevenueAuditLogTable;
  revenue_export_jobs: RevenueExportJobsTable;
  revenue_records: RevenueRecordsTable;
  role_permissions: RolePermissionsTable;
  roles: RolesTable;
  scheduled_reports: ScheduledReportsTable;
  security_incident_events: SecurityIncidentEventsTable;
  security_incidents: SecurityIncidentsTable;
  security_policies: SecurityPoliciesTable;
  service_category_merge_logs: ServiceCategoryMergeLogsTable;
  service_product_recipes: ServiceProductRecipesTable;
  service_progress_events: ServiceProgressEventsTable;
  service_template_addons: ServiceTemplateAddonsTable;
  service_template_categories: ServiceTemplateCategoriesTable;
  service_template_deployments: ServiceTemplateDeploymentsTable;
  service_template_resources: ServiceTemplateResourcesTable;
  service_template_versions: ServiceTemplateVersionsTable;
  service_templates: ServiceTemplatesTable;
  settlement_notes: SettlementNotesTable;
  sms_delivery_logs: SmsDeliveryLogsTable;
  social_posts: SocialPostsTable;
  status_communications: StatusCommunicationsTable;
  status_components: StatusComponentsTable;
  system_health_snapshots: SystemHealthSnapshotsTable;
  tenant_health_snapshots: TenantHealthSnapshotsTable;
  mfa_recovery_tokens: MfaRecoveryTokensTable;
  platform_approvals: PlatformApprovalsTable;
  platform_features: PlatformFeaturesTable;
  technician_manager_messages: TechnicianManagerMessagesTable;
  usage_alerts: UsageAlertsTable;
  status_health_snapshots: StatusHealthSnapshotsTable;
  status_incident_impact: StatusIncidentImpactTable;
  status_incidents: StatusIncidentsTable;
  status_incident_events: StatusIncidentEventsTable;
  synthetic_probe_heartbeats: SyntheticProbeHeartbeatsTable;
  backup_reports: BackupReportsTable;
  security_events: SecurityEventsTable;
  secret_fingerprints: SecretFingerprintsTable;
  ephemeral_grants: EphemeralGrantsTable;
  status_post_incident_reports: StatusPostIncidentReportsTable;
  status_public_updates: StatusPublicUpdatesTable;
  status_scheduled_maintenance: StatusScheduledMaintenanceTable;
  store_hours_settings: StoreHoursSettingsTable;
  subscription_changes: SubscriptionChangesTable;
  subscription_plan_versions: SubscriptionPlanVersionsTable;
  subscription_plans: SubscriptionPlansTable;
  super_admin_login_otp: SuperAdminLoginOtpTable;
  super_admin_project_status: SuperAdminProjectStatusTable;
  super_admin_saved_views: SuperAdminSavedViewsTable;
  support_session_events: SupportSessionEventsTable;
  support_session_requests: SupportSessionRequestsTable;
  support_ticket_events: SupportTicketEventsTable;
  support_ticket_messages: SupportTicketMessagesTable;
  support_tickets: SupportTicketsTable;
  tech_account_status_events: TechAccountStatusEventsTable;
  tech_dm_messages: TechDmMessagesTable;
  tech_dm_reports: TechDmReportsTable;
  tech_dm_threads: TechDmThreadsTable;
  tech_profile_events: TechProfileEventsTable;
  technician_status_events: TechnicianStatusEventsTable;
  tenant_a2p_registrations: TenantA2pRegistrationsTable;
  tenant_add_ons: TenantAddOnsTable;
  tenant_ai_plan_subscriptions: TenantAiPlanSubscriptionsTable;
  tenant_ai_subscriptions: TenantAiSubscriptionsTable;
  tenant_backup_requests: TenantBackupRequestsTable;
  tenant_community_settings: TenantCommunitySettingsTable;
  tenant_customer_phone_settings: TenantCustomerPhoneSettingsTable;
  tenant_daily_booking_summary: TenantDailyBookingSummaryTable;
  tenant_daily_customer_summary: TenantDailyCustomerSummaryTable;
  tenant_daily_review_summary: TenantDailyReviewSummaryTable;
  tenant_daily_sales_summary: TenantDailySalesSummaryTable;
  tenant_daily_service_summary: TenantDailyServiceSummaryTable;
  tenant_daily_technician_summary: TenantDailyTechnicianSummaryTable;
  tenant_feature_flags: TenantFeatureFlagsTable;
  tenant_feature_overrides: TenantFeatureOverridesTable;
  tenant_incentives: TenantIncentivesTable;
  tenant_location_hours: TenantLocationHoursTable;
  tenant_location_map_history: TenantLocationMapHistoryTable;
  tenant_messaging_credentials: TenantMessagingCredentialsTable;
  booking_deposits: BookingDepositsTable;
  tenant_messaging_limits: TenantMessagingLimitsTable;
  tenant_messaging_numbers: TenantMessagingNumbersTable;
  tenant_plan_limit_overrides: TenantPlanLimitOverridesTable;
  tenant_presets: TenantPresetsTable;
  tenant_private_incidents: TenantPrivateIncidentsTable;
  tenant_promotion_redemptions: TenantPromotionRedemptionsTable;
  tenant_promotions: TenantPromotionsTable;
  tenant_role_permissions: TenantRolePermissionsTable;
  tenant_tap_to_pay_onboarding: TenantTapToPayOnboardingTable;
  tenant_trials: TenantTrialsTable;
  tenant_warnings: TenantWarningsTable;
  trial_definitions: TrialDefinitionsTable;
  unmatched_customer_records: UnmatchedCustomerRecordsTable;
  usage_counters: UsageCountersTable;
  user_avatars: UserAvatarsTable;
  user_invitations: UserInvitationsTable;
  user_login_alert_prefs: UserLoginAlertPrefsTable;
  user_notification_prefs: UserNotificationPrefsTable;
  user_permissions: UserPermissionsTable;
  user_roles: UserRolesTable;
  user_ui_prefs: UserUiPrefsTable;
  utilization_snapshots: UtilizationSnapshotsTable;
  video_progress: VideoProgressTable;
  video_tutorials: VideoTutorialsTable;
  voice_call_outcomes: VoiceCallOutcomesTable;
  voice_improvement_suggestions: VoiceImprovementSuggestionsTable;
  voice_integration_keys: VoiceIntegrationKeysTable;
  voice_prompt_versions: VoicePromptVersionsTable;
  worker_cross_tenant_transfer_requests: WorkerCrossTenantTransferRequestsTable;
  sms_verification_packages: SmsVerificationPackagesTable;
  tenant_sms_subscriptions: TenantSmsSubscriptionsTable;
  tenant_sms_package_changes: TenantSmsPackageChangesTable;
  tenant_sms_billing_cycles: TenantSmsBillingCyclesTable;
  sms_usage_records: SmsUsageRecordsTable;
  sms_reconciliation_findings: SmsReconciliationFindingsTable;
  // ── Global Loyalty & Rewards Network (migration 733, Oct 30 2026) ──
  global_earning_rule_versions: GlobalEarningRuleVersionsTable;
  global_points_ledger: GlobalPointsLedgerTable;
  global_rewards_accounts: GlobalRewardsAccountsTable;
  global_rewards_enrollments: GlobalRewardsEnrollmentsTable;
  global_rewards_program: GlobalRewardsProgramTable;
  merchant_reimbursements: MerchantReimbursementsTable;
  reward_earn_transactions: RewardEarnTransactionsTable;
  reward_redemptions: RewardRedemptionsTable;
  payout_attempts: PayoutAttemptsTable;
  reimbursement_adjustments: ReimbursementAdjustmentsTable;
  rewards_recon_runs: RewardsReconRunsTable;
  rewards_recon_findings: RewardsReconFindingsTable;
  loyalty_fraud_alerts: LoyaltyFraudAlertsTable;
  rewards_journal_entries: RewardsJournalEntriesTable;
  rewards_journal_lines: RewardsJournalLinesTable;
  tenant_earning_policy_versions: TenantEarningPolicyVersionsTable;
  tenant_token_wallets: TenantTokenWalletsTable;
  token_purchase_events: TokenPurchaseEventsTable;
  token_purchase_intents: TokenPurchaseIntentsTable;
  token_wallet_ledger: TokenWalletLedgerTable;
  // ── drift patch Oct 30 2026: round-2 guides + migrations 730/731 ──
  ai_billing_invoice_events: AiBillingInvoiceEventsTable;
  ai_billing_invoice_line_snapshots: AiBillingInvoiceLineSnapshotsTable;
  ai_billing_invoice_links: AiBillingInvoiceLinksTable;
  ai_billing_reconciliation_runs: AiBillingReconciliationRunsTable;
  ai_usage_alerts: AiUsageAlertsTable;
  catalog_change_log: CatalogChangeLogTable;
  commission_discrepancy_review_events: CommissionDiscrepancyReviewEventsTable;
  commission_discrepancy_reviews: CommissionDiscrepancyReviewsTable;
  commission_discrepancy_scan_runs: CommissionDiscrepancyScanRunsTable;
  communication_thread_events: CommunicationThreadEventsTable;
  customer_retention_daily_snapshots: CustomerRetentionDailySnapshotsTable;
  customer_retention_snapshot_runs: CustomerRetentionSnapshotRunsTable;
  health_check_alerts: HealthCheckAlertsTable;
  health_check_results: HealthCheckResultsTable;
  health_check_runs: HealthCheckRunsTable;
  inventory_vendor_contacts: InventoryVendorContactsTable;
  inventory_vendor_products: InventoryVendorProductsTable;
  invoice_payments: InvoicePaymentsTable;
  performance_score_snapshots: PerformanceScoreSnapshotsTable;
  platform_ai_package_settings: PlatformAiPackageSettingsTable;
  product_usage_adjustments: ProductUsageAdjustmentsTable;
  product_usage_events: ProductUsageEventsTable;
  reconciliation_allocations: ReconciliationAllocationsTable;
  reconciliation_notes: ReconciliationNotesTable;
  release_evidence: ReleaseEvidenceTable;
  retention_sms_campaigns: RetentionSmsCampaignsTable;
  segment_audience_drafts: SegmentAudienceDraftsTable;
  coupon_assistant_drafts: CouponAssistantDraftsTable;   // 736
  promotion_eligibility_checks: PromotionEligibilityChecksTable;   // 738
  segment_audience_members: SegmentAudienceMembersTable;
  retention_sms_recipients: RetentionSmsRecipientsTable;
  sms_test_events: SmsTestEventsTable;
  team_data_alert_events: TeamDataAlertEventsTable;
  team_data_alert_runs: TeamDataAlertRunsTable;
  team_data_alerts: TeamDataAlertsTable;
  team_data_nightly_runs: TeamDataNightlyRunsTable;
  team_onboarding_requests: TeamOnboardingRequestsTable;
  team_staff_certifications: TeamStaffCertificationsTable;
  team_staff_profiles: TeamStaffProfilesTable;
  team_training_assignments: TeamTrainingAssignmentsTable;
  team_training_courses: TeamTrainingCoursesTable;
  team_training_events: TeamTrainingEventsTable;
  tech_cash_handoff_events: TechCashHandoffEventsTable;
  technician_shift_override_events: TechnicianShiftOverrideEventsTable;
  technician_shift_overrides: TechnicianShiftOverridesTable;
  tenant_ai_branch_settings: TenantAiBranchSettingsTable;
  tenant_ai_branch_settings_history: TenantAiBranchSettingsHistoryTable;
  tenant_ai_subscription_events: TenantAiSubscriptionEventsTable;
  tenant_messaging_health_checks: TenantMessagingHealthChecksTable;
  tenant_messaging_registration_snapshots: TenantMessagingRegistrationSnapshotsTable;
  tenant_messaging_registration_sync_runs: TenantMessagingRegistrationSyncRunsTable;
  tenant_messaging_webhook_activity: TenantMessagingWebhookActivityTable;
  tenant_number_purchase_quotes: TenantNumberPurchaseQuotesTable;
  tenant_retention_settings: TenantRetentionSettingsTable;
  tenant_retention_settings_history: TenantRetentionSettingsHistoryTable;
  tenant_sms_pricing: TenantSmsPricingTable;

}
export interface GoCheckinDevicesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; device_name: string;
  device_type: Generated<string>; checkin_slug: string; public_url: string | null;
  device_token_hash: string | null; status: Generated<string>; last_seen_at: TsNull;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts; disabled_at: TsNull; token_expires_at: TsNull;
  allowed_branch_ids: ColumnType<string[] | null, string | null, string | null>;
  welcome_message: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface GoCheckinSessionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; device_id: string | null;
  display_device_id: string | null;   // migration 512 — exactly one of device_id / display_device_id
  session_token_hash: string; status: Generated<string>; started_at: Ts; last_seen_at: Ts;
  completed_at: TsNull; expired_at: TsNull; metadata_json: ColumnType<any, any, any>;
  lookup_count: Generated<number>; create_count: Generated<number>;   // migration 516
}
export interface GoCheckinLogsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; device_id: string | null;
  session_id: string | null; event_type: string; safe_message: string | null;
  metadata_json: ColumnType<any, any, any>; created_at: Ts;
}
export interface TenantCheckinSettingsTable {
  tenant_id: string; enabled: Generated<boolean>; appointment_checkin_enabled: Generated<boolean>;
  walkin_checkin_enabled: Generated<boolean>; new_customer_enabled: Generated<boolean>;
  service_selection_enabled: Generated<boolean>; technician_preference_enabled: Generated<boolean>;
  tenant_phone_lookup_enabled: Generated<boolean>; central_lookup_enabled: Generated<boolean>;
  customer_linking_enabled: Generated<boolean>; show_wait_estimate: Generated<boolean>;
  auto_send_to_queue: Generated<boolean>; require_front_desk_approval: Generated<boolean>; updated_at: Ts;
  confirmation_timeout_seconds: Generated<number>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  display_languages: Generated<string[]>;   // migration 620 (Dual-Screen mandate §118–§119)
}
export interface DevicePushTokensTable {
  id: Generated<string>; tenant_id: string | null; user_id: string; platform: string; token: string;
  app: string | null; last_seen_at: Ts; revoked_at: TsNull; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface NotificationDeliveryLogsTable {
  id: Generated<string>; tenant_id: string | null; user_id: string | null; channel: string; target_masked: string;
  template: string; provider_id: string | null; status: string; error_message: string | null; created_at: Ts;
}
export interface ServiceFollowUpTasksTable {
  id: Generated<string>; tenant_id: string; branch_id: string; business_date: string; customer_id: string;
  technician_id: string; ticket_id: string; ticket_service_line_id: string; appointment_id: string | null;
  service_id: string | null; service_name_snapshot: string; customer_name_snapshot: string;
  customer_phone_snapshot: string | null; technician_name_snapshot: string; customer_app_user_id: string | null;
  completed_at: TsNull; status: string; message_template_key: string | null; suggested_message: string;
  sent_message: string | null; sent_at: TsNull; sent_by_user_id: string | null; skip_reason: string | null;
  customer_app_notification_id: string | null; customer_viewed_at: TsNull;
  created_at: Ts; updated_at: Ts; deleted_at: TsNull;
  updated_by: string | null; deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 745 (EOD guide §9, §10): expiry keeps the row; manager rejection; approval; manager exception
  expired_at: TsNull; rejected_at: TsNull; rejected_by_user_id: string | null; manager_note: string | null;
  approved_by_user_id: string | null; submitted_at: TsNull; override_reason: string | null;
}
export interface DailyFollowUpGenerationRunsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; business_date: string; run_status: string;
  trigger_source: string; started_at: Ts; finished_at: TsNull; created_count: number; skipped_count: number;
  error_message: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  // migration 745 (EOD guide §6 diagnostic run record)
  candidates_count: Generated<number>; excluded_count: Generated<number>; exclusions_json: Generated<unknown>; rule_version: string | null;
  run_timezone: string | null; generation_time: string | null; run_key: string | null;
}
export interface DailyFollowUpSettingsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; enabled: boolean; generation_time: string;
  timezone: string | null; default_message_template: string | null; allow_tech_edit_message: boolean;
  allow_customer_replies: boolean; require_manager_approval: boolean; reminder_to_tech: boolean; create_mode: string;
  auto_expire_pending_hours: number;
  contact_cooldown_hours: Generated<number>;   // migration 745 (customer contact protection)
  created_at: Ts; updated_at: Ts; updated_by_user_id: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerPaymentMethodsTable {
  id: Generated<string>; tenant_id: string; customer_id: string; gateway: string; token: string; brand: string | null;
  last4: string | null; exp_month: number | null; exp_year: number | null; is_default: boolean; created_at: Ts;
}
export interface CustomerAddressesTable {
  id: Generated<string>; tenant_id: string; customer_id: string; label: string | null; line1: string; line2: string | null;
  city: string | null; state: string | null; zip: string | null; is_default: boolean; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerDealsTable {
  id: Generated<string>; tenant_id: string; title: string; description: string | null; code: string | null;
  starts_at: TsNull; ends_at: TsNull; active: boolean; sort_order: number; created_at: Ts;
}
export interface CustomerReferralsTable {
  id: Generated<string>; tenant_id: string; customer_id: string; code: string; created_at: Ts;
  status: Generated<string>; expires_at: TsNull; disabled_at: TsNull; disabled_reason: string | null; row_version: Generated<number>; updated_at: TsNull; updated_by: string | null;
}
export interface CustomerNotificationsTable {
  id: Generated<string>; tenant_id: string; customer_id: string; type: string; title: string;
  body: string | null; reference: string | null; read_at: TsNull; created_at: Ts;
}
export interface CustomerWalletLedgerTable {
  id: Generated<string>; tenant_id: string; customer_id: string; amount_cents: number; entry_type: string;
  currency: string; reference: string | null; idempotency_key: string | null; created_by_user_id: string | null; created_at: Ts;
}
export interface WalletTopupIntentsTable {   // migration 679
  id: Generated<string>; tenant_id: string; customer_id: string; payment_method_id: string | null; amount_cents: number; currency: Generated<string>;
  status: Generated<string>; client_key: string | null; attempt: Generated<number>; processor: string | null; processor_transaction_id: string | null;
  resp_text: string | null; failure_reason: string | null; settled_by: string | null; last_inquired_at: TsNull; settled_at: TsNull;
  created_by_user_id: string | null; updated_by: string | null; created_at: Ts; updated_at: Ts;
}
export interface SalonPromotionsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; code: string; name: string;
  discount_type: string; discount_percent: number | null; discount_cents: number | null; min_purchase_cents: number;
  status: string; starts_at: TsNull; ends_at: TsNull; max_redemptions: number | null; redemption_count: number;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface GiftCardsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; code: string;
  initial_balance_cents: number; balance_cents: number; status: string;
  customer_id: string | null; issued_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  purchased_cents: Generated<number>; promo_cents: Generated<number>; expires_at: Ts | null;
  program_id: string | null; design_id: string | null; recipient_id: string | null; reference: string | null;
  sale_ticket_id: string | null; card_number: string | null; card_number_hash: string | null; card_number_last4: string | null; replaced_by_card_id: string | null; replacement_of_card_id: string | null; card_pin_hash: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  issue_idempotency_key: string | null;
  void_reason: string | null;
  voided_at: TsNull;
  voided_by_user_id: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface GiftCardTransactionsTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; type: string;
  amount_cents: number; balance_after_cents: number; ticket_id: string | null; payment_id: string | null;
  created_by_user_id: string | null; created_at: Ts; idempotency_key: string | null;
  branch_id: string | null;   // migration 489 (Decision 31)
}
export interface GiftCardProgramsTable {
  id: Generated<string>; owner_tenant_id: string; name: string; shared_liability: Generated<boolean>;
  status: Generated<string>; scope: Generated<string>; created_at: Ts; updated_at: Ts;
}
export interface GiftCardProgramMembersTable { program_id: string; tenant_id: string; status: Generated<string>; joined_at: Ts; }
export interface GiftCardClearingEntriesTable {
  id: Generated<string>; program_id: string | null; gift_card_id: string; redemption_transaction_id: string | null;
  issuing_tenant_id: string; redeeming_tenant_id: string; amount_cents: number; platform_fee_cents: Generated<number>;
  currency: Generated<string>; status: Generated<string>; settlement_batch_id: string | null; created_at: Ts; updated_at: Ts;
}
export interface GiftCardSettlementBatchesTable {
  id: Generated<string>; program_id: string | null; period_start: string | null; period_end: string | null;
  status: Generated<string>; total_cents: Generated<number>; fee_cents: Generated<number>; net_cents: Generated<number>;
  currency: Generated<string>; approved_by_user_id: string | null; approved_at: Ts | null; created_at: Ts; updated_at: Ts;
}
export interface GiftCardStockTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; card_number_hash: string; card_number_last4: string;
  status: Generated<string>; batch_label: string | null; gift_card_id: string | null; notes: string | null;
  created_at: Ts; updated_at: Ts; activated_at: Ts | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface GiftCardDesignsTable {
  id: Generated<string>; tenant_id: string; name: string; occasion: string | null;
  image_asset_key: string | null; theme: string | null; is_active: Generated<boolean>; created_at: Ts;
}
export interface GiftCardRecipientsTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; customer_id: string | null;
  recipient_name: string | null; recipient_phone: string | null; recipient_email: string | null;
  message: string | null; sender_name: string | null; anonymous: Generated<boolean>; created_at: Ts;
}
export interface GiftCardDeliveriesTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; channel: string; destination: string | null;
  scheduled_at: Ts | null; status: Generated<string>; provider_message_id: string | null;
  failure_reason: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface GiftCardClaimTokensTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; token_hash: string;
  recipient_phone: string | null; recipient_email: string | null; expires_at: Ts; claimed_at: Ts | null;
  claimed_by_customer_id: string | null; revoked_at: Ts | null; created_at: Ts;
}
export interface GiftCardPresentationTokensTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; token_hash: string; nonce: string;
  session_binding: string | null; expires_at: Ts; used_at: Ts | null; revoked_at: Ts | null; created_at: Ts;
}
export interface GiftCardRedemptionHoldsTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; branch_id: string | null; ticket_id: string | null;
  amount_cents: number; status: Generated<string>; idempotency_key: string | null; expires_at: Ts;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface GiftCardFraudFlagsTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; flag_type: string; severity: Generated<string>;
  detail: string | null; resolved_at: Ts | null; created_at: Ts;
}
export interface GiftCardAdjustmentsTable {
  id: Generated<string>; tenant_id: string; gift_card_id: string; amount_cents: number;
  balance_before_cents: number; balance_after_cents: number; reason: string; actor_user_id: string | null;
  approved_by_user_id: string | null; ledger_entry_id: string | null; created_at: Ts;
}
export interface AiMarketingCampaignSendsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; campaign_id: string; customer_id: string;
  channel: string; message_version: Generated<number>; status: Generated<string>; skip_reason: string | null;
  provider_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface AiMarketingCampaignPlansTable {
  campaign_id: string; tenant_id: string; branch_id: string | null; channel: string;
  message_version: Generated<number>; body: string; offer_name: string | null;
  audience_definition: ColumnType<any, string, string>; created_by_user_id: string | null;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MoneyProtectionAlertsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; rule_id: string; alert_type: string;
  severity: string; status: Generated<string>; risk_score: number; confidence: Generated<string>;
  amount_cents: number; entity_fingerprint: string; evaluation_window: Generated<string>;
  evidence: ColumnType<any, string, string>; related: ColumnType<any, string, string>;
  event_count: Generated<number>; first_seen_at: Ts; last_seen_at: Ts; assigned_user_id: string | null;
  investigation_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MoneyProtectionInvestigationsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; title: string; category: Generated<string>;
  severity: Generated<string>; status: Generated<string>; assigned_user_id: string | null;
  value_under_review_cents: Generated<number>; recovery_amount_cents: Generated<number>; resolution: string | null;
  related: ColumnType<any, string, string>; created_by_user_id: string; created_at: Ts; updated_at: Ts; closed_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface MoneyProtectionInvestigationNotesTable {
  id: Generated<string>; tenant_id: string; investigation_id: string; author_user_id: string; body: string; created_at: Ts;
}
export interface MoneyProtectionRuleSettingsTable {
  id: Generated<string>; tenant_id: string; rule_id: string; enabled: Generated<boolean>; severity_override: string | null;
  thresholds: ColumnType<any, string, string>; updated_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CallConsentRecordsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; provider: Generated<string>; provider_call_id: string;
  consent_status: Generated<string>; consent_method: string | null; recording_enabled: Generated<boolean>;
  transcription_enabled: Generated<boolean>; announcement_version: string | null; jurisdiction: string | null;
  initiated_by: string | null; consent_at: Ts | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CallTranscriptsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; provider: Generated<string>; provider_call_id: string;
  customer_id: string | null; direction: Generated<string>; handler: Generated<string>; status: Generated<string>;
  primary_language: string | null; language_confidence: ColumnType<number | null, number | null, number | null>;
  mixed_language: Generated<boolean>; redaction_status: Generated<string>; raw_available: Generated<boolean>;
  confidence: ColumnType<number | null, number | null, number | null>; duration_seconds: number | null;
  segment_count: Generated<number>; provider_transcript_ref: string | null; legal_hold: Generated<boolean>;
  retention_expires_at: Ts | null; deleted_at: Ts | null; created_at: Ts; updated_at: Ts;
  redaction_categories: ColumnType<any, string, string>;
  deleted_by: string | null; updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CallRedactionEventsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; transcript_id: string;
  categories: ColumnType<any, string, string>; segments_redacted: Generated<number>; raw_retained: Generated<boolean>;
  created_at: Ts;
}
export interface CallTranscriptIntelligenceTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; transcript_id: string; provider_call_id: string | null;
  quick_summary: Generated<string>; detailed_summary: string | null; detailed_source: string | null;
  intents: ColumnType<any, string, string>; appointment: ColumnType<any, string, string>; unresolved: ColumnType<any, string, string>;
  sentiment: string | null; extraction_confidence: ColumnType<number | null, number | null, number | null>;
  created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CallDeletionEventsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; transcript_id: string | null; provider: string | null;
  provider_call_id: string | null; reason: Generated<string>; segments_deleted: Generated<number>;
  provider_deleted: Generated<boolean>; actor: string | null; created_at: Ts;
}
export interface VoiceTranscriptionSettingsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; transcription_enabled: Generated<boolean>;
  retention_days: Generated<number>; retain_raw: Generated<boolean>; consent_announcement_version: string | null;
  updated_by: string | null; created_at: Ts; updated_at: Ts;
}
export interface CallTranscriptSegmentsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; transcript_id: string; seq: number;
  speaker_label: string | null; speaker_role: Generated<string>; start_ms: number | null; end_ms: number | null;
  redacted_text: Generated<string>; raw_text: string | null; language: string | null;
  confidence: ColumnType<number | null, number | null, number | null>; is_final: Generated<boolean>;
  redaction_applied: Generated<boolean>; provider_segment_ref: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantsTable {
  closed_at: Ts | null;   // Constitution 7 §21 (migration 467)
  lifecycle_state: Generated<string>;   // Constitution 7 §16 (migration 463) — kept consistent with status by trigger
  suspension_reason_code: string | null;   // Constitution 7 §18 (migration 462)
  id: Generated<string>; legal_name: string; display_name: string; tenant_slug: string; tenant_code: string;
  status: string; owner_user_id: string | null; business_phone: string | null; email: string | null; website: string | null;
  default_commission_percent: Generated<string | null>;   // NUMERIC DEFAULT 50 (migration 472)
  created_at: Ts; updated_at: Ts;
  suspended_at: TsNull; suspended_reason: string | null; suspended_by: string | null; locale: string | null;
  authorization_version: Generated<number>;   // BUILD_PLAN Phase 9 (migration 530) — bumped by trigger on any authorization change
}
export interface BranchesTable {
  id: Generated<string>; tenant_id: string; name: string; address: string | null; city: string | null; state: string | null;
  zip: string | null; phone: string | null; status: string; latitude: number | null; longitude: number | null; switch_pin_hash: string | null; switch_pin_updated_at: Ts | null; created_at: Ts; updated_at: Ts;
  salon_code: string | null; public_display_name: string | null; description: string | null; public_email: string | null; website: string | null; address_line2: string | null; suite_unit: string | null; country_code: Generated<string | null>; formatted_address: string | null; google_place_id: string | null; map_accuracy: string | null; map_pin_confirmed_at: TsNull; map_pin_confirmed_by: string | null; timezone: string | null; verification_status: Generated<string>; is_public: boolean | null; is_online_booking_enabled: Generated<boolean>; accepts_walk_ins: Generated<boolean>; show_phone_publicly: Generated<boolean>; show_address_publicly: Generated<boolean>; show_prices_publicly: Generated<boolean>; booking_lead_minutes: number | null; published_at: TsNull; unpublished_at: TsNull; verified_at: TsNull; verified_by: string | null; manager_name: string | null; manager_phone: string | null; manager_email: string | null; internal_notes: string | null; deleted_at: TsNull;
  updated_by: string | null; deleted_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAppFlagsTable {
  tenant_id: string; flag_key: string; enabled: boolean; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerFavoriteSalonsTable {
  user_id: string; salon_id: string; created_at: Generated<Date>;
}
export interface UserBranchAccessTable {
  id: Generated<string>; tenant_id: string; branch_id: string; user_id: string;
  role: string | null; access_level: Generated<string>; is_primary_owner: Generated<boolean>;
  created_by_user_id: string | null; created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface CustomerFavoriteTechsTable {
  user_id: string; global_tech_profile_id: string; created_at: Generated<Date>;
}
export interface TechnicianNotificationsTable {
  id: Generated<string>; tenant_id: string; technician_id: string; type: string; title: string;
  body: string | null; reference: string | null; read_at: TsNull; created_at: Ts;
}
export interface UsersTable {
  platform_role: string | null;   // Constitution 7 §5 (migration 460)
  customer_default_at: TsNull;   // migration 493 — the customer's chosen default salon account
  id: Generated<string>; tenant_id: string | null; branch_id: string | null; first_name: string | null; last_name: string | null;
  full_name: string | null; email: string | null; normalized_phone: string | null; password_hash: string | null; status: string;
  role: string; pin_hash: string | null; mfa_enabled: boolean; last_login_at: TsNull;
  temp_password_hash: string | null; temp_password_expires_at: TsNull; temp_password_delivery: string | null;
  must_change_password: boolean; password_changed_at: TsNull;
  created_at: Ts; updated_at: Ts;
  // 376 — the tenant-scoped login row points UP at the one global technician identity it belongs to
  global_tech_profile_id: string | null;
  temporary_password_hash: string | null; temporary_password_expires_at: TsNull; reset_requested_at: TsNull; last_password_reset_delivery_method: string | null; owner_access_code_hash: string | null;
  avatar_url: string | null;
  authorization_version: Generated<number>;   // BUILD_PLAN Phase 9 (migration 530) — bumped by trigger on any authorization change
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  preferred_language: string | null;   // migration 560 (BUILD_PLAN Phase 13 E): the user's app language, 'en' | 'vi' | NULL
}
export interface TenantSubscriptionsTable {
  id: Generated<string>; tenant_id: string; plan: string; status: string; current_period_end: TsNull; created_at: Ts; updated_at: Ts;
  plan_code: string | null; current_period_start: TsNull; monthly_price_cents: number | null; billing_interval: Generated<string>; pause_start: TsNull; pause_end: TsNull; cancel_at: TsNull; cancelled_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantPaymentConfigTable {
  tenant_id: string; processor: string; merchant_id: string | null; fiserv_configured: boolean; status: string; configured_at: TsNull; created_at: Ts; updated_at: Ts;
  environment: string; base_url: string | null; api_username_enc: string | null; api_password_enc: string | null; webhook_secret_enc: string | null; updated_by_user_id: string | null;
  bolt_base_url: string | null; bolt_api_key_enc: string | null; onboarding_status: string;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  config_version: Generated<number>;   // migration 638 (wave 3 PAYI §168)
  tap_to_pay_merchant_id: string | null; tap_to_pay_terminal_id: string | null;   // migration 704 (Tap to Pay per location)
}
/** A branch's own merchant account (migration 638, wave 3 PAYI §7/§10) — the tenant default stays tenant_payment_config. */
export interface PaymentMerchantAccountsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; processor: string; environment: Generated<string>;
  display_name: string | null; merchant_id: string | null; currency: Generated<string>; base_url: string | null;
  api_username_enc: string | null; api_password_enc: string | null; webhook_secret_enc: string | null;
  bolt_base_url: string | null; bolt_api_key_enc: string | null; status: Generated<string>; config_version: Generated<number>;
  last_validated_at: TsNull; last_validation_error: string | null; created_by: string | null; updated_by: string | null;
  created_at: Generated<Date>; updated_at: Generated<Date>;
  tap_to_pay_merchant_id: string | null; tap_to_pay_terminal_id: string | null;   // migration 704 (Tap to Pay per location)
}
export interface PaymentGatewayEventsTable {
  id: Generated<string>; tenant_id: string | null; branch_id: string | null; payment_gateway_id: string | null;
  processor_type: string; event_type: string | null; event_id: string | null; processor_transaction_id: string | null;
  merchant_id_masked: string | null; payload_json_safe: unknown; signature_valid: boolean;
  matched_payment_id: string | null; processed_at: TsNull; created_at: Ts;
  processing_attempts: Generated<number>; last_error: string | null;   // migration 638 (wave 3 PAYI §45)
}
export interface PaymentRefundsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; payment_id: string | null; payment_gateway_id: string | null;
  processor_type: string | null; amount_cents: number; reason: string | null; status: string;
  processor_refund_id: string | null; event_id: string | null; created_by_user_id: string | null; created_at: Ts;
  // migration 664 (mandate P0 §228): a refund whose processor answer was lost waits in 'processing' until settled
  stranded_at: Ts | null; review_reason: string | null; last_error: string | null; request_detail: unknown | null; settled_at: Ts | null; settled_by: string | null;
}
/** Functional Decision 29 — Keep Separate / Not Sure decisions on duplicate customer pairs (migration 487). */
export interface CustomerDuplicateDecisionsTable {
  tenant_id: string;
  customer_a: string;
  customer_b: string;
  decision: string;
  decided_by: string | null;
  decided_at: Ts;
}

/** Functional Decision 12 — a salon's own staff roles (migration 486). */
export interface TenantCustomRolesTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  base_role: string;
  scope: string;
  permissions: unknown;
  created_by: string | null;
  created_at: Ts;
  updated_at: Ts;
  archived_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}

/** Functional Decision 12 — each staff member's role template, per salon (migration 486). */
export interface StaffRoleAssignmentsTable {
  tenant_id: string;
  user_id: string;
  template_key: string;
  assigned_by: string | null;
  assigned_at: Ts;
}

/** Functional Decision 34 — one active transaction per shared payment terminal (migration 485). */
export interface PaymentTerminalLeasesTable {
  tenant_id: string;
  terminal_id: string;
  holder: string;
  acquired_at: Ts;
  expires_at: Ts;
}

export interface PaymentSettlementsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; payment_gateway_id: string | null; processor_type: string | null;
  settlement_id: string | null; gross_cents: number; fee_cents: number; net_cents: number; currency: string; status: string;
  event_id: string | null; payload_json_safe: unknown; settled_at: TsNull; created_at: Ts;
  refunds_cents: Generated<number>; chargebacks_cents: Generated<number>; adjustments_cents: Generated<number>; transaction_count: Generated<number>; expected_net_cents: number | null; actual_deposit_cents: number | null; expected_deposit_date: ColumnType<string | null, string | null, string | null>; actual_deposit_date: ColumnType<string | null, string | null, string | null>; funding_account_last4: string | null; reconciliation_status: Generated<string>; signed_difference_cents: number | null; merchant_account_id: string | null;
}
export interface ChargebacksTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; payment_gateway_id: string | null; payment_id: string | null;
  processor_type: string | null; chargeback_id: string | null; processor_transaction_id: string | null; reason_code: string | null;
  reason: string | null; amount_cents: number; currency: string; status: string; event_id: string | null; payload_json_safe: unknown;
  opened_at: Ts; due_by: TsNull; resolved_at: TsNull; created_at: Ts; updated_at: Ts;
  dispute_reference: string | null; normalized_reason_category: string | null; merchant_account_id: string | null; transaction_ref: string | null; evidence_status: Generated<string>; processor_decision: Generated<string>; funds_withdrawn_cents: Generated<number>; funds_recovered_cents: Generated<number>; risk_level: Generated<string>; notes: string | null; submitted_at: TsNull; decided_at: TsNull; closed_at: TsNull;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantHardwarePayoffTable {
  tenant_id: string; total_cents: number; remaining_cents: number; status: string; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAiFeaturesTable {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantAiPackagesTable {
  tenant_id: string; package: string; created_at: Ts;
  id: Generated<string>;
}
export interface TenantUsageLimitsTable {
  tenant_id: string; metric: string; limit_value: number; used_value: number;
}
export interface SessionsTable {
  last_step_up_at: Ts | null;   // Constitution 7 §8 (migration 461)
  id: Generated<string>; user_id: string; tenant_id: string | null; branch_id: string | null;
  device_id: string | null; ip_address: string | null; user_agent: string | null; status: string;
  created_at: Ts; expires_at: Ts; revoked_at: TsNull;
  device_name: string | null;
  platform: string | null;
  last_seen_at: TsNull;
  locked_at: TsNull;   // migration 491 (Decision 35) auth_device_id: string | null; last_mfa_at: TsNull;   /* 496 */ last_primary_auth_at: TsNull; auth_strength: string | null; step_up_strength: string | null;   /* 497 */
  client_app: string | null; last_activity_at: TsNull; pin_failures: Generated<number>;   // migration 570 (Oct 12 2026, POS auto-lock enforced by the server)
}
export interface RefreshTokensTable {
  id: Generated<string>; session_id: string; user_id: string; token_hash: string;
  rotated_from_token_id: string | null; superseded_by_token_id: string | null;
  expires_at: Ts; revoked_at: TsNull; created_at: Ts;
  family_id: string | null;   // migration 689 (Secure Tap to Pay M6-6): the sign-in's rotation chain (null = legacy row → its session)
}
export interface WebauthnCredentialsTable {
  id: Generated<string>; credential_id: string; user_id: string; tenant_id: string | null;
  public_key: string; sign_count: Generated<number>; transports: string | null; device_label: string | null;
  created_at: Ts; last_used_at: TsNull;
  aaguid: string | null; backed_up: Generated<boolean>; revoked_at: TsNull;
}
export interface WebauthnChallengesTable {
  handle: string; challenge: string; user_id: string | null; tenant_id: string | null;
  purpose: string; expires_at: Ts; created_at: Ts;
  id: Generated<string>; consumed_at: TsNull;
}
export interface PasswordResetTokensTable {
  id: Generated<string>; user_id: string; tenant_id: string | null; token_hash: string; token_type: string;
  expires_at: Ts; used_at: TsNull; attempt_count: number; max_attempts: number; created_at: Ts;
  phone_normalized: string | null; requested_ip: string | null; requested_user_agent: string | null; branch_id: string | null; code_hash: string | null; delivery_method: string | null; delivery_target_masked: string | null; revoked_at: TsNull; ip_address: string | null; user_agent: string | null;
}
export interface GlobalCustomersTable {
  id: Generated<string>; first_name: string | null; last_name: string | null; full_name: string | null;
  normalized_phone: string | null; phone_display: string | null; phone_verified_at: TsNull;
  email: string | null; email_verified_at: TsNull; avatar_url: string | null;
  status: Generated<string>; merged_into_id: string | null; version: Generated<number>;
  created_at: Generated<Ts>; updated_at: Generated<Ts>;
  customer_identity_id: string | null;   // the bridge to customer_identities (migration 541; db-backfill-customer-identity.mjs)
}
export interface CustomerGlobalLinksTable {
  id: Generated<string>; tenant_id: string; customer_id: string; global_customer_id: string;
  confidence: string; source: string; linked_run_id: string | null; linked_by_user_id: string | null; created_at: Generated<Ts>;
}
export interface CustomerReconRunsTable {
  id: Generated<string>; trigger: string; scope: Generated<string>; scope_id: string | null; status: Generated<string>;
  started_at: Generated<Ts>; finished_at: TsNull; cursor_from: TsNull;
  tenants_scanned: Generated<number>; customers_scanned: Generated<number>; new_globals: Generated<number>;
  linked_existing: Generated<number>; profiles_synced: Generated<number>; duplicates_prevented: Generated<number>;
  duplicate_suspects: Generated<number>; conflicts: Generated<number>; links_repaired: Generated<number>;
  errors: Generated<number>; error_detail: string | null; triggered_by_user_id: string | null;
}
export interface CustomerReconTenantStatsTable {
  id: Generated<string>; run_id: string; tenant_id: string; customers_scanned: Generated<number>;
  new_globals: Generated<number>; linked_existing: Generated<number>; profiles_synced: Generated<number>;
  duplicate_suspects: Generated<number>; conflicts: Generated<number>; errors: Generated<number>;
  status: Generated<string>; error_detail: string | null;
}
export interface CustomerIdentityConflictsTable {
  id: Generated<string>; fingerprint: string; kind: string; tenant_id: string | null; customer_id: string | null;
  global_customer_id: string | null; other_global_customer_id: string | null; field: string | null;
  main_value_masked: string | null; tenant_value_masked: string | null; confidence: string | null;
  recommended_action: string | null; status: Generated<string>; occurrences: Generated<number>;
  first_seen_run: string | null; last_seen_run: string | null; resolved_by_user_id: string | null;
  resolved_at: TsNull; created_at: Generated<Ts>; updated_at: Generated<Ts>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SecurityAuditRunsTable {
  id: Generated<string>; trigger: string; status: Generated<string>; started_at: Generated<Ts>; finished_at: TsNull;
  checks_run: Generated<number>; findings_open: Generated<number>; findings_resolved: Generated<number>; error: string | null; triggered_by_user_id: string | null;
}
export interface SecurityAuditFindingsTable {
  id: Generated<string>; fingerprint: string; area: string; title: string; detail: string | null; severity: string;
  status: Generated<string>; occurrences: Generated<number>; first_seen_run: string | null; last_seen_run: string | null;
  resolved_run: string | null; incident_id: string | null; opened_at: Generated<Ts>; resolved_at: TsNull; updated_at: Generated<Ts>;
}
export interface MfaFactorsTable {
  id: Generated<string>; user_id: string; type: string; secret_enc: string | null; confirmed: boolean; created_at: Ts; last_used_step: number | null;
}
// ---- merged from branch A (ai-business) ----
export interface AiBusinessSavedQuestionsTable {
  id: Generated<string>; tenant_id: string; user_id: string; title: string; intent: string;
  preset: string | null; compare_preset: string | null; question: string | null; sharing_scope: string;
  created_at: Ts; last_used_at: TsNull;
}
export interface AiBusinessAlertsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; created_by_user_id: string;
  title: string; metric_id: string; operator: string; threshold: number; preset: string;
  min_sample_size: number; frequency: string; channel: string; active: boolean;
  created_at: Ts; last_checked_at: TsNull; last_triggered_at: TsNull;
}
export interface AiBusinessReportJobsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; requested_by_user_id: string;
  report_type: string; preset: string; status: string; content: unknown | null; error: string | null;
  created_at: Ts; started_at: TsNull; completed_at: TsNull; expires_at: Ts;
}
// ---- merged from branch C (five-AI-modules) ----
export interface AiCustomerProfileSettingsTable {
  id: Generated<string>; tenant_id: string; level: 'tenant' | 'branch' | 'user';
  branch_id: string | null; user_id: string | null;
  enabled: boolean | null; tunables: unknown | null;
  updated_by_user_id: string | null;
  created_at: Generated<string>; updated_at: Generated<string>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  version: Generated<number>;   // migration 767 (Customer AI Settings: optimistic concurrency)
}
export interface AiCheckoutUpsellSettingsTable {
  id: Generated<string>; tenant_id: string; level: 'tenant' | 'branch' | 'device' | 'user';
  branch_id: string | null; device_id: string | null; user_id: string | null;
  enabled: boolean | null; tunables: unknown | null; updated_by_user_id: string | null;
  created_at: Generated<string>; updated_at: Generated<string>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  version: Generated<number>;   // migration 773 (Checkout Upsell Settings guide): the editor's expectedVersion
}
export interface AiCheckoutUpsellSettingsHistoryTable {   // migration 773 — append-only before/after of every settings save
  id: Generated<string>; tenant_id: string; level: string; branch_id: string | null; device_id: string | null; user_id: string | null; version: number;
  actor_user_id: string | null; actor_role: string | null; before_enabled: boolean | null; after_enabled: boolean | null;
  before_tunables: Generated<unknown>; after_tunables: Generated<unknown>; changed_keys: Generated<string[]>; created_at: Generated<Ts>;
}
export interface CheckoutUpsellHealthRunsTable {   // migration 773 — read-only "Check Checkout Upsell System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface AiCheckoutUpsellRecommendationsTable {
  id: Generated<string>; tenant_id: string; branch_id: string; checkout_id: string; customer_id: string | null;
  type: string; target_id: string; title: string; price_cents: number | null; status: Generated<string>;
  context_fingerprint: string; version: Generated<number>; accepted_by_user_id: string | null; result_ref: string | null;
  created_at: Generated<string>; expires_at: string;
}
export interface AiCheckoutUpsellDismissalsTable { id: Generated<string>; tenant_id: string; branch_id: string; checkout_id: string; target_id: string; reason: string | null; user_id: string | null; created_at: Generated<string>; }
export interface AiCheckoutUpsellFeedbackTable { id: Generated<string>; tenant_id: string; branch_id: string; checkout_id: string; recommendation_id: string; rating: string; reason: string | null; user_id: string | null; created_at: Generated<string>; }
export interface ScheduleOptimizationRunsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; scope: string; status: Generated<string>; requested_by_user_id: string | null; idempotency_key: string | null; forecast_version: string | null; rule_version: string | null; engine_version: string | null; config_version: number | null; correlation_id: string | null; recommendation_count: Generated<number>; latency_ms: number | null; error_code: string | null; started_at: Generated<Ts>; completed_at: Ts | null; run_date: string | null; technician_id: string | null; run_trigger: Generated<string>; metrics: unknown | null; gap_count: Generated<number>; conflict_count: Generated<number>; }
export interface TimeClockBreakPoliciesTable { id: Generated<string>; tenant_id: string; branch_id: string | null; version: Generated<number>; policy: Generated<unknown>; reason: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TechnicianTurnEventsTable { id: Generated<string>; tenant_id: string; branch_id: string; business_date: string; sequence_number: number; technician_id: string; event_type: string; status_before: string | null; status_after: string | null; queue_item_id: string | null; appointment_id: string | null; ticket_id: string | null; service_id: string | null; assignment_ref: string | null; turn_units: Generated<number>; turn_units_delta: Generated<number>; turn_rule_id: string | null; turn_rule_version: number | null; reason_code: string | null; reason_text: string | null; assignment_source: string | null; assignment_kind: string | null; recommended_technician_id: string | null; position_before: number | null; position_after: number | null; policy_version: string | null; actor_id: string | null; actor_type: Generated<string>; idempotency_key: string | null; occurred_at: Generated<Ts>; metadata: Generated<unknown>; }
export interface TechnicianTurnStateTable { id: Generated<string>; tenant_id: string; branch_id: string; business_date: string; technician_id: string; status: Generated<string>; in_rotation: Generated<boolean>; rotation_position: Generated<number>; accumulated_units: Generated<number>; provisional_units: Generated<number>; pending_units: Generated<number>; baseline_units: Generated<number>; special_units: Generated<number>; service_minutes: Generated<number>; baseline_minutes: Generated<number>; ready_since: Ts | null; last_assignment_at: Ts | null; last_eligible_opportunity_at: Ts | null; eligible_skip_count: Generated<number>; consecutive_auto: Generated<number>; hold_reason: string | null; break_started_at: Ts | null; joined_at: Ts | null; closed_at: Ts | null; policy_version: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TurnUnitRulesTable { id: Generated<string>; tenant_id: string; rule_key: Generated<string>; version: Generated<number>; scope: string; service_id: string | null; category: string | null; max_duration_minutes: number | null; turn_units: number; special_rotation: Generated<boolean>; active: Generated<boolean>; reason: string | null; created_by: string | null; created_at: Generated<Ts>; superseded_at: Ts | null; superseded_by: string | null; }
export interface CompensationDeductionTypesTable { id: Generated<string>; tenant_id: string; key: string; label: string; enabled: Generated<boolean>; max_cents_per_period: number | null; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; }
export interface TechnicianPayPlansTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; pay_type: string; hourly_rate_cents: number | null; salary_cents_per_period: number | null; breaks_paid: Generated<boolean>; overtime_weekly_minutes: Generated<number>; effective_start: string; effective_end: string | null; status: Generated<string>; note: string | null; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; }
export interface PayrollInquiriesTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; period_id: string | null; subject_type: Generated<string>; subject_id: string | null; message: string; status: Generated<string>; response: string | null; private_note: string | null; responded_by: string | null; responded_at: Ts | null; created_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface CompensationExceptionsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; kind: string; severity: Generated<string>; dedupe_key: string; ticket_id: string | null; period_id: string | null; technician_id: string | null; status: Generated<string>; attempts: Generated<number>; next_attempt_at: Ts | null; last_error: string | null; detail_json: unknown | null; resolution_note: string | null; resolved_by: string | null; resolved_at: Ts | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface PayrollExportsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; period_id: string; format: string; row_count: Generated<number>; content_sha256: string; period_status: string; period_version: number; exported_by: string | null; created_at: Generated<Ts>; }
// migration 673 — weekly technician paycheck: schedule, statements, payout plans + instructions
export interface PayrollSchedulesTable { tenant_id: string; frequency: Generated<string>; week_start_day: Generated<number>; pay_day_offset_days: Generated<number>; timezone: string | null; active: Generated<boolean>; auto_prepare: Generated<boolean>; default_policy: Generated<string>; default_check_bp: Generated<number>; primary_method: Generated<string>; cash_enabled: Generated<boolean>; max_cash_bp: Generated<number>; allowed_methods: ColumnType<string[], string[] | undefined, string[]>; manual_split_allowed: Generated<boolean>; cash_tips_already_paid: Generated<boolean>; cash_paid_on: Generated<string>; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface PayrollStatementCountersTable { tenant_id: string; year: number; last_number: Generated<number>; }
// 674 (Oct 22 2026): Platform Announcements shown on the POS top bar — a platform row, its normalized targets, per-user
// receipts (delivered / dismissed / acknowledged per content version) and the version history.
export interface PlatformNoticesTable { id: Generated<string>; title: string | null; message: string; type: Generated<string>; priority: Generated<string>; audience: Generated<string>; surfaces: Generated<string[]>; lifecycle_status: Generated<string>; starts_at: Ts | null; ends_at: Ts | null; dismissible: Generated<boolean>; requires_ack: Generated<boolean>; content_version: Generated<number>; version: Generated<number>; duplicated_from: string | null; created_by: string | null; updated_by: string | null; published_by: string | null; published_at: Ts | null; paused_at: Ts | null; archived_at: Ts | null; created_at: Generated<Ts>; updated_at: Generated<Ts>;
  title_vi: string | null; message_vi: string | null; vi_reviewed_by: string | null; vi_reviewed_at: Ts | null; english_only: Generated<boolean>; }   // 696 (Vietnamese POS WP-F)
export interface PlatformNoticeTargetsTable { id: Generated<string>; notice_id: string; tenant_id: string; branch_id: string | null; target_type: string; created_at: Generated<Ts>; }
export interface PlatformNoticeReceiptsTable { id: Generated<string>; tenant_id: string; notice_id: string; user_id: string; branch_id: string | null; kind: string; content_version: number; created_at: Generated<Ts>; }
export interface PlatformNoticeRevisionsTable { id: Generated<string>; notice_id: string; version: number; action: string; actor_id: string | null; snapshot: ColumnType<unknown, string, string>; created_at: Generated<Ts>; }
export interface PayrollStatementsTable { id: Generated<string>; tenant_id: string; period_id: string; technician_id: string; branch_id: string | null; statement_number: string; service_commission_cents: Generated<number>; hourly_pay_cents: Generated<number>; salary_pay_cents: Generated<number>; tips_cents: Generated<number>; card_tip_cents: Generated<number>; cash_tip_cents: Generated<number>; retail_commission_cents: Generated<number>; bonus_cents: Generated<number>; guarantee_topup_cents: Generated<number>; positive_adjustments_cents: Generated<number>; deductions_cents: Generated<number>; reversals_cents: Generated<number>; gross_earnings_cents: Generated<number>; line_payable_cents: Generated<number>; already_paid_cents: Generated<number>; approved_payable_cents: Generated<number>; paid_cents: Generated<number>; status: Generated<string>; review_required: Generated<boolean>; line_hash: string | null; branch_breakdown: ColumnType<unknown, string | undefined, string>; manager_note: string | null; version: Generated<number>; created_by: string | null; created_at: Generated<Ts>; submitted_at: Ts | null; approved_at: Ts | null; approved_by: string | null; locked_at: Ts | null; voided_at: Ts | null; void_reason: string | null; updated_at: Generated<Ts>; updated_by: string | null;
  refund_reversal_cents: Generated<number>; tip_adjustment_cents: Generated<number>; retail_reversal_cents: Generated<number>; }   // migration 701 — itemised reversals
export interface PayrollPayoutPlansTable { id: Generated<string>; tenant_id: string; statement_id: string; policy_type: string; payable_cents: number; status: Generated<string>; differs_from_default: Generated<boolean>; override_reason: string | null; created_by: string | null; submitted_by: string | null; approved_by: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface PayrollPayoutInstructionsTable { id: Generated<string>; tenant_id: string; plan_id: string; statement_id: string; method: string; amount_cents: number; basis_points: number | null; sequence: number; status: Generated<string>; payout_id: string | null; created_at: Generated<Ts>; }
export interface PayrollPayoutsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; period_id: string; technician_id: string; amount_cents: number; method: string; status: Generated<string>; reference: string | null; note: string | null; failure_reason: string | null; idempotency_key: string | null; paid_at: Ts | null; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>;   statement_id: string | null; instruction_id: string | null; check_number: string | null; check_status: string | null; check_issued_at: Ts | null; check_issued_by: string | null; check_delivered_at: Ts | null; check_cleared_at: Ts | null; check_voided_at: Ts | null; check_void_reason: string | null; replaces_payout_id: string | null; cash_source: string | null; cash_status: string | null; cash_register_id: string | null; cash_prepared_by: string | null; cash_prepared_at: Ts | null; cash_handed_off_by: string | null; cash_handed_off_at: Ts | null; cash_acknowledged_at: Ts | null; cash_ack_method: string | null; cash_dispute_reason: string | null; drawer_movement_id: string | null; device_id: string | null; version: Generated<number>;   // migration 673
  cash_handoff_token_hash: string | null; cash_handoff_token_expires_at: Ts | null; cash_ack_signature: string | null; cash_ack_confirmed_by: string | null;   // migration 701 — QR / signature / dual confirmation
 }
export interface TicketServiceLineAllocationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; line_id: string; technician_id: string; share_bps: number; role: Generated<string>; created_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TicketServiceSessionsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; ticket_id: string; technician_id: string; is_helper: Generated<boolean>; status: Generated<string>; started_at: Generated<Ts>; paused_at: Ts | null; accumulated_paused_ms: Generated<number>; completed_at: Ts | null; completed_by_user_id: string | null; completion_source: string | null; idempotency_key: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TechnicianCertificationRemindersTable { certification_id: string; days_before: number; sent_at: Generated<Ts>; }
export interface TechnicianCertificationsTable { id: Generated<string>; tenant_id: string | null; global_tech_profile_id: string | null; technician_id: string | null; name: string; issuer: string | null; issued_at: string | null; expires_at: string | null; document_key: string | null; verification_status: Generated<string>; verified_by_user_id: string | null; verified_at: Ts | null; revoked_reason: string | null; created_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TechnicianBreaksTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; shift_id: string | null; kind: Generated<string>; reason: string | null; started_at: Generated<Ts>; ended_at: Ts | null; started_by: string | null; ended_by: string | null; created_at: Generated<Ts>;
  classification: string | null; paid_minutes: number | null; unpaid_minutes: number | null; policy_version: number | null; interrupted_at: Ts | null; interrupted_by: string | null; interruption_reason: string | null; }   // migration 603 — break classification + interruption
export interface TechnicianWorkforceStateTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; employment_status: Generated<string>; clock_status: Generated<string>; shift_status: Generated<string>; queue_status: Generated<string>; service_state: Generated<string>; manual_unavailable: Generated<boolean>; current_ticket_id: string | null; open_shift_id: string | null; break_started_at: Ts | null; updated_at: Generated<Ts>; version: Generated<number>; updated_by: string | null; }   // updated_by: 585
export interface NailShowcaseTenantPolicyTable { tenant_id: string; auto_publish_manual: Generated<boolean>; updated_by_user_id: string | null; updated_at: Generated<Ts>; updated_by: string | null; }   // updated_by: 585
// 646 (Technician Profile mandate, wave 3 TECH): §128 employment history (append-only), §95 public-profile change approval, §112 import runs
export interface TechnicianEmploymentEventsTable { id: Generated<string>; tenant_id: string; technician_id: string; global_tech_profile_id: string | null; branch_id: string | null; event_type: string; from_value: string | null; to_value: string | null; reason: string | null; actor_user_id: string | null; actor_role: string | null; source: string | null; metadata: Generated<unknown>; occurred_at: Generated<Ts>; }
export interface TechnicianProfileTenantPolicyTable { tenant_id: string; public_profile_changes_require_approval: Generated<boolean>; updated_by: string | null; updated_at: Generated<Ts>; }
export interface TechProfileChangeRequestsTable { id: Generated<string>; global_tech_profile_id: string; requested_by_user_id: string | null; requested_in_tenant_id: string | null; changes: unknown; status: Generated<string>; decided_by_user_id: string | null; decided_in_tenant_id: string | null; decision_note: string | null; decided_at: TsNull; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; }
export interface TechnicianImportRunsTable { id: Generated<string>; tenant_id: string; created_by_user_id: string | null; status: Generated<string>; total_rows: Generated<number>; created_count: Generated<number>; invited_existing_count: Generated<number>; failed_count: Generated<number>; results: Generated<unknown>; created_at: Generated<Ts>; }
export interface TechPortfolioPhotoTenantHidesTable { photo_id: string; tenant_id: string; hidden_by_user_id: string | null; reason: string | null; created_at: Generated<Ts>; }
export interface ProcessHeartbeatsTable { boot_id: string; process_role: string; instance: string; version: string; git_commit: string; deployment: string; environment: string; started_at: Ts; last_seen_at: Ts; schema_latest: string | null; schema_pending: number | null; rss_bytes: number | null; heap_used_bytes: number | null; cpu_user_seconds: number | null; cpu_system_seconds: number | null; event_loop_p99_seconds: number | null; metrics: Generated<unknown>; created_at: Generated<Ts>; }
export interface BranchHealthSnapshotsTable { id: Generated<string>; tenant_id: string; branch_id: string; observed_at: Ts; snapshot_slot: Ts; overall_status: string; reasons: Generated<string[]>; open_tickets: number | null; queue_waiting: number | null; queue_longest_wait_seconds: number | null; technicians_on_shift: number | null; payments_last_hour: number | null; payments_failed_last_hour: number | null; displays_total: number | null; displays_online: number | null; kiosks_total: number | null; kiosks_online: number | null; terminals_paired: number | null; last_realtime_event_at: Ts | null; sms_sent_last_hour: number | null; sms_failed_last_hour: number | null; failed_queries: Generated<string[]>; created_at: Generated<Ts>; }
export interface ObservabilitySignalStateTable { key: string; value: string; updated_at: Generated<Ts>; }
export interface SyntheticProbeResultsTable { probe: string; outcome: string; detail: string; duration_ms: Generated<number>; consecutive_failures: Generated<number>; instance_id: string | null; ran_at: Ts; }
export interface SyntheticMonitoringSettingsTable { id: Generated<boolean>; test_tenant_id: string | null; reason: string | null; updated_at: Generated<Ts>; updated_by: string | null; }
export interface SloValidationsTable { slo_id: string; status: Generated<string>; target: number; window_days: number; required_days: number; days_with_data: Generated<number>; total: Generated<number>; bad: Generated<number>; sli: number | null; evaluated_at: Generated<Ts>; validated_at: Ts | null; breached_at: Ts | null; updated_at: Generated<Ts>; }
export interface AlertEscalationsTable { id: Generated<string>; alert_id: string; step: number; contact_id: string | null; contact_name: string | null; channel: string | null; outcome: string; notified_at: Ts; escalated_at: Ts | null; acknowledged_at: Ts | null; acknowledged_by: string | null; acknowledged_via: string | null; ack_nonce_hash: string | null; ack_expires_at: Ts | null; ack_used_at: Ts | null; created_at: Generated<Ts>; }
export interface OncallContactsTable { id: Generated<string>; position: number; role: Generated<string>; name: string; channel: string; destination: string; owners: Generated<string[]>; quiet_start: string | null; quiet_end: string | null; timezone: Generated<string>; active: Generated<boolean>; created_at: Generated<Ts>; updated_at: Generated<Ts>; created_by: string | null; updated_by: string | null; }
export interface TelemetrySpansTable { id: Generated<number>; trace_id: string; span_id: string; parent_span_id: string | null; name: string; kind: string; service: string; start_ts: Ts; duration_ms: number; status: string; status_message: string | null; attributes: Generated<unknown>; tenant_id: string | null; }
export interface TelemetryLogEventsTable { id: Generated<number>; ts: Ts; level: string; service: string; process_role: Generated<string>; request_id: string | null; correlation_id: string | null; trace_id: string | null; span_id: string | null; tenant_id: string | null; route: string | null; status: number | null; duration_ms: number | null; msg: string; fields: Generated<unknown>; }
export interface CodeLookupAttemptsTable { id: Generated<number>; kind: string; tenant_id: string | null; caller_key: string; ip: string | null; outcome: Generated<string>; weight: Generated<number>; created_at: Generated<Ts>; }
export interface RealtimeStreamTicketsTable { id: Generated<string>; ticket_hash: string; session_id: string; realm: string; user_id: string; tenant_id: string | null; branch_id: string | null; device_id: string | null; claims: unknown; expires_at: Ts; used_at: Ts | null; created_at: Generated<Ts>; }
export interface DeviceBiometricCredentialsTable { id: Generated<string>; user_id: string; tenant_id: string | null; auth_device_id: string | null; device_key_hash: string; secret_hash: string; previous_secret_hash: string | null; platform: string | null; device_name: string | null; claims: Generated<unknown>; status: Generated<string>; revoked_reason: string | null; use_count: Generated<number>; created_at: Generated<Ts>; last_used_at: Ts | null; expires_at: Ts; revoked_at: Ts | null; }
export interface MobileAppInstallsSeenTable { app: string; platform: string; device_hash: string; app_version: string; first_seen_at: Generated<Ts>; last_seen_at: Generated<Ts>; }
export interface MobileAppVersionsTable { app: string; platform: string; min_supported: string | null; recommended: string | null; latest: string | null; store_url: string | null; message: string | null; reason: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface ApiOperationsTable { id: Generated<string>; tenant_id: string | null; branch_id: string | null; realm: string; actor_user_id: string; actor_role: string; kind: string; route: string; permission: string | null; params: Generated<unknown>; principal: Generated<unknown>; status: Generated<string>; progress: number | null; job_id: string | null; result_key: string | null; result_meta: unknown | null; error: unknown | null; expires_at: Ts | null; created_at: Generated<Ts>; started_at: Ts | null; finished_at: Ts | null; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TenantLoadMinuteTable { bucket_minute: Ts; tenant_id: string; request_count: Generated<number>; sum_ms: Generated<number>; db_ms: Generated<number>; db_queries: Generated<number>; }
export interface TenantStorageUsageTable { tenant_id: string; bytes_used: Generated<number>; uploads: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TenantQuotasTable { tenant_id: string; api_requests_per_min: number | null; jobs_in_flight: number | null; storage_bytes: number | null; reason: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface PlanQuotaDefaultsTable { plan_id: string; api_requests_per_min: number | null; jobs_in_flight: number | null; storage_bytes: number | null; reason: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface PlatformFlagRolloutsTable { flag_key: string; rollout_percent: Generated<number>; allow_tenant_ids: Generated<unknown>; deny_tenant_ids: Generated<unknown>; killed: Generated<boolean>; reason: string | null; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface DbSlowQuerySamplesTable { id: Generated<string>; sampled_at: Ts; query_hash: string; fingerprint: string; operation: string; table_name: string; duration_ms: number; row_count: Generated<number>; request_id: string | null; tenant_id: string | null; process_role: string | null; created_at: Generated<Ts>; }
export interface DbTableSizeSnapshotsTable { id: Generated<string>; snapshot_date: string; taken_at: Generated<Ts>; table_name: string; total_bytes: Generated<number>; table_bytes: Generated<number>; index_bytes: Generated<number>; row_estimate: Generated<number>; dead_tuples: Generated<number>; seq_scans: Generated<number>; idx_scans: Generated<number>; }
export interface SchemaBackfillsTable { name: string; status: Generated<string>; last_key: string | null; rows_done: Generated<number>; batches_done: Generated<number>; batch_size: number; started_at: Generated<Ts>; updated_at: Generated<Ts>; completed_at: Ts | null; last_error: string | null; }
export interface SchemaDeferredConstraintsTable { id: Generated<string>; name: string; table_name: string; kind: string; migration: string; reason: string; blocking_rows: number | null; retry_sql: string | null; created_at: Generated<Ts>; resolved_at: Ts | null; resolved_by: string | null; }
export interface ExportSnapshotsTable { id: Generated<string>; tenant_id: string | null; branch_id: string | null; user_id: string | null; actor: string | null; permission: string; export_kind: string; route: string | null; filters: Generated<unknown>; format: Generated<string>; row_count: number; byte_count: number | null; checksum: string; created_at: Generated<Ts>; }
export interface DormantAccountAlertsTable { id: Generated<string>; tenant_id: string; user_id: string; episode_key: string; days_dormant: number | null; owner_alert_id: string | null; created_at: Generated<Ts>; }
export interface AccessReviewItemsTable { id: Generated<string>; tenant_id: string; review_id: string; user_id: string; name: string; role: string; template_key: string | null; high_risk_permissions: Generated<unknown>; last_login_at: Ts | null; decision: string | null; change_template_key: string | null; note: string | null; decided_by_user_id: string | null; decided_at: Ts | null; }
export interface AccessReviewsTable { id: Generated<string>; tenant_id: string; status: Generated<string>; started_by_user_id: string; due_at: Ts | null; completed_by_user_id: string | null; completed_at: Ts | null; created_at: Generated<Ts>; }
export interface TenantApprovalRequestEventsTable { id: Generated<string>; tenant_id: string; request_id: string; action: string; from_status: string | null; to_status: string; actor_user_id: string | null; note: string | null; created_at: Generated<Ts>; }
export interface TenantApprovalRequestsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; kind: string; subject_type: string; subject_id: string | null; title: string; amount_cents: number | null; payload: Generated<unknown>; reason: string; requested_by_user_id: string; required_permission: string; require_different_approver: Generated<boolean>; policy_version: Generated<number>; status: Generated<string>; decided_by_user_id: string | null; decision_note: string | null; decided_at: Ts | null; execution_claimed_at: Ts | null; executed_at: Ts | null; execution_result: unknown | null; cancelled_reason: string | null; expires_at: Ts; version: Generated<number>; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface TenantApprovalPolicyChangesTable { id: Generated<string>; tenant_id: string; kind: string; version: number; previous_value: unknown | null; new_value: unknown; actor_user_id: string | null; reason: string; created_at: Generated<Ts>; }
export interface TenantApprovalPoliciesTable { tenant_id: string; kind: string; enabled: Generated<boolean>; threshold_cents: number | null; cash_threshold_cents: number | null; approver_limit_cents: number | null; require_different_approver: Generated<boolean>; expires_after_hours: Generated<number>; version: Generated<number>; updated_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface AuthorizationDenialsTable { id: Generated<string>; tenant_id: string | null; user_id: string | null; role: string | null; permission: string; reason: string; route: string | null; count: Generated<number>; first_at: Generated<Ts>; last_at: Generated<Ts>; }
export interface AuthorizationAuditEventsTable { id: Generated<string>; tenant_id: string | null; actor_user_id: string | null; target_user_id: string | null; action: string; before_state: unknown | null; after_state: unknown | null; reason: string | null; correlation_id: string | null; ip: string | null; created_at: Generated<Ts>; }
export interface TenantUserPermissionOverridesTable { id: Generated<string>; tenant_id: string; user_id: string; permission: string; effect: string; reason: string; branch_id: string | null; granted_by_user_id: string; starts_at: Generated<Ts>; expires_at: Ts | null; revoked_at: Ts | null; revoked_by_user_id: string | null; revoke_reason: string | null; created_at: Generated<Ts>; }
export interface CommunitySimilarExperiencesTable { id: Generated<string>; post_id: string; tenant_id: string; user_id: string; redacted_note: string | null; occurred_on: string | null; created_at: Generated<Ts>; }
export interface CommunityRulesAcknowledgmentsTable { id: Generated<string>; tenant_id: string; user_id: string; rules_version: string; acknowledged_at: Generated<Ts>; }
export interface CommunityRestrictionsTable { id: Generated<string>; tenant_id: string; user_id: string | null; kind: string; reason: string; case_id: string | null; created_by_user_id: string; expires_at: Ts | null; lifted_at: Ts | null; lifted_by_user_id: string | null; created_at: Generated<Ts>; }
export interface CommunityRelatedPostsTable { id: Generated<string>; post_id: string; related_post_id: string; relation: string; score: number | null; source: Generated<string>; created_by_user_id: string | null; created_at: Generated<Ts>; }
export interface CommunityRedactionsTable { id: Generated<string>; post_id: string | null; comment_id: string | null; evidence_id: string | null; field: string; reason: string; case_id: string | null; redacted_by_user_id: string; created_at: Generated<Ts>; }
export interface CommunityPostUpdatesTable { id: Generated<string>; post_id: string; tenant_id: string; redacted_body: string; visibility: Generated<string>; created_by_user_id: string; created_at: Generated<Ts>; }
export interface CommunityPostFollowsTable { id: Generated<string>; post_id: string; tenant_id: string; user_id: string; created_at: Generated<Ts>; }
export interface CommunityEvidenceAccessLogTable { id: Generated<string>; evidence_id: string; tenant_id: string | null; user_id: string; case_id: string | null; reason: string; created_at: Generated<Ts>; }
export interface CommunityCommentVersionsTable { id: Generated<string>; comment_id: string; version: number; redacted_body: string; edited_by_user_id: string | null; created_at: Generated<Ts>; }
export interface CommunityCommentReportsTable { id: Generated<string>; comment_id: string; post_id: string; reporter_tenant_id: string; reporter_user_id: string | null; reason: string; detail: string | null; status: Generated<string>; case_id: string | null; resolved_by_user_id: string | null; resolved_at: Ts | null; created_at: Generated<Ts>; }
export interface ServiceSchedulingProfilesTable { id: Generated<string>; tenant_id: string; service_id: string; setup_min: Generated<number>; cleanup_min: Generated<number>; max_group_size: number | null; updated_by_user_id: string | null; updated_at: Generated<Ts>; updated_by: string | null; }
export interface AppointmentScheduleLocksTable { id: Generated<string>; tenant_id: string; branch_id: string | null; appointment_id: string; reason: string | null; locked_by_user_id: string | null; created_at: Generated<Ts>; }
export interface TechnicianTimeOffTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string; starts_at: Ts; ends_at: Ts; status: Generated<string>; reason: string | null; created_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; kind: Generated<string>; requested_by: string | null; approved_by: string | null; decided_at: Ts | null; decision_note: string | null; }
export interface ScheduleOptimizationRecommendationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; run_id: string | null; type: string; status: Generated<string>; current_state: unknown | null; proposed_state: unknown | null; affected_appointment_ids: Generated<unknown>; affected_technician_ids: Generated<unknown>; hard_constraints_checked: Generated<boolean>; soft_objectives_improved: Generated<unknown>; expected_benefit: Generated<unknown>; possible_downside: Generated<unknown>; confidence: number | null; data_quality: Generated<string>; requires_human_review: Generated<boolean>; requires_customer_approval: Generated<boolean>; forecast_version: string | null; rule_version: string | null; engine_version: string | null; config_version: number | null; version: Generated<number>; expires_at: Ts | null; explanation: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; violations: Generated<unknown>; simulation: unknown | null; touches_confirmed_appointment: Generated<boolean>; apply_attempt: Generated<number>; explanation_source: string | null; explanation_language: string | null; decided_by_user_id: string | null; decided_at: Ts | null; applied_at: Ts | null; automated: Generated<boolean>; updated_by: string | null; }
export interface ScheduleRecommendationImpactsTable { id: Generated<string>; tenant_id: string; recommendation_id: string; before_metrics: unknown | null; after_metrics: unknown | null; deltas: unknown | null; created_at: Generated<Ts>; }
export interface ScheduleRecommendationDecisionsTable { id: Generated<string>; tenant_id: string; recommendation_id: string; action: string; actor_user_id: string | null; reason: string | null; before_snapshot: unknown | null; after_snapshot: unknown | null; created_at: Generated<Ts>; }
export interface ScheduleChangeProposalsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; recommendation_id: string | null; appointment_id: string; proposed_start: Ts | null; proposed_end: Ts | null; proposed_technician_id: string | null; status: Generated<string>; original_preserved: Generated<boolean>; expires_at: Ts | null; created_at: Generated<Ts>; customer_id: string | null; original_start: Ts | null; original_technician_id: string | null; notified_at: Ts | null; notification_attempts: Generated<number>; decided_at: Ts | null; decision_channel: string | null; decided_by_user_id: string | null; version: Generated<number>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface ScheduleChangeApplicationsTable { id: Generated<string>; tenant_id: string; recommendation_id: string | null; appointment_id: string | null; idempotency_key: string; status: Generated<string>; applied_via: string | null; schedule_version: number | null; external_ref: string | null; error_code: string | null; applied_by_user_id: string | null; applied_at: Ts | null; created_at: Generated<Ts>; attempt: Generated<number>; rolled_back_at: Ts | null; }
export interface ServiceDurationStatisticsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; service_id: string; technician_id: string | null; sample_size: Generated<number>; median_min: number | null; p25_min: number | null; p75_min: number | null; p90_min: number | null; trimmed_mean_min: number | null; stddev_min: number | null; computed_at: Generated<Ts>; }
export interface ServiceDurationRecommendationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; service_id: string; technician_id: string | null; action: string; current_min: number | null; suggested_min: number | null; reason: string | null; confidence: number | null; status: Generated<string>; created_at: Generated<Ts>; sample_size: Generated<number>; decided_by_user_id: string | null; decided_at: Ts | null; version: Generated<number>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface StaffingCoverageRecommendationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; date: string | null; time_range: unknown | null; state: string; missing_minutes: number | null; missing_skills: Generated<unknown>; recommended_action: string | null; confidence: number | null; status: Generated<string>; created_at: Generated<Ts>; run_id: string | null; decided_by_user_id: string | null; decided_at: Ts | null; version: Generated<number>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface AppointmentAvailabilityRecommendationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; date: string | null; time_range: unknown | null; technician_id: string | null; service_id: string | null; direction: string; reason: string | null; confidence: number | null; status: Generated<string>; created_at: Generated<Ts>; run_id: string | null; decided_by_user_id: string | null; decided_at: Ts | null; version: Generated<number>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface ScheduleConflictsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; type: string; severity: string; appointment_ids: Generated<unknown>; message: string | null; resolved: Generated<boolean>; detected_at: Generated<Ts>; run_id: string | null; technician_id: string | null; conflict_date: string | null; }
export interface ScheduleGapsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; technician_id: string | null; date: string | null; start_min: number | null; end_min: number | null; duration_min: number | null; cause: string | null; services_that_fit: Generated<unknown>; confidence: number | null; detected_at: Generated<Ts>; run_id: string | null; }
export interface TenantSchedulingAiSettingsTable { id: Generated<string>; tenant_id: string; level: Generated<string>; branch_id: string | null; enabled: boolean | null; kill_switch: boolean | null; config: unknown | null; version: Generated<number>; updated_by_user_id: string | null; updated_at: Generated<Ts>; updated_by: string | null; }
export interface SchedulingRuleVersionsTable { id: Generated<string>; tenant_id: string; level: string; branch_id: string | null; version: number; enabled: boolean | null; kill_switch: boolean | null; config: unknown | null; changed_by_user_id: string | null; created_at: Generated<Ts>; }
export interface OcrDocumentsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; uploaded_by_user_id: string | null; source_channel: Generated<string>; document_type: Generated<string>; classification_confidence: number | null; vendor: string | null; vendor_id: string | null; document_number: string | null; document_date: ColumnType<string | null, string | null, string | null>; date_ambiguous: Generated<boolean>; currency: Generated<string>; subtotal_cents: number | null; tax_cents: number | null; fees_cents: number | null; discount_cents: number | null; total_cents: number | null; is_credit_or_refund: Generated<boolean>; overall_confidence: number | null; pipeline_status: Generated<string>; validation_status: Generated<string>; review_status: Generated<string>; posting_status: Generated<string>; duplicate_status: Generated<string>; review_priority: Generated<string>; retention_hold: Generated<boolean>; retention_delete_after: ColumnType<string | null, string | null, string | null>; deleted_at: Ts | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; deleted_by: string | null; updated_by: string | null; page_count: Generated<number>; quality_flags: Generated<unknown>; extraction_attempts: Generated<number>; next_extraction_at: Ts | null; last_extraction_error: string | null; suggested_expense_id: string | null; suggested_match: string | null; retention_archived_at: Ts | null; }
export interface OcrDocumentFilesTable { id: Generated<string>; tenant_id: string; document_id: string; kind: Generated<string>; storage_key: string; mime_type: string | null; size_bytes: number | null; page_count: number | null; file_hash: string | null; perceptual_hash: string | null; scan_status: Generated<string>; created_at: Generated<Ts>; }
export interface OcrDocumentPagesTable { id: Generated<string>; tenant_id: string; document_id: string; page_number: number; storage_key: string | null; ocr_text_redacted: string | null; width: number | null; height: number | null; created_at: Generated<Ts>; }
export interface OcrJobsTable { id: Generated<string>; tenant_id: string; document_id: string; provider_key: string; provider_job_id: string | null; status: Generated<string>; attempt: Generated<number>; error_code: string | null; requested_at: Generated<Ts>; completed_at: Ts | null; }
export interface OcrExtractedFieldsTable { id: Generated<string>; tenant_id: string; document_id: string; field_key: string; value_text: string | null; value_cents: number | null; confidence: number | null; state: Generated<string>; source_page: number | null; corrected_value: string | null; corrected_by_user_id: string | null; corrected_at: Ts | null; created_at: Generated<Ts>; }
export interface OcrLineItemsTable { id: Generated<string>; tenant_id: string; document_id: string; line_number: number; description: string | null; sku: string | null; quantity: number | null; unit: string | null; unit_price_cents: number | null; discount_cents: number | null; tax_cents: number | null; line_total_cents: number | null; confidence: number | null; reconciles: boolean | null; created_at: Generated<Ts>; }
export interface OcrValidationResultsTable { id: Generated<string>; tenant_id: string; document_id: string; status: string; flags: Generated<unknown>; blocks_posting: Generated<boolean>; review_priority: Generated<string>; overall_confidence: number | null; missing_fields: Generated<unknown>; checks: Generated<unknown>; created_at: Generated<Ts>; }
export interface OcrDuplicateMatchesTable { id: Generated<string>; tenant_id: string; document_id: string; matched_document_id: string; status: string; reason: string | null; perceptual_distance: number | null; dismissed: Generated<boolean>; created_at: Generated<Ts>; }
export interface OcrVendorMatchesTable { id: Generated<string>; tenant_id: string; document_id: string; matched_vendor_id: string | null; matched_name: string | null; score: number | null; confirmed: Generated<boolean>; created_at: Generated<Ts>; }
export interface OcrCategorySuggestionsTable { id: Generated<string>; tenant_id: string; document_id: string; suggested_category_id: string | null; suggested_name: string | null; score: number | null; source: Generated<string>; confirmed: Generated<boolean>; created_at: Generated<Ts>; }
export interface OcrInventoryMatchesTable { id: Generated<string>; tenant_id: string; document_id: string; line_item_id: string | null; matched_product_id: string | null; matched_unit_id: string | null; score: number | null; confirmed: Generated<boolean>; created_at: Generated<Ts>; }
export interface OcrReviewsTable { id: Generated<string>; tenant_id: string; document_id: string; status: Generated<string>; assigned_user_id: string | null; started_by_user_id: string | null; started_at: Generated<Ts>; submitted_at: Ts | null; notes: string | null; decision_state: unknown; }
export interface OcrApprovalsTable { id: Generated<string>; tenant_id: string; document_id: string; action: string; actor_user_id: string | null; reason: string | null; before_snapshot: unknown | null; after_snapshot: unknown | null; version: number | null; created_at: Generated<Ts>; }
export interface OcrPostingsTable { id: Generated<string>; tenant_id: string; document_id: string; destination: string; posting_version: Generated<number>; external_ref: string | null; status: Generated<string>; idempotency_key: string; error_code: string | null; posted_by_user_id: string | null; posted_at: Ts | null; created_at: Generated<Ts>; }
export interface OcrPostingAttemptsTable { id: Generated<string>; tenant_id: string; posting_id: string; outcome: string; detail: unknown | null; created_at: Generated<Ts>; }
export interface TenantOcrAiSettingsTable { id: Generated<string>; tenant_id: string; level: Generated<string>; branch_id: string | null; enabled: boolean | null; config: unknown | null; version: Generated<number>; updated_by_user_id: string | null; updated_at: Generated<Ts>; updated_by: string | null; }
export interface OcrAiConfigVersionsTable { id: Generated<string>; tenant_id: string; level: string; branch_id: string | null; version: number; enabled: boolean | null; config: unknown | null; changed_by_user_id: string | null; created_at: Generated<Ts>; }
export interface IntegrationConnectionsTable { id: Generated<string>; tenant_id: string | null; branch_id: string | null; provider_key: string; category: string; ownership_type: Generated<string>; connection_status: Generated<string>; authentication_status: Generated<string>; sync_status: Generated<string>; webhook_status: Generated<string>; auth_method: string | null; credential_reference_id: string | null; configuration_version: Generated<number>; granted_scopes: Generated<string[]>; provider_account: string | null; token_expires_at: Ts | null; last_successful_sync_at: Ts | null; last_failed_sync_at: Ts | null; next_sync_at: Ts | null; disabled_reason: string | null; created_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface IntegrationCredentialReferencesTable { id: Generated<string>; connection_id: string; tenant_id: string | null; kind: string; secret_enc: string; masked_value: string | null; version: Generated<number>; status: Generated<string>; expires_at: Ts | null; created_by_user_id: string | null; created_at: Generated<Ts>; rotated_at: Ts | null; revoked_at: Ts | null; }
export interface NotificationOptOutsTable { tenant_id: string; channel: string; address: string; reason: string | null; opted_out_at: Generated<Ts>; scope: Generated<string>; }
// migration 741 (Customer Notifications): provider callbacks + consent history (append-only) and authorized resends
export interface NotificationDeliveryEventsTable { id: Generated<string>; tenant_id: string; notification_id: string | null; provider_message_sid: string; provider_status: string; error_code: string | null; applied: Generated<boolean>; signature_verified: boolean; received_at: Generated<Ts>; }
export interface NotificationConsentEventsTable { id: Generated<string>; tenant_id: string; channel: string; address: string; action: string; source: string; purpose: Generated<string>; reason: string | null; consent_note: string | null; actor_user_id: string | null; created_at: Generated<Ts>; }
// migration 748 (Email Center): claim-before-send keys + append-only provider health checks
export interface EmailSendKeysTable { tenant_id: string; idempotency_key: string; category: string; notification_id: string | null; created_at: Generated<Ts>; }
// migration 749 (Customer Retention & Win-Back): read-only "Check Retention Data" runs
export interface TenantBirthdaySettingsTable { tenant_id: string; feb29_policy: Generated<string>; version: Generated<number>; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; }
export interface BirthdayMessageClaimsTable { id: Generated<string>; tenant_id: string; customer_id: string; occasion_year: number; channel: string; campaign_id: string; status: Generated<string>; created_by: string | null; updated_by: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; }
export interface RetentionHealthRunsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; trigger: Generated<string>; overall: string; results: Generated<unknown>; ruleset_version: string; settings_version: number; duration_ms: Generated<number>; created_by_user_id: string | null; created_at: Generated<Ts>; }
export interface EmailHealthChecksTable { id: Generated<string>; tenant_id: string; trigger_type: string; configuration: string; sender_identity: string; provider_health: string; callbacks: string; overall: string; issue_code: string | null; detail: string | null; checked_by: string | null; checked_at: Generated<Ts>; }
export interface NotificationRetryRequestsTable { id: Generated<string>; tenant_id: string; original_notification_id: string; new_notification_id: string | null; idempotency_key: string; failure_category: string; outcome: string; refusal_code: string | null; requested_by: string | null; created_at: Generated<Ts>; }
export interface ReviewAnalysisTable { id: Generated<string>; tenant_id: string; branch_id: string | null; review_id: string; sentiment: string | null; severity: string | null; categories: Generated<unknown>; serious_signals: Generated<unknown>; escalation_required: Generated<boolean>; auto_response_eligible: Generated<boolean>; is_spam: Generated<boolean>; injection_suspected: Generated<boolean>; confidence: number | null; model_name: string | null; model_version: string | null; prompt_version: string | null; analysis_source: Generated<string>; processing_status: Generated<string>; analyzed_at: Generated<Ts>; }
export interface ReviewResponseDraftsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; review_id: string; status: Generated<string>; tone: string | null; current_text: string | null; current_version: Generated<number>; is_auto: Generated<boolean>; created_by_ai: Generated<boolean>; updated_at: Generated<Ts>; created_at: Generated<Ts>; updated_by: string | null; }
export interface ReviewResponseVersionsTable { id: Generated<string>; tenant_id: string; draft_id: string; review_id: string; version: number; text: string; edited_by_user_id: string | null; is_ai_generated: Generated<boolean>; created_at: Generated<Ts>; }
export interface ReviewApprovalsTable { id: Generated<string>; tenant_id: string; review_id: string; draft_id: string; action: string; actor_user_id: string | null; reason: string | null; version: number | null; created_at: Generated<Ts>; }
export interface ReviewPublicationsTable { id: Generated<string>; tenant_id: string; review_id: string; draft_id: string; published_by_user_id: string | null; result: string; external_response_id: string | null; error: string | null; is_auto: Generated<boolean>; created_at: Generated<Ts>; }
export interface ReviewEscalationsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; review_id: string; severity: string; signals: Generated<unknown>; status: Generated<string>; assigned_user_id: string | null; acknowledged_at: Ts | null; resolved_at: Ts | null; created_at: Generated<Ts>; }
export interface ReviewInternalNotesTable { id: Generated<string>; tenant_id: string; review_id: string; author_user_id: string | null; note: string; created_at: Generated<Ts>; }
export interface ReviewRecoveryActionsTable { id: Generated<string>; tenant_id: string; review_id: string; action_type: string; status: Generated<string>; created_by_user_id: string | null; external_ref: string | null; created_at: Generated<Ts>; }
export interface SchedulingOptimizerHealthRunsTable {   // migration 772 — read-only "Check Scheduling System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface AiUsageHealthRunsTable {   // migration 771 — read-only "Check AI Usage & Subscriptions" runs
  id: Generated<string>; tenant_id: string; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReceiptScannerHealthRunsTable {   // migration 770 — read-only "Check OCR System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReviewReputationSettingsHealthRunsTable {   // migration 769 — read-only "Check Reputation Settings" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReviewReputationHealthRunsTable {   // migration 768 — read-only "Check Reputation System" runs
  id: Generated<string>; tenant_id: string; branch_id: string | null; actor_user_id: string | null; overall: string; checks: Generated<unknown>; created_at: Generated<Ts>;
}
export interface ReviewRequestCampaignsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; name: string; channel: string; enabled: Generated<boolean>; config: Generated<unknown>; created_at: Generated<Ts>; }
export interface ReviewRequestsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; customer_id: string | null; appointment_id: string | null; campaign_id: string | null; channel: string; status: Generated<string>; idempotency_key: string; scheduled_for: Ts | null; sent_at: Ts | null; created_at: Generated<Ts>; }
export interface ReviewRequestEventsTable { id: Generated<string>; tenant_id: string; request_id: string; event: string; detail: unknown | null; created_at: Generated<Ts>; }
export interface ReputationSnapshotsTable { id: Generated<string>; tenant_id: string; branch_id: string | null; snapshot_date: string; avg_rating: number | null; review_count: Generated<number>; positive_pct: number | null; neutral_pct: number | null; negative_pct: number | null; response_rate: number | null; avg_response_minutes: number | null; serious_complaint_count: Generated<number>; metrics: Generated<unknown>; created_at: Generated<Ts>; }
export interface TenantAiReputationSettingsTable { id: Generated<string>; tenant_id: string; level: 'tenant' | 'branch'; branch_id: string | null; enabled: boolean | null; config: unknown | null; version: Generated<number>; updated_by_user_id: string | null; created_at: Generated<Ts>; updated_at: Generated<Ts>; updated_by: string | null; }
export interface AiReputationConfigVersionsTable { id: Generated<string>; tenant_id: string; level: string; branch_id: string | null; version: number; config: unknown | null; enabled: boolean | null; changed_by_user_id: string | null; created_at: Generated<Ts>;
  event_type: Generated<string>; before: unknown | null; changed_keys: Generated<string[]>; reason: string | null; actor_role: string | null; }   // 769 — History
// ---- merged from branch D (reconciliation/sidebar-wiring) ----
export interface ServiceAddOnsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; service_id: string;
  add_on_key: string; name: string; price_cents: number | string; duration_delta_minutes: number;
  is_taxable: boolean; is_active: boolean; sort_order: number; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface InvoicesTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; customer_id: string | null;
  invoice_number: string; status: string; issue_date: string; due_date: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number; notes: string | null;
  created_by_user_id: string | null; created_at: Ts; updated_at: Ts;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
  bill_to_name: string | null;
  bill_to_phone: string | null;
  bill_to_phone_digits: string | null;
  bill_to_email: string | null;
  discount_cents: Generated<string | number>;
  sent_at: TsNull;
  paid_at: TsNull;
  voided_at: TsNull;
  voided_by_user_id: string | null;
  void_reason: string | null;
  idempotency_key: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface InvoiceLinesTable {
  id: Generated<string>; invoice_id: string; tenant_id: string; description: string;
  quantity: number; unit_price_cents: number; line_total_cents: number; position: number;
}

// ── migration 427: SMS Verification Packages & Tenant Billing (Jul 29, 2026) ──
export interface SmsVerificationPackagesTable {
  id: Generated<string>; code: string; name: string; description: string | null;
  monthly_price_cents: Generated<number>; included_verification_count: Generated<number>;
  overage_enabled: Generated<boolean>; overage_unit_price_cents: Generated<number>;
  hard_limit_enabled: Generated<boolean>; warning_threshold_percent: Generated<number>;
  critical_threshold_percent: Generated<number>; self_service_available: Generated<boolean>;
  active: Generated<boolean>; display_order: Generated<number>;
  created_at: Generated<Date>; updated_at: Generated<Date>;
}
export interface TenantSmsSubscriptionsTable {
  id: Generated<string>; tenant_id: string; package_id: string; status: Generated<string>;
  started_at: Generated<Date>; effective_at: Generated<Date>; cancel_at_cycle_end: Generated<boolean>;
  custom_allowance: number | null; pending_package_id: string | null; pending_effective_at: Date | null;
  created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface TenantSmsPackageChangesTable {
  id: Generated<string>; tenant_id: string; previous_package_id: string | null; new_package_id: string;
  changed_by_user_id: string | null; changed_at: Generated<Date>; effective_at: Generated<Date>; reason: string;
}
export interface TenantSmsBillingCyclesTable {
  id: Generated<string>; tenant_id: string; package_id: string; cycle_start: Date; cycle_end: Date;
  package_code: string; package_name: string; monthly_price_cents: number; included_count: number;
  overage_enabled: boolean; overage_unit_price_cents: number; hard_limit_enabled: boolean;
  used_included: Generated<number>; overage_count: Generated<number>; failed_count: Generated<number>;
  credit_allowance: Generated<number>; status: Generated<string>;
  created_at: Generated<Date>; updated_at: Generated<Date>;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SmsReconciliationFindingsTable {
  id: Generated<string>; run_date: Date; tenant_id: string; cycle_id: string | null; finding_type: string;
  details: Generated<unknown>; status: Generated<string>; created_at: Generated<Date>; updated_at: Generated<Date>;
  resolved_at: Date | null; resolved_by: string | null;
  updated_by: string | null;   // migration 543 (Phase 10 actor stamps / retention executor)
}
export interface SmsUsageRecordsTable {
  id: Generated<string>; tenant_id: string; branch_id: string | null; package_id: string | null;
  billing_cycle_id: string | null; purpose: string; category: Generated<string>; provider: Generated<string>;
  provider_message_id: string | null; recipient_masked: string | null; status: Generated<string>;
  billable: Generated<boolean>; unit_price_cents: number | null; provider_cost_micros: number | null;
  requested_at: Generated<Date>; submitted_at: Date | null; delivered_at: Date | null; failed_at: Date | null;
  created_at: Generated<Date>;
}

// ── Appended Oct 30 2026 (types-drift): tables from the round-2 guides and migrations 724–731, introspected from the
//    migrated schema. Conventions as above: Ts/TsNull = timestamptz · ColumnType<string,string,string> = date · unknown = jsonb.
export interface AiBillingInvoiceEventsTable {
  id: Generated<string>;
  tenant_id: string | null;
  provider: string;
  provider_event_id: string;
  provider_invoice_id: string | null;
  event_type: string;
  outcome: string;
  reason: string | null;
  run_id: string | null;
  received_at: Generated<Ts>;
}
export interface AiBillingInvoiceLineSnapshotsTable {
  id: Generated<string>;
  tenant_id: string;
  invoice_link_id: string;
  provider_line_id: string;
  package_code: string | null;
  kind: string;
  description: string | null;
  quantity: Generated<number>;
  amount_cents: string | number;
  period_start: ColumnType<string | null, string | null, string | null>;
  period_end: ColumnType<string | null, string | null, string | null>;
  captured_at: Generated<Ts>;
}
export interface AiBillingInvoiceLinksTable {
  id: Generated<string>;
  tenant_id: string;
  provider: string;
  provider_invoice_id: string;
  invoice_number: string | null;
  package_code: string | null;
  subscription_id: string | null;
  status: string;
  currency: Generated<string>;
  invoice_date: ColumnType<string | null, string | null, string | null>;
  period_start: ColumnType<string | null, string | null, string | null>;
  period_end: ColumnType<string | null, string | null, string | null>;
  subtotal_cents: string | number | null;
  tax_cents: string | number | null;
  discount_cents: Generated<string | number>;
  credit_cents: Generated<string | number>;
  proration_cents: Generated<string | number>;
  total_cents: string | number | null;
  amount_paid_cents: Generated<string | number>;
  amount_refunded_cents: Generated<string | number>;
  amount_due_cents: string | number | null;
  finalized_at: TsNull;
  paid_at: TsNull;
  voided_at: TsNull;
  reference: string | null;
  provider_updated_at: Ts;
  snapshot_hash: string;
  source: string;
  last_event_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface AiBillingReconciliationRunsTable {
  id: Generated<string>;
  tenant_id: string;
  provider: string | null;
  trigger: string;
  status: string;
  idempotency_key: string | null;
  invoices_seen: Generated<number>;
  created_count: Generated<number>;
  updated_count: Generated<number>;
  unchanged_count: Generated<number>;
  stale_count: Generated<number>;
  rejected_count: Generated<number>;
  error_code: string | null;
  error_text: string | null;
  actor_user_id: string | null;
  started_at: Generated<Ts>;
  finished_at: TsNull;
}
export interface AiUsageAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  package_code: string;
  period_start: Ts;
  threshold: number;
  used: string | number;
  usage_limit: string | number;
  usage_unit: string;
  created_at: Generated<Ts>;
  acknowledged_at: TsNull;
  acknowledged_by_user_id: string | null;
}
export interface CatalogChangeLogTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  entity_type: string;
  entity_id: string;
  service_id: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  source: Generated<string>;
  actor_user_id: string | null;
  changed_at: Generated<Ts>;
  effective_at: Generated<Ts>;
}
export interface CommissionDiscrepancyReviewEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  review_id: string;
  actor_user_id: string | null;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  reason: string | null;
  safe_metadata_json: Generated<unknown>;
  request_id: string | null;
  created_at: Generated<Ts>;
}
export interface CommissionDiscrepancyReviewsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  finding_fingerprint: string;
  finding_type: string;
  verification_state: Generated<string>;
  status: Generated<string>;
  severity: Generated<string>;
  severity_reason: string | null;
  technician_id: string | null;
  service_line_id: string | null;
  transaction_id: string | null;
  refund_id: string | null;
  period_ref: string | null;
  expected_cents: string | number | null;
  recorded_cents: string | number | null;
  difference_cents: string | number | null;
  summary: string;
  evidence_json: Generated<unknown>;
  assigned_to_user_id: string | null;
  assigned_at: TsNull;
  investigating_at: TsNull;
  resolution_code: string | null;
  resolution_note: string | null;
  resolved_at: TsNull;
  resolved_by: string | null;
  dismiss_reason: string | null;
  dismissed_at: TsNull;
  dismissed_by: string | null;
  version: Generated<number>;
  detected_at: Generated<Ts>;
  last_seen_at: Generated<Ts>;
  scan_run_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface CommissionDiscrepancyScanRunsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  actor_user_id: string | null;
  period_from: ColumnType<string | null, string | null, string | null>;
  period_to: ColumnType<string | null, string | null, string | null>;
  status: Generated<string>;
  started_at: Generated<Ts>;
  finished_at: TsNull;
  summary_json: Generated<unknown>;
  request_id: string | null;
}
export interface CommunicationThreadEventsTable {
  id: Generated<string>;
  tenant_id: string;
  thread_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_kind: Generated<string>;
  previous_value: string | null;
  new_value: string | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: Generated<Ts>;
}
export interface CustomerRetentionDailySnapshotsTable {
  tenant_id: string;
  customer_id: string;
  snapshot_local_date: ColumnType<string, string, string>;
  definition_version: string;
  settings_version: number;
  segment: string;
  first_visit_at: TsNull;
  last_visit_at: TsNull;
  visit_count: Generated<number>;
  net_lifetime_value_cents: Generated<string | number>;
  days_away: number | null;
  data_quality: string;
  run_id: string;
  source_watermark: TsNull;
  calculated_at: Generated<Ts>;
  is_vip: boolean | null;
  loyalty_tier: string | null;
}
export interface CustomerRetentionSnapshotRunsTable {
  id: Generated<string>;
  tenant_id: string;
  snapshot_local_date: ColumnType<string, string, string>;
  definition_version: string;
  settings_version: number;
  segmentation_version: string;
  risk_days: number;
  approaching_days: number;
  time_zone: string;
  kind: string;
  status: string;
  coverage: string | null;
  coverage_reason: string | null;
  source_watermark: TsNull;
  earliest_ticket_at: TsNull;
  customers_count: Generated<number>;
  rows_written: Generated<number>;
  attempts: Generated<number>;
  last_error: string | null;
  job_id: string | null;
  requested_by_user_id: string | null;
  started_at: Generated<Ts>;
  finished_at: TsNull;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface HealthCheckAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  check_key: string;
  fingerprint: string;
  status: Generated<string>;
  severity: string;
  last_status: string;
  occurrences: Generated<number>;
  first_seen_at: Generated<Ts>;
  last_seen_at: Generated<Ts>;
  resolved_at: TsNull;
  escalated_at: TsNull;
  acknowledged_at: TsNull;
  acknowledged_by_user_id: string | null;
  last_run_id: string | null;
}
export interface HealthCheckResultsTable {
  id: Generated<string>;
  run_id: string;
  tenant_id: string;
  branch_id: string | null;
  area: string;
  check_key: string;
  status: string;
  severity: string;
  source: string;
  verified_at: TsNull;
  expires_at: TsNull;
  last_good_at: TsNull;
  detail_json: Generated<unknown>;
  created_at: Generated<Ts>;
}
export interface HealthCheckRunsTable {
  id: Generated<string>;
  tenant_id: string;
  trigger_kind: string;
  run_date: ColumnType<string, string, string>;
  status: Generated<string>;
  summary_json: Generated<unknown>;
  error: string | null;
  requested_by_user_id: string | null;
  started_at: Generated<Ts>;
  finished_at: TsNull;
}
export interface InventoryVendorContactsTable {
  id: Generated<string>;
  tenant_id: string;
  vendor_id: string;
  name: string;
  role: string | null;
  mobile_phone: string | null;
  office_phone: string | null;
  email: string | null;
  preferred_method: string | null;
  is_primary: Generated<boolean>;
  active: Generated<boolean>;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;
}
export interface InventoryVendorProductsTable {
  id: Generated<string>;
  tenant_id: string;
  vendor_id: string;
  product_id: string;
  supplier_sku: string | null;
  last_cost_cents: number | null;
  purchase_unit: string | null;
  units_per_purchase_unit: Generated<number>;
  minimum_order_qty: number | null;
  lead_time_days: number | null;
  is_preferred: Generated<boolean>;
  currency: Generated<string>;
  active: Generated<boolean>;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;
}
export interface InvoicePaymentsTable {
  id: Generated<string>;
  tenant_id: string;
  invoice_id: string;
  amount_cents: string | number;
  currency: Generated<string>;
  paid_on: ColumnType<string, string, string>;
  method: string;
  reference: string | null;
  note: string | null;
  idempotency_key: string;
  recorded_by_user_id: string | null;
  created_at: Generated<Ts>;
}
export interface PerformanceScoreSnapshotsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  technician_id: string;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  model_version: string;
  components_json: unknown;
  missing_json: Generated<unknown>;
  score: string | number | null;
  input_checksum: string;
  computed_at: Generated<Ts>;
  computed_by: string | null;
}
export interface PlatformAiPackageSettingsTable {
  package_code: string;
  enabled: Generated<boolean>;
  disabled_reason: string | null;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}
export interface ProductUsageAdjustmentsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  usage_event_id: string;
  delta_hundredths: number;
  reason: string;
  actor_user_id: string | null;
  idempotency_key: string | null;
  restored_json: Generated<unknown>;
  stock_before_hundredths: number;
  stock_after_hundredths: number;
  created_at: Generated<Ts>;
}
export interface ProductUsageEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  technician_id: string;
  quantity_hundredths: number;
  unit: string;
  occurred_at: Ts;
  created_at: Generated<Ts>;
  created_by_user_id: string | null;
  source: string;
  status: Generated<string>;
  service_ticket_id: string | null;
  inventory_unit_id: string | null;
  note: string | null;
  on_behalf_reason: string | null;
  idempotency_key: string | null;
  correlation_id: Generated<string>;
  consumed_json: Generated<unknown>;
  short_hundredths: Generated<number>;
  stock_before_hundredths: number;
  stock_after_hundredths: number;
  bottles_before: number;
  bottles_after: number;
}
export interface ReconciliationAllocationsTable {
  id: Generated<string>;
  tenant_id: string;
  settlement_id: string;
  deposit_id: string;
  amount_cents: string | number;
  currency: Generated<string>;
  source: Generated<string>;
  evidence_json: Generated<unknown>;
  note: string | null;
  idempotency_key: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
  unmatched_at: TsNull;
  unmatched_by_user_id: string | null;
  unmatch_reason: string | null;
}
export interface ReconciliationNotesTable {
  id: Generated<string>;
  tenant_id: string;
  target_type: string;
  target_id: string;
  body: string;
  author_user_id: string | null;
  author_role: string | null;
  created_at: Generated<Ts>;
}
export interface ReleaseEvidenceTable {
  id: Generated<string>;
  kind: string;
  app_version: string;
  commit_sha: string | null;
  reference: string | null;
  outcome: string;
  summary: string | null;
  recorded_by_user_id: string | null;
  recorded_at: Generated<Ts>;
}
// 736 — Coupons & Promotions assistant: one insert-only audit row per suggestion saved as a draft coupon
export interface CouponAssistantDraftsTable {
  id: Generated<string>;
  tenant_id: string;
  deal_id: string;
  goal: string;
  method: Generated<string>;
  basis_json: Generated<unknown>;
  suggested_json: unknown;
  final_json: unknown;
  edited_fields: Generated<string[]>;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
}
export interface PromotionEligibilityChecksTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  deal_id: string;
  ticket_id: string | null;
  customer_id: string | null;
  verdict: string;
  eligible: boolean;
  reasons_json: Generated<unknown>;
  spend_cents: string | number | bigint | null;
  eligible_base_cents: string | number | bigint | null;
  discount_preview_cents: string | number | bigint | null;
  source: Generated<string>;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
}
export interface SegmentAudienceDraftsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  channel: string;
  status: Generated<string>;
  ruleset_version: string;
  segment: string;
  selection_mode: string;
  filters_json: Generated<unknown>;
  selected_count: Generated<number>;
  eligible_count: Generated<number>;
  excluded_count: Generated<number>;
  excluded_reasons_json: Generated<unknown>;
  message_preview: string | null;
  estimated_cost_cents: number | null;
  campaign_id: string | null;
  idempotency_key: string;
  created_by_user_id: string | null;
  updated_by: string | null;
  expires_at: Ts;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}
export interface SegmentAudienceMembersTable {
  draft_id: string;
  tenant_id: string;
  customer_id: string;
  eligibility: string;
  destination_masked: string | null;
  created_at: Generated<Ts>;
}
export interface RetentionSmsCampaignsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  status: Generated<string>;
  label: string | null;
  body: string;
  body_sha256: string;
  segments_per_message: Generated<number>;
  audience_json: Generated<unknown>;
  selected_count: Generated<number>;
  eligible_count: Generated<number>;
  excluded_count: Generated<number>;
  excluded_reasons_json: Generated<unknown>;
  queued_count: Generated<number>;
  sender_from: string | null;
  created_by_user_id: string | null;
  confirmed_by_user_id: string | null;
  idempotency_key: string | null;
  expires_at: Generated<Ts>;
  created_at: Generated<Ts>;
  confirmed_at: TsNull;
  completed_at: TsNull;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface RetentionSmsRecipientsTable {
  id: Generated<string>;
  campaign_id: string;
  tenant_id: string;
  customer_id: string;
  destination: string | null;
  eligibility: string;
  status: Generated<string>;
  notification_id: string | null;
  provider_id: string | null;
  error: string | null;
  queued_at: TsNull;
  submitted_at: TsNull;
  sent_at: TsNull;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface SmsTestEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  idempotency_key: string;
  destination_masked: string;
  destination_hash: string;
  sender: string | null;
  provider_message_sid: string | null;
  status: Generated<string>;
  error_code: string | null;
  warning_codes: Generated<string[]>;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
  status_updated_at: Generated<Ts>;
  delivered_at: TsNull;
  config_source: string | null;
  account_sid_last4: string | null;
  sender_kind: string | null;
}
export interface TeamDataAlertEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  alert_id: string;
  actor_user_id: string | null;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  reason: string | null;
  safe_metadata_json: Generated<unknown>;
  request_id: string | null;
  created_at: Generated<Ts>;
}
export interface TeamDataAlertRunsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  actor_user_id: string | null;
  status: Generated<string>;
  started_at: Generated<Ts>;
  finished_at: TsNull;
  summary_json: Generated<unknown>;
  request_id: string | null;
  run_trigger: Generated<string>;
  run_date: ColumnType<string | null, string | null, string | null>;
}
export interface TeamDataAlertsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  fingerprint: string;
  alert_type: string;
  status: Generated<string>;
  severity: Generated<string>;
  user_id: string | null;
  technician_id: string | null;
  related_user_id: string | null;
  related_technician_id: string | null;
  subject_date: ColumnType<string | null, string | null, string | null>;
  period_ref: string | null;
  summary: string;
  evidence_json: Generated<unknown>;
  assigned_to_user_id: string | null;
  assigned_at: TsNull;
  investigating_at: TsNull;
  resolution_note: string | null;
  resolved_at: TsNull;
  resolved_by: string | null;
  dismiss_reason: string | null;
  dismissed_at: TsNull;
  dismissed_by: string | null;
  version: Generated<number>;
  detected_at: Generated<Ts>;
  last_seen_at: Generated<Ts>;
  run_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  seen_count: Generated<number>;
  last_run_id: string | null;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamDataNightlyRunsTable {
  id: Generated<string>;
  tenant_id: string;
  run_date: ColumnType<string, string, string>;
  status: Generated<string>;
  attempts: Generated<number>;
  job_id: string | null;
  alert_run_id: string | null;
  last_error: string | null;
  summary_json: Generated<unknown>;
  escalated_at: TsNull;
  started_at: Generated<Ts>;
  finished_at: TsNull;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamOnboardingRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  idempotency_key: string;
  request_hash: string;
  actor_user_id: string | null;
  user_id: string | null;
  job_role: string | null;
  status: Generated<string>;
  result_json: Generated<unknown>;
  created_at: Generated<Ts>;
}
export interface TeamStaffCertificationsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  name: string;
  issuer: string | null;
  credential_ref: string | null;
  issued_on: ColumnType<string | null, string | null, string | null>;
  expires_on: ColumnType<string | null, string | null, string | null>;
  verification_status: Generated<string>;
  verified_by: string | null;
  verified_at: TsNull;
  verification_note: string | null;
  created_by: string | null;
  version: Generated<number>;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamStaffProfilesTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  technician_id: string | null;
  job_role: string | null;
  job_role_label: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_visible_to_team: Generated<boolean>;
  birthday_updated_at: TsNull;
  birthday_updated_by: string | null;
  onboarded_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamTrainingAssignmentsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  course_id: string;
  user_id: string | null;
  technician_id: string | null;
  status: Generated<string>;
  due_date: ColumnType<string | null, string | null, string | null>;
  assigned_by: string | null;
  assigned_at: Generated<Ts>;
  started_at: TsNull;
  completed_at: TsNull;
  completed_on: ColumnType<string | null, string | null, string | null>;
  expires_on: ColumnType<string | null, string | null, string | null>;
  expired_at: TsNull;
  canceled_at: TsNull;
  cancel_reason: string | null;
  completion_note: string | null;
  technician_certification_id: string | null;
  staff_certification_id: string | null;
  version: Generated<number>;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamTrainingCoursesTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  category: string | null;
  description: string | null;
  validity_months: number | null;
  certification_name: string | null;
  status: Generated<string>;
  version: Generated<number>;
  created_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TeamTrainingEventsTable {
  id: Generated<string>;
  tenant_id: string;
  assignment_id: string | null;
  course_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_user_id: string | null;
  reason: string | null;
  metadata_json: Generated<unknown>;
  request_id: string | null;
  created_at: Generated<Ts>;
}
export interface TechCashHandoffEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  technician_id: string;
  business_date: ColumnType<string, string, string>;
  handoff_id: string | null;
  event_type: string;
  amount_cents: string | number | null;
  expected_cents: string | number | null;
  counted_total_cents: string | number | null;
  variance_cents: string | number | null;
  denominations_json: unknown | null;
  reason: string | null;
  actor_user_id: string | null;
  drawer_movement_id: string | null;
  idempotency_key: string | null;
  created_at: Generated<Ts>;
}
export interface TechnicianShiftOverrideEventsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  technician_id: string;
  local_shift_date: ColumnType<string, string, string>;
  action: string;
  before_json: unknown | null;
  after_json: unknown | null;
  reason: string | null;
  actor_user_id: string | null;
  request_id: string | null;
  created_at: Generated<Ts>;
}
export interface TechnicianShiftOverridesTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  technician_id: string;
  local_shift_date: ColumnType<string, string, string>;
  timezone: string;
  override_type: string;
  start_local_time: string | null;
  end_local_time: string | null;
  ends_next_day: Generated<boolean>;
  breaks_json: Generated<unknown>;
  note: string | null;
  version: Generated<number>;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}
export interface TenantAiBranchSettingsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  package_code: string;
  override_enabled: boolean | null;
  settings_json: Generated<unknown>;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TenantAiBranchSettingsHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string;
  package_code: string;
  version: number;
  from_override: boolean | null;
  to_override: boolean | null;
  from_settings: unknown | null;
  to_settings: unknown;
  actor_user_id: string | null;
  actor_role: string | null;
  reason: string | null;
  created_at: Generated<Ts>;
}
export interface TenantAiSubscriptionEventsTable {
  id: Generated<string>;
  tenant_id: string;
  package_code: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  actor_role: string | null;
  idempotency_key: string;
  created_at: Generated<Ts>;
}
export interface TenantMessagingHealthChecksTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  config_source: Generated<string>;
  config_fingerprint: string | null;
  trigger_kind: Generated<string>;
  account_state: string;
  account_reason_code: string | null;
  account_status: string | null;
  account_type: string | null;
  auth_mode: string | null;
  api_key_state: string | null;
  sender_number: string | null;
  sender_state: string | null;
  sender_capabilities: unknown | null;
  inbound_url_state: string | null;
  verify_state: string | null;
  verify_reason_code: string | null;
  duration_ms: number | null;
  checked_by_user_id: string | null;
  checked_at: Generated<Ts>;
  numbers_inbound: unknown | null;
  api_key_scope: string | null;
}
export interface TenantMessagingRegistrationSnapshotsTable {
  id: Generated<string>;
  tenant_id: string;
  run_id: string | null;
  item_kind: string;
  provider_id: string | null;
  raw_status: string | null;
  normalized_state: string;
  verified: Generated<boolean>;
  source: string;
  account_source: string | null;
  error_class: string | null;
  details: Generated<unknown>;
  checked_at: Generated<Ts>;
  last_success_at: TsNull;
  retry_count: Generated<number>;
  next_retry_at: TsNull;
}
export interface TenantMessagingRegistrationSyncRunsTable {
  id: Generated<string>;
  tenant_id: string;
  trigger_kind: string;
  idempotency_key: string;
  account_source: string | null;
  outcome: Generated<string>;
  error_class: string | null;
  items_checked: Generated<number>;
  requested_by_user_id: string | null;
  started_at: Generated<Ts>;
  finished_at: TsNull;
}
export interface TenantMessagingWebhookActivityTable {
  tenant_id: string;
  webhook_kind: string;
  first_verified_at: Generated<Ts>;
  last_verified_at: Generated<Ts>;
  events_verified: Generated<string | number>;
}
export interface TenantNumberPurchaseQuotesTable {
  id: Generated<string>;
  tenant_id: string;
  token_hash: string;
  phone_number: string;
  price_amount: string | null;
  price_unit: string | null;
  capabilities: unknown | null;
  own_account: Generated<boolean>;
  expires_at: Ts;
  created_by_user_id: string | null;
  created_at: Generated<Ts>;
  consumed_at: TsNull;
  result_status: Generated<string | null>;
  result_number: string | null;
  result_error_code: string | null;
}
export interface TenantRetentionSettingsTable {
  tenant_id: string;
  risk_days: Generated<number>;
  approaching_days: Generated<number>;
  observation_window_days: Generated<number>;
  version: Generated<number>;
  updated_by_user_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;   // drift patch Oct 30 2026 (migrations 724–732)
}
export interface TenantRetentionSettingsHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  version: number;
  risk_days: number;
  approaching_days: number;
  observation_window_days: number;
  effective_from: Ts;
  source: Generated<string>;
  changed_by_user_id: string | null;
  created_at: Generated<Ts>;
}
export interface TenantSmsPricingTable {
  id: Generated<string>;
  tenant_id: string;
  currency: Generated<string>;
  retail_price_per_segment: string | number;
  carrier_fee_per_segment: string | number | null;
  tax_rate_percent: string | number | null;
  effective_from: Generated<Ts>;
  note: string | null;
  set_by_user_id: string | null;
  set_by_role: string | null;
  created_at: Generated<Ts>;
}

// ── Global Loyalty & Rewards Network (migration 733) ──
export interface GlobalEarningRuleVersionsTable {
  id: Generated<string>;
  version_no: number;
  spend_increment_cents: number;
  point_tenths_per_increment: number;
  min_eligible_cents: Generated<number>;
  per_ticket_cap_tenths: number | null;
  rounding_mode: Generated<string>;
  effective_from: Ts;
  status: Generated<string>;
  reason: string | null;
  published_by: string | null;
  canceled_by: string | null;
  canceled_at: TsNull;
  created_at: Generated<Ts>;
}

export interface GlobalPointsLedgerTable {
  id: Generated<string>;
  identity_id: string;
  entry_type: string;
  delta_tenths: string | number | bigint;
  balance_after_tenths: string | number | bigint;
  tenant_id: string;
  branch_id: string | null;
  source_table: string;
  source_id: string;
  created_at: Generated<Ts>;
}

export interface GlobalRewardsAccountsTable {
  identity_id: string;
  status: Generated<string>;
  available_tenths: Generated<string | number | bigint>;
  reserved_tenths: Generated<string | number | bigint>;
  lifetime_earned_tenths: Generated<string | number | bigint>;
  lifetime_redeemed_tenths: Generated<string | number | bigint>;
  terms_version: string;
  enrolled_at: Generated<Ts>;
  enrolled_via: string;
  version: Generated<string | number | bigint>;
  updated_at: Generated<Ts>;
  opted_in_at: TsNull;
  consent_source: string | null;
  withdrawn_at: TsNull;
  withdrawal_reason: string | null;
}

export interface GlobalRewardsEnrollmentsTable {
  tenant_id: string;
  status: Generated<string>;
  earning_suspended: Generated<boolean>;
  purchasing_suspended: Generated<boolean>;
  terms_version: string;
  enrolled_at: Generated<Ts>;
  enrolled_by: string | null;
  reason: string | null;
  updated_by: string | null;
  updated_at: Generated<Ts>;
}

export interface GlobalRewardsProgramTable {
  id: Generated<number>;
  earn_paused: Generated<boolean>;
  redeem_paused: Generated<boolean>;
  purchases_paused: Generated<boolean>;
  reimbursements_paused: Generated<boolean>;
  points_per_redeem_block: Generated<number>;
  redeem_block_value_cents: Generated<number>;
  token_value_cents: Generated<number>;
  custom_min_spend_increment_cents: Generated<number>;
  custom_max_spend_increment_cents: Generated<number>;
  custom_max_point_tenths_per_increment: Generated<number>;
  custom_min_eligible_floor_cents: Generated<number>;
  max_point_tenths_per_ticket: Generated<number>;
  low_balance_cents: Generated<number>;
  critical_balance_cents: Generated<number>;
  reservation_ttl_seconds: Generated<number>;
  purchase_presets_tokens: Generated<number[]>;
  max_purchase_tokens: Generated<number>;
  terms_version: Generated<string>;
  version: Generated<number>;
  updated_by: string | null;
  updated_at: Generated<Ts>;
}

export interface MerchantReimbursementsTable {
  id: Generated<string>;
  tenant_id: string;
  redemption_id: string;
  amount_cents: string | number | bigint;
  status: Generated<string>;
  batch_id: string | null;
  provider: string | null;
  provider_ref: string | null;
  paid_at: TsNull;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  branch_id: string | null;
  ticket_id: string | null;
  currency: Generated<string>;
  adjusted_cents: Generated<string | number | bigint>;
  reason: string | null;
  hold_reason: string | null;
  eligible_at: TsNull;
  payout_attempt_id: string | null;
  version: Generated<number>;
}

export interface RewardEarnTransactionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  ticket_id: string;
  customer_id: string | null;
  identity_id: string | null;
  effective_at: Ts;
  eligible_cents: string | number | bigint;
  rule_source: string | null;
  rule_version_id: string | null;
  spend_increment_cents: number | null;
  point_tenths_per_increment: number | null;
  min_eligible_cents: number | null;
  per_ticket_cap_tenths: number | null;
  rounding_mode: string | null;
  cents_per_point_tenth: number | null;
  point_tenths: Generated<string | number | bigint>;
  backing_cents: Generated<string | number | bigint>;
  status: string;
  block_reason: string | null;
  reversed_tenths: Generated<string | number | bigint>;
  reversed_backing_cents: Generated<string | number | bigint>;
  source_event_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  updated_by: string | null;
}

export interface RewardRedemptionsTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  ticket_id: string;
  identity_id: string;
  point_tenths: string | number | bigint;
  value_cents: string | number | bigint;
  status: Generated<string>;
  idempotency_key: string;
  expires_at: Ts;
  reserved_by: string | null;
  committed_at: TsNull;
  released_at: TsNull;
  release_reason: string | null;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  customer_id: string | null;
  payment_id: string | null;
  row_version: Generated<number>;
  confirmed_at: TsNull;
  reversed_tenths: Generated<string | number | bigint>;
  reversed_cents: Generated<string | number | bigint>;
  currency: Generated<string>;
  correlation_id: string | null;
}

export interface PayoutAttemptsTable {
  id: Generated<string>;
  tenant_id: string;
  reimbursement_id: string;
  provider: string;
  idempotency_key: string;
  amount_cents: string | number | bigint;
  currency: Generated<string>;
  status: Generated<string>;
  provider_payout_id: string | null;
  settlement_ref: string | null;
  settled_amount_cents: string | number | bigint | null;
  signature_verified: Generated<boolean>;
  provider_event_id: string | null;
  failure_code: string | null;
  settled_at: TsNull;
  requested_by: string | null;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface ReimbursementAdjustmentsTable {
  id: Generated<string>;
  tenant_id: string;
  reimbursement_id: string;
  kind: string;
  amount_cents: string | number | bigint;
  source_table: string;
  source_id: string;
  reason: string;
  created_at: Generated<Ts>;
}

export interface RewardsReconRunsTable {
  id: Generated<string>;
  run_key: string;
  trigger: string;
  cutoff_at: Ts;
  status: Generated<string>;
  checks_total: Generated<number>;
  checks_failed: Generated<number>;
  checks_warning: Generated<number>;
  attempts: Generated<number>;
  error: string | null;
  started_at: Generated<Ts>;
  finished_at: TsNull;
  duration_ms: number | null;
  requested_by: string | null;
}

export interface RewardsReconFindingsTable {
  id: Generated<string>;
  run_id: string;
  check_type: string;
  outcome: string;
  severity: string;
  tenant_id: string | null;
  expected_cents: string | number | bigint | null;
  actual_cents: string | number | bigint | null;
  delta_cents: string | number | bigint | null;
  affected_ids: Generated<unknown>;
  detail: string;
  recommended_action: string | null;
  review_status: Generated<string>;
  assigned_to: string | null;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  review_note: string | null;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface LoyaltyFraudAlertsTable {
  id: Generated<string>;
  signal: string;
  severity: string;
  confidence: string | number;
  dedupe_key: string;
  identity_id: string | null;
  tenant_id: string | null;
  evidence: Generated<unknown>;
  status: Generated<string>;
  reviewed_by: string | null;
  reviewed_at: TsNull;
  review_note: string | null;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface RewardsJournalEntriesTable {
  id: Generated<string>;
  entry_type: string;
  tenant_id: string | null;
  source_table: string;
  source_id: string;
  memo: string | null;
  created_at: Generated<Ts>;
}

export interface RewardsJournalLinesTable {
  id: Generated<string>;
  entry_id: string;
  account: string;
  tenant_id: string | null;
  debit_cents: Generated<string | number | bigint>;
  credit_cents: Generated<string | number | bigint>;
  created_at: Generated<Ts>;
}

export interface TenantEarningPolicyVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  version_no: number;
  mode: string;
  spend_increment_cents: number | null;
  point_tenths_per_increment: number | null;
  min_eligible_cents: number | null;
  per_ticket_cap_tenths: number | null;
  rounding_mode: Generated<string>;
  effective_from: TsNull;
  status: Generated<string>;
  reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  activated_by: string | null;
  activated_at: TsNull;
  canceled_by: string | null;
  canceled_at: TsNull;
  record_version: Generated<number>;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface TenantTokenWalletsTable {
  tenant_id: string;
  available_cents: Generated<string | number | bigint>;
  lifetime_funded_cents: Generated<string | number | bigint>;
  lifetime_allocated_cents: Generated<string | number | bigint>;
  deficit_cents: Generated<string | number | bigint>;
  status: Generated<string>;
  alert_level: Generated<string>;
  version: Generated<string | number | bigint>;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface TokenPurchaseEventsTable {
  id: Generated<string>;
  tenant_id: string;
  intent_id: string;
  from_status: string | null;
  to_status: string;
  source: string;
  detail: Generated<unknown>;
  actor_user_id: string | null;
  created_at: Generated<Ts>;
}

export interface TokenPurchaseIntentsTable {
  id: Generated<string>;
  tenant_id: string;
  token_cents: string | number | bigint;
  amount_cents: string | number | bigint;
  fee_cents: Generated<string | number | bigint>;
  currency: Generated<string>;
  status: Generated<string>;
  idempotency_key: string;
  provider: string;
  provider_ref: string | null;
  policy_snapshot: Generated<unknown>;
  initiated_by: string | null;
  failure_code: string | null;
  confirmed_at: TsNull;
  funded_at: TsNull;
  updated_by: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
}

export interface TokenWalletLedgerTable {
  id: Generated<string>;
  tenant_id: string;
  branch_id: string | null;
  entry_type: string;
  delta_cents: string | number | bigint;
  balance_after_cents: string | number | bigint;
  source_table: string;
  source_id: string;
  actor_user_id: string | null;
  reason: string | null;
  created_at: Generated<Ts>;
}
