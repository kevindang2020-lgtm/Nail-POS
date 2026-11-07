-- 835_tenant_consistency_alert_incidents.sql — B-12 (Nov 6 2026): migration 826 (A2 alert incidents) added two salon-owned
-- tables whose event_id points at ai_business_alert_events with no enforce_tenant_consistency trigger, so a delivery row or
-- an incident note could name another salon's alert event. Same trigger as every other tenant→tenant key (786).
DROP TRIGGER IF EXISTS trg_tc_ai_business_alert_deliveries__event_id ON ai_business_alert_deliveries;
CREATE TRIGGER trg_tc_ai_business_alert_deliveries__event_id BEFORE INSERT OR UPDATE OF tenant_id, event_id ON ai_business_alert_deliveries FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('ai_business_alert_events', 'event_id');
DROP TRIGGER IF EXISTS trg_tc_ai_business_alert_incident_notes__event_id ON ai_business_alert_incident_notes;
CREATE TRIGGER trg_tc_ai_business_alert_incident_notes__event_id BEFORE INSERT OR UPDATE OF tenant_id, event_id ON ai_business_alert_incident_notes FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('ai_business_alert_events', 'event_id');
