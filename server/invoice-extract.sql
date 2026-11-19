-- Run in the Supabase SQL editor. No RLS. The app does not create this table.
-- Without it, extracted invoice lines are cached in the running container only.

create table if not exists public.invoice_extracts (
  company_id text not null references public.companies (id),
  content_sha256 text not null,
  version integer not null,
  model text not null,
  confidence text not null,
  extract jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_id, content_sha256)
);
