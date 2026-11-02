-- 433_user_avatar_url.sql — add avatar_url column to users table for user profile avatars
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
