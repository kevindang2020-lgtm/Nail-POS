-- 322_ai_booking_conversion_campaign_id.sql — closes the campaign→booking attribution loop.
-- Campaign booking links ALREADY carry a campaignId (ai-booking-link.mint → signed token → resolveFromToken →
-- AiBookingContext.campaignId), and the booking-success path records a BOOKING_SUCCEEDED conversion event with
-- that ctx. But ai_booking_conversion_events had no campaign_id column, so the campaign was dropped at record
-- time. This adds the column (nullable, additive, backward-compatible) so a booking made through a campaign
-- link can be attributed to its campaign. Append-only analytics; the authoritative booking stays in appointments.
alter table ai_booking_conversion_events add column if not exists campaign_id uuid;

-- Attribution read: count succeeded bookings per campaign, tenant-scoped.
create index if not exists idx_ai_booking_conv_campaign
  on ai_booking_conversion_events (tenant_id, campaign_id, stage);
