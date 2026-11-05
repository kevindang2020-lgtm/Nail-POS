-- 077_go_checkin_device_enums.sql
-- Align go_checkin_devices.device_type and .status with the full Go Check-In spec device types/statuses, so a device
-- can be created as any of the spec's kinds (e.g. browser_kiosk, qr_code) and marked 'expired'. Idempotent.
ALTER TABLE go_checkin_devices DROP CONSTRAINT IF EXISTS go_checkin_devices_device_type_check;
ALTER TABLE go_checkin_devices ADD CONSTRAINT go_checkin_devices_device_type_check
  CHECK (device_type IN ('kiosk','ipad','l_shape_display','tablet','front_desk',
                         'ipad_display','tablet_kiosk','browser_kiosk','front_desk_shared','qr_code'));
ALTER TABLE go_checkin_devices DROP CONSTRAINT IF EXISTS go_checkin_devices_status_check;
ALTER TABLE go_checkin_devices ADD CONSTRAINT go_checkin_devices_status_check
  CHECK (status IN ('active','inactive','disabled','revoked','expired'));
