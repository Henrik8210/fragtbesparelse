-- Already in Supabase. The app does not create this table. Kept here as the reference for tests.
-- kind 'demo': name, company and email come from Prøv vores demo.
-- kind 'invoice': id is the invoice_mail id, name is the carrier, company is the company id, email is the sender.

create table if not exists public.notifications (
  id text primary key,
  kind text not null,
  name text not null,
  company text not null,
  email text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
