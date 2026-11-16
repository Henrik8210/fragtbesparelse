-- Run in the Supabase SQL editor. No RLS. The app does not create these tables.

create table if not exists public.invoice_mail (
  id text primary key,
  company_id text not null references public.companies (id),
  sender text not null,
  subject text not null,
  received_at timestamptz not null default now(),
  unique (id, company_id)
);

create table if not exists public.invoice_mail_files (
  id text primary key,
  mail_id text not null,
  company_id text not null references public.companies (id),
  filename text not null,
  mime text not null,
  byte_size integer not null,
  content bytea not null,
  foreign key (mail_id, company_id) references public.invoice_mail (id, company_id)
);

create index if not exists invoice_mail_company_received
  on public.invoice_mail (company_id, received_at desc);
