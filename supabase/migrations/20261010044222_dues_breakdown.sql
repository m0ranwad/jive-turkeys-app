-- Dues: the session fee as the league bills it (a league fee plus a ref fee
-- for every game), how players pay, couples who pay together, and the whole
-- team able to see the dues and mark anyone paid. Captains still set fees,
-- custom amounts and payment details.

-- total_fee stays the amount that's split; these record how it was worked out.
alter table public.session_dues
  add column league_fee numeric(10, 2),
  add column ref_fee numeric(10, 2),
  add column game_count integer check (game_count >= 0);

-- Shown to players on the Dues page. Payment apps only, never bank details.
alter table public.team_settings
  add column pay_venmo text,
  add column pay_cashapp text,
  add column pay_zelle text,
  add column pay_note text;

-- Who marked a payment paid, so the team can see it.
alter table public.dues_payments
  add column paid_by uuid references public.users (id) on delete set null;

-- Couples who send one payment for both. Always set on both players together
-- (by set_dues_partner below).
alter table public.player_profiles
  add column pays_with uuid references public.users (id) on delete set null;

-- The whole team can see the fee and who has paid (captains could already).
create policy session_dues_select on public.session_dues for select to authenticated using (true);
create policy dues_payments_select on public.dues_payments for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Any player can mark players paid or unpaid: themselves, their partner, or
-- anyone else. Only the paid fields change; custom amounts stay captains-only.
-- ---------------------------------------------------------------------------

create or replace function public.mark_dues_paid(
  p_season_year integer,
  p_session integer,
  p_user_ids uuid[],
  p_paid boolean,
  p_paid_date date
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.dues_payments (season_year, session, user_id, paid, paid_date, paid_by)
  select p_season_year, p_session, u.id, p_paid,
    case when p_paid then coalesce(p_paid_date, current_date) end,
    case when p_paid then (select auth.uid()) end
  from public.users u
  where u.id = any (p_user_ids) and (select auth.uid()) is not null
  on conflict (season_year, session, user_id) do update
    set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by;
$$;

-- ---------------------------------------------------------------------------
-- Links two players who pay together, or unlinks a player (p_partner_id null).
-- Anyone can do it. A player is only ever linked to one other player.
-- ---------------------------------------------------------------------------

create or replace function public.set_dues_partner(p_user_id uuid, p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in';
  end if;
  update public.player_profiles set pays_with = null
    where user_id in (p_user_id, p_partner_id) or pays_with in (p_user_id, p_partner_id);
  if p_partner_id is not null and p_partner_id <> p_user_id then
    update public.player_profiles set pays_with = p_partner_id where user_id = p_user_id;
    update public.player_profiles set pays_with = p_user_id where user_id = p_partner_id;
  end if;
end;
$$;

revoke execute on function public.mark_dues_paid(integer, integer, uuid[], boolean, date) from public, anon;
revoke execute on function public.set_dues_partner(uuid, uuid) from public, anon;
grant execute on function public.mark_dues_paid(integer, integer, uuid[], boolean, date) to authenticated, service_role;
grant execute on function public.set_dues_partner(uuid, uuid) to authenticated, service_role;
