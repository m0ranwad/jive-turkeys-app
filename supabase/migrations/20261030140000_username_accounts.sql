-- Google and email accounts stay as they are. Only the account service writes
-- username aliases and recovery hashes; players can read their own alias only.
create table public.username_accounts (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  recovery_hash text not null check (recovery_hash ~ '^[a-f0-9]{64}$'),
  -- The last reset with a recovery code (see claim_username_recovery).
  reset_at timestamptz,
  created_date timestamptz not null default now()
);
alter table public.username_accounts enable row level security;
revoke all on public.username_accounts from anon, authenticated;
grant select (user_id, username) on public.username_accounts to authenticated;
grant select, insert, update, delete on public.username_accounts to service_role;
create policy username_accounts_own on public.username_accounts for select to authenticated
  using (user_id = (select auth.uid()));

-- Fixed time windows, counted atomically across account-service instances.
-- Keys contain SHA-256 hashes, never raw IP addresses, passwords, or codes.
create table public.username_auth_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.username_auth_limits enable row level security;
revoke all on public.username_auth_limits from anon, authenticated;
grant select, insert, update, delete on public.username_auth_limits to service_role;

create function public.username_auth_attempt(p_key text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare tries integer;
begin
  -- A key seen for the first time takes over a row whose window is over, so
  -- the table holds about one busy 15 minutes' worth of keys instead of every
  -- username anyone ever tried (and rows never need deleting).
  if not exists (select 1 from public.username_auth_limits where key = p_key) then
    begin
      update public.username_auth_limits set key = p_key, window_start = now(), attempts = 0
      where key = (select l.key from public.username_auth_limits l
                   where l.window_start <= now() - interval '15 minutes'
                   limit 1 for update skip locked);
    exception when unique_violation then
      null; -- Another request took this key at the same moment; count on its row.
    end;
  end if;
  insert into public.username_auth_limits as l (key) values (p_key)
  on conflict (key) do update set
    attempts = case when l.window_start <= now() - interval '15 minutes' then 1 else l.attempts + 1 end,
    window_start = case when l.window_start <= now() - interval '15 minutes' then now() else l.window_start end
  returning attempts into tries;
  return tries <= p_limit;
end;
$$;
revoke all on function public.username_auth_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.username_auth_attempt(text, integer) to service_role;

-- A recovery code can win once, even if two requests arrive together. The
-- account service changes the password after this claim, then returns the new code.
create function public.claim_username_recovery(p_username text, p_hash text, p_new_hash text)
returns uuid language sql security definer set search_path = public as $$
  update public.username_accounts set recovery_hash = p_new_hash, reset_at = now()
  where username = p_username and recovery_hash = p_hash returning user_id;
$$;
revoke all on function public.claim_username_recovery(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_username_recovery(text, text, text) to service_role;

-- Replacing a lost code (My Profile): only if the code is still the one the
-- service read before checking the password, and not within 10 minutes of a
-- reset. Ten minutes is longer than a request can run, so a replacement that
-- was checked against the old password can't land after a reset and hand out
-- a code that undoes it.
create function public.replace_username_recovery(p_user uuid, p_hash text, p_new_hash text)
returns boolean language sql security definer set search_path = public as $$
  with replaced as (
    update public.username_accounts set recovery_hash = p_new_hash
    where user_id = p_user and recovery_hash = p_hash
      and (reset_at is null or reset_at <= now() - interval '10 minutes')
    returning 1
  )
  select exists (select 1 from replaced);
$$;
revoke all on function public.replace_username_recovery(uuid, text, text) from public, anon, authenticated;
grant execute on function public.replace_username_recovery(uuid, text, text) to service_role;

-- Email-free accounts sign in with an internal address (see the account
-- service). Keep it out of public.users, where captains can read emails, so
-- nobody can use it to sign in around the service's limits. Otherwise the same
-- as before (20261014000809_team_join_code.sql).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first boolean := not exists (select 1 from public.users);
begin
  insert into public.users (id, email, full_name, role, joined_team_at)
  values (
    new.id,
    case when lower(new.email) like '%@players.jiveturkeys.invalid' then null else new.email end,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when first then 'admin' else 'user' end,
    case when first then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- One place decides whether a code is the team's and what joining does:
-- join_team() for someone signed in on the site, join_team_as() for the
-- account service, which makes the account and joins it in one go.
create function public.team_code_matches(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_join_code c where lower(btrim(c.code)) = lower(btrim(p_code)));
$$;
revoke all on function public.team_code_matches(text) from public, anon, authenticated;
grant execute on function public.team_code_matches(text) to service_role;

-- join_team() as it was (20261014180000_remove_team_member.sql), for any account.
create function public.join_team_as(p_user uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.users;
  tries integer;
begin
  if p_user is null then
    raise exception 'Not signed in';
  end if;
  select * into u from public.users where id = p_user for update;
  if u.id is null then
    raise exception 'Not signed in';
  end if;
  if u.removed_at is not null then
    return 'removed';
  end if;
  if u.joined_team_at is not null then
    return 'joined';
  end if;
  if u.join_blocked_until > now() then
    return 'blocked';
  end if;
  if public.team_code_matches(p_code) then
    update public.users set joined_team_at = now(), join_tries = 0, join_blocked_until = null where id = p_user;
    return 'joined';
  end if;
  -- After a block runs out, the count starts over.
  tries := case when u.join_blocked_until is not null then 0 else u.join_tries end + 1;
  if tries >= 10 then
    update public.users set join_tries = 0, join_blocked_until = now() + interval '1 hour' where id = p_user;
    return 'blocked';
  end if;
  update public.users set join_tries = tries, join_blocked_until = null where id = p_user;
  return 'wrong';
end;
$$;
revoke all on function public.join_team_as(uuid, text) from public, anon, authenticated;
grant execute on function public.join_team_as(uuid, text) to service_role;

create or replace function public.join_team(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.join_team_as((select auth.uid()), p_code);
end;
$$;
