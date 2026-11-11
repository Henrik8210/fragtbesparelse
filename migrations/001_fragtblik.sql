create table companies (
  id text primary key,
  name text not null,
  industry text not null,
  place text not null
);

create table users (
  id text primary key,
  username text not null unique,
  name text not null,
  role text not null,
  company_id text references companies (id),
  password_hash text not null,
  lang text not null default 'da',
  sample integer not null default 0,
  seat text,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table bills (
  id text primary key,
  company_id text not null references companies (id),
  label text not null,
  amount integer not null,
  source text not null,
  carrier text,
  created_at timestamptz not null default now(),
  created_by text references users (id)
);

create table reviews (
  company_id text not null references companies (id),
  line_key text not null,
  state text not null,
  primary key (company_id, line_key)
);

create table reports (
  id text primary key,
  company_id text not null references companies (id),
  name text not null,
  summary text not null,
  created_by text references users (id),
  created_at timestamptz not null default now()
);

create table tender_packs (
  id text primary key,
  company_id text not null references companies (id),
  title text not null,
  service text not null default '',
  exclusions text not null default '',
  expectations text not null default '',
  created_by text references users (id),
  updated_at timestamptz not null default now()
);

create table tender_lines (
  id text primary key,
  pack_id text not null references tender_packs (id) on delete cascade,
  origin text not null,
  destination text not null,
  service text not null,
  carrier text not null,
  shipments integer not null,
  added integer not null default 0,
  excluded integer not null default 0
);

create table tender_comments (
  id text primary key,
  pack_id text not null references tender_packs (id) on delete cascade,
  user_id text not null references users (id),
  body text not null,
  created_at timestamptz not null default now()
);
