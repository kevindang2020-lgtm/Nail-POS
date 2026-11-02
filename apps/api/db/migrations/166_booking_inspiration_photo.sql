-- 166_booking_inspiration_photo.sql — "Book This Look": link a customer booking to the portfolio photo that inspired it (epic Req §11).
-- Nullable; no FK (the photo may later be removed, but the booking's human-readable note in `notes` preserves the context).
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS inspiration_photo_id UUID;
