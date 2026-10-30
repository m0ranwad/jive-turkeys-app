-- Google and email accounts stay as they are. Only the account service writes
-- username aliases and recovery hashes; players can read their own alias only.
create table public.username_accounts (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  recovery_hash text not null check (recovery_hash ~ '^[a-f0-9]{64}$'),
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
  update public.username_accounts set recovery_hash = p_new_hash
  where username = p_username and recovery_hash = p_hash returning user_id;
$$;
revoke all on function public.claim_username_recovery(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_username_recovery(text, text, text) to service_role;
