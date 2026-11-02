-- 071_follow_up_manager_approval.sql — extends service_follow_up_tasks.status with 'pending_manager_approval' for the
-- optional manager-approval workflow (when daily_follow_up_settings.require_manager_approval is on, a tech's send is
-- held for a manager to approve before it reaches the customer). Idempotent: drops the existing status CHECK (by its
-- default auto-name and by the new name) before adding the widened one, so re-applying is a no-op.
ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_check;
ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_chk;
ALTER TABLE service_follow_up_tasks
  ADD CONSTRAINT service_follow_up_tasks_status_chk
  CHECK (status IN ('pending','pending_manager_approval','sent','skipped','dismissed','failed','customer_not_available','customer_replied','rebooked'));
