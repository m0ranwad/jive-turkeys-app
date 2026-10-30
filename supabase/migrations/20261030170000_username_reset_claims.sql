-- One reset owns a code while Supabase Auth checks and changes the password.
-- Nullable coordination fields preserve every existing username and code.
alter table public.username_accounts
  add column reset_claim_id uuid,
  add column reset_claimed_at timestamptz,
  add constraint username_reset_claim_pair check ((reset_claim_id is null) = (reset_claimed_at is null));

-- Only the account service calls these functions. A claim lasts two minutes;
-- a timed-out request is fenced at the Auth transaction's commit, so it cannot
-- later overwrite a password after a captain has issued a replacement code.
create function public.username_reset_claim(p_username text, p_hash text, p_claim uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  if p_claim is null then return null; end if;
  update public.username_accounts set reset_claim_id = p_claim, reset_claimed_at = clock_timestamp()
  where username = p_username and reset_hash = p_hash and reset_expires_at > clock_timestamp()
    and (reset_claim_id is null or reset_claimed_at <= clock_timestamp() - interval '2 minutes')
  returning user_id into claimed;
  return claimed;
end;
$$;
revoke all on function public.username_reset_claim(text, text, uuid) from public, anon, authenticated;
grant execute on function public.username_reset_claim(text, text, uuid) to service_role;

create function public.username_reset_release(p_user uuid, p_claim uuid)
returns void language sql security definer set search_path = public as $$
  update public.username_accounts set reset_claim_id = null, reset_claimed_at = null
  where user_id = p_user and reset_claim_id = p_claim;
$$;
revoke all on function public.username_reset_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.username_reset_release(uuid, uuid) to service_role;

create function public.username_reset_issue(p_user uuid, p_captain uuid, p_hash text, p_expires_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare account public.username_accounts;
begin
  if not exists (select 1 from public.users where id = p_captain and role = 'admin' and removed_at is null) then
    return 'forbidden';
  end if;
  select * into account from public.username_accounts where user_id = p_user for update;
  if not found then return 'missing'; end if;
  if account.reset_claim_id is not null and account.reset_claimed_at > clock_timestamp() - interval '2 minutes' then
    return 'busy';
  end if;
  update public.username_accounts set reset_hash = p_hash, reset_expires_at = p_expires_at, reset_by = p_captain,
    reset_claim_id = null, reset_claimed_at = null
  where user_id = p_user;
  return 'issued';
end;
$$;
revoke all on function public.username_reset_issue(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.username_reset_issue(uuid, uuid, text, timestamptz) to service_role;

-- Supabase Auth updates the password and app_metadata in one transaction, but
-- may write them in separate statements, password first. Check at commit so
-- the final metadata is visible. Consuming the code and changing the password
-- then either both commit or both roll back; there is no later cleanup gap.
create function public.username_reset_password_commit()
returns trigger language plpgsql security definer set search_path = public as $$
declare metadata jsonb; claim text;
begin
  select raw_app_meta_data into metadata from auth.users where id = new.id;
  claim := metadata ->> 'jt_username_reset_claim';
  if claim is null then
    -- Ordinary email/Google password changes remain ordinary, except that
    -- they must not bypass another password reset already in progress.
    if exists (select 1 from public.username_accounts where user_id = new.id
      and reset_claim_id is not null and reset_claimed_at > clock_timestamp() - interval '2 minutes') then
      raise exception 'A reset is finishing. Try again in a moment.';
    end if;
    return null;
  end if;

  update public.username_accounts set reset_hash = null, reset_expires_at = null,
    reset_claim_id = null, reset_claimed_at = null
  where user_id = new.id and reset_claim_id::text = claim
    and reset_claimed_at > clock_timestamp() - interval '2 minutes' and reset_expires_at > clock_timestamp();
  if not found then
    raise exception 'This password reset is no longer current.';
  end if;
  -- The coordination token is private and transient, not a sign-in option.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'jt_username_reset_claim'
  where id = new.id;
  return null;
end;
$$;
revoke all on function public.username_reset_password_commit() from public, anon, authenticated;
create constraint trigger username_reset_password_commit
  after update of encrypted_password on auth.users
  deferrable initially deferred
  for each row execute function public.username_reset_password_commit();
