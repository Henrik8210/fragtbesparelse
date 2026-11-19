-- Run in the Supabase SQL editor after notifications.sql. The app does not run it.
-- Without it, format_change notices still appear, without the list of what changed.
alter table public.notifications add column if not exists detail jsonb;
