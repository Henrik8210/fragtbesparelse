-- Price agreements on Prisaftaler, per company. Run in the Supabase SQL editor. No RLS. The app does not create this table.
-- Without it, agreements are kept in the running container until it restarts, and the browser keeps its localStorage copy.
-- rows holds the current content and original the content as first read (AI extract or CSV); format_version names their shape.
-- Format 1 is a bare array of parcel rate rows. Format 2 is {rates, items, grids, surcharges, conditions}; the app reads both.
-- extract is the AI result; extract_sha256 links to invoice_extracts, where it is cached as content_sha256 'agreement:<sha>'.
create table if not exists public.price_agreements (
  id text primary key,
  company_id text not null references public.companies (id) on delete cascade,
  name text not null,
  carrier text not null default '',
  valid_from date,
  valid_to date,
  ended_at timestamptz,
  format_version integer not null default 1,
  rows jsonb not null,
  original jsonb not null,
  changed boolean not null default false,
  source text not null default 'csv' check (source in ('csv', 'pdf', 'browser')),
  source_filename text not null default '',
  extract_sha256 text,
  extract jsonb,
  created_by text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_by_name text not null,
  updated_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb
);
create index if not exists price_agreements_company_idx on public.price_agreements (company_id, valid_from desc);
