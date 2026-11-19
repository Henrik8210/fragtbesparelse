-- The price agreement a person chose for one invoice file, instead of the one valid on its dates. Run in the Supabase SQL editor.
-- No RLS. The app does not create this table. Without it, choices are kept in the running container until it restarts.
-- agreement_id has no foreign key: the sample agreement ("sample:<company id>") is not a row in price_agreements.
-- Removing the choice deletes the row, and the invoice is matched on its dates again.
create table if not exists public.invoice_agreement_choices (
  company_id text not null references public.companies (id),
  file_id text not null references public.invoice_mail_files (id) on delete cascade,
  agreement_id text not null,
  chosen_by text not null,
  chosen_by_name text not null,
  chosen_at timestamptz not null default now(),
  primary key (company_id, file_id)
);
