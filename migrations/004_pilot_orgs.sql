create table if not exists pilot_orgs (
  id text primary key,
  name text not null,
  carrier text not null,
  invoice text not null,
  rates text not null,
  created_at timestamptz not null default now()
);
