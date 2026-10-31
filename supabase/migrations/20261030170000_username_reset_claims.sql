-- One reset owns a code while Supabase Auth checks and changes the password.
-- Nullable coordination fields preserve every existing username and code.
alter table public.username_accounts
  add column reset_claim_id uuid,
  add column reset_claimed_at timestamptz,
  add constraint username_reset_claim_pair check ((reset_claim_id is null) = (reset_claimed_at is null));

-- Whether a claim made at this time still holds its code. A claim lasts two
-- minutes, so a stopped worker can't hold a code for long. The one place that
-- says how long; previews and tests use RESET_CLAIM_TIMEOUT_MS, which a unit
-- test keeps equal to it.
create function public.username_reset_claim_live(p_claimed_at timestamptz)
returns boolean language sql volatile set search_path = public as $$
  select p_claimed_at is not null and p_claimed_at > clock_timestamp() - interval '2 minutes';
$$;
revoke all on function public.username_reset_claim_live(timestamptz) from public, anon, authenticated;
grant execute on function public.username_reset_claim_live(timestamptz) to service_role;

-- Only the account service calls these functions. A timed-out request is
-- fenced at the Auth transaction's commit, so it cannot later overwrite a
-- password after a captain has issued a replacement code.

-- {"status": "claimed", "user_id": ...} when this reset now owns the code;
-- "busy" when the code is right but another reset holds it; "wrong" otherwise.
create function public.username_reset_claim(p_username text, p_hash text, p_claim uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare account public.username_accounts;
begin
  if p_claim is null then return jsonb_build_object('status', 'wrong'); end if;
  select * into account from public.username_accounts
  where username = p_username and reset_hash = p_hash and reset_expires_at > clock_timestamp()
  for update;
  if not found then return jsonb_build_object('status', 'wrong'); end if;
  if public.username_reset_claim_live(account.reset_claimed_at) then
    return jsonb_build_object('status', 'busy');
  end if;
  update public.username_accounts set reset_claim_id = p_claim, reset_claimed_at = clock_timestamp()
  where user_id = account.user_id;
  return jsonb_build_object('status', 'claimed', 'user_id', account.user_id);
end;
$$;
revoke all on function public.username_reset_claim(text, text, uuid) from public, anon, authenticated;
grant execute on function public.username_reset_claim(text, text, uuid) to service_role;

-- After Auth turned a reset down or its reply was lost: frees this reset's
-- claim so the code can be tried again, and says what became of the code:
-- 'released' (still usable), 'used', 'replaced' (a newer code, or it ran out)
-- or 'busy' (another reset holds it now).
create function public.username_reset_release(p_user uuid, p_claim uuid, p_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare account public.username_accounts;
begin
  select * into account from public.username_accounts where user_id = p_user for update;
  if not found then return 'replaced'; end if;
  if account.reset_claim_id = p_claim then
    update public.username_accounts set reset_claim_id = null, reset_claimed_at = null where user_id = p_user;
    account.reset_claimed_at := null;
  end if;
  if account.reset_hash is null then return 'used'; end if;
  if account.reset_hash <> p_hash or account.reset_expires_at <= clock_timestamp() then return 'replaced'; end if;
  if public.username_reset_claim_live(account.reset_claimed_at) then return 'busy'; end if;
  return 'released';
end;
$$;
revoke all on function public.username_reset_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.username_reset_release(uuid, uuid, text) to service_role;

-- After Auth changed the password. Auth's own transaction normally used up the
-- code already (the trigger below). If Auth ever saves the claim marker in a
-- separate transaction, this uses up the code instead and removes the marker.
create function public.username_reset_finish(p_user uuid, p_claim uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.username_accounts set reset_hash = null, reset_expires_at = null,
    reset_claim_id = null, reset_claimed_at = null
  where user_id = p_user and reset_claim_id = p_claim;
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'jt_username_reset_claim'
  where id = p_user and raw_app_meta_data ? 'jt_username_reset_claim';
end;
$$;
revoke all on function public.username_reset_finish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.username_reset_finish(uuid, uuid) to service_role;

-- {"status": "issued", "username": ...}, or "forbidden" (not a captain),
-- "missing" (no username) or "busy" (a reset holds the current code).
create function public.username_reset_issue(p_user uuid, p_captain uuid, p_hash text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare account public.username_accounts;
begin
  if not exists (select 1 from public.users where id = p_captain and role = 'admin' and removed_at is null) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into account from public.username_accounts where user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if public.username_reset_claim_live(account.reset_claimed_at) then
    return jsonb_build_object('status', 'busy');
  end if;
  update public.username_accounts set reset_hash = p_hash, reset_expires_at = p_expires_at, reset_by = p_captain,
    reset_claim_id = null, reset_claimed_at = null
  where user_id = p_user;
  return jsonb_build_object('status', 'issued', 'username', account.username);
end;
$$;
revoke all on function public.username_reset_issue(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.username_reset_issue(uuid, uuid, text, timestamptz) to service_role;

-- Supabase Auth updates the password and app_metadata in one transaction, but
-- may write them in separate statements, password first. Check at commit so
-- the final metadata is visible. Consuming the code and changing the password
-- then either both commit or both roll back.
-- A password change without the marker is the account's own (an email reset
-- link, a Google account adding a password) and always goes ahead, so resets
-- keep working if Auth ever saves the marker separately; the service then
-- finishes the reset with username_reset_finish().
create function public.username_reset_password_commit()
returns trigger language plpgsql security definer set search_path = public as $$
declare claim text;
begin
  select raw_app_meta_data ->> 'jt_username_reset_claim' into claim from auth.users where id = new.id;
  if claim is null then return null; end if;

  update public.username_accounts set reset_hash = null, reset_expires_at = null,
    reset_claim_id = null, reset_claimed_at = null
  where user_id = new.id and reset_claim_id::text = claim
    and public.username_reset_claim_live(reset_claimed_at) and reset_expires_at > clock_timestamp();
  if not found then
    raise exception 'This password reset is no longer current.';
  end if;
  -- The coordination token is private and transient, not a sign-in option.
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'jt_username_reset_claim'
  where id = new.id;
  return null;
end;
$$;
revoke all on function public.username_reset_password_commit() from public, anon, authenticated;
create constraint trigger username_reset_password_commit
  after update of encrypted_password on auth.users
  deferrable initially deferred
  for each row execute function public.username_reset_password_commit();
