-- Checked invoices on Fakturaer. Run in the Supabase SQL editor. No RLS. The app does not create this table.
-- Without it, checks are kept in the running container until it restarts.
create table if not exists public.invoice_checks (
  company_id text not null references public.companies (id),
  file_id text not null references public.invoice_mail_files (id) on delete cascade,
  original jsonb not null,
  lines jsonb not null,
  changed boolean not null default false,
  checked_by text not null,
  checked_by_name text not null,
  checked_at timestamptz not null default now(),
  first_checked_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,
  primary key (company_id, file_id)
);
