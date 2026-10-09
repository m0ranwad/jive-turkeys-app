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
