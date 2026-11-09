-- Just enough of Supabase for the migrations to run on a plain Postgres (15+),
-- so database tests can run in CI and on a laptop. Safe to run more than once.
--
-- If a new migration uses another piece of Supabase (the storage schema, an
-- extension, ...), add a minimal stand-in here.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Same lookup as Supabase: the signed-in user's id from the request's JWT.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

-- pg_net (Supabase's background HTTP requests) isn't on plain Postgres: record
-- the requests instead, so tests can check what would have been sent.
create schema if not exists net;
create table if not exists net.test_requests (
  id bigserial primary key,
  url text,
  body jsonb,
  created_date timestamptz not null default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language sql
as $$
  insert into net.test_requests (url, body) values (url, body) returning id;
$$;

-- Minimal Storage stand-in so migrations that create buckets and object
-- policies can run on plain Postgres. Live Supabase already has the real schema.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  owner_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  metadata jsonb
);

-- Live Supabase already has RLS on; enable it on the stub so policies apply in tests.
alter table storage.objects enable row level security;

-- First path segments without the file name, matching Supabase's helper.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when name is null or position('/' in name) = 0 then array[]::text[]
    else string_to_array(left(name, length(name) - length(substring(name from '[^/]+$')) - 1), '/')
  end;
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
