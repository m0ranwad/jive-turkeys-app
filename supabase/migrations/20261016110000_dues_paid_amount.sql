-- Dues: keep what each player paid when they're marked paid. Until now the
-- site kept only *that* someone paid, and worked out how much from the
-- session's fee every time, so a fee change (or a player joining or sitting
-- out) after people had paid changed what they had "paid" and the totals
-- counted money nobody sent.
--
-- Payments marked before this have no amount (null): they show the current
-- share, as before.

alter table public.dues_payments add column paid_amount numeric(10, 2) check (paid_amount >= 0);
alter table public.dues_history add column paid_amount numeric(10, 2) check (paid_amount >= 0);

-- ---------------------------------------------------------------------------
-- Same as before (20261014000809_team_join_code.sql), plus each player's
-- amount (p_amounts, in the same order as p_user_ids; the site works out the
-- split). A player already marked paid whose share has gone up since is
-- marked paid again for the new amount: that's the difference being paid,
-- and it goes in the history like any other payment. Marking someone not paid
-- clears their amount.
-- ---------------------------------------------------------------------------

create or replace function public.mark_dues_paid(
  p_season_year integer,
  p_session integer,
  p_user_ids uuid[],
  p_paid boolean,
  p_paid_date date,
  p_amounts numeric[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_team_member() then
    raise exception 'Join the team first';
  end if;
  if p_amounts is not null and cardinality(p_amounts) <> cardinality(p_user_ids) then
    raise exception 'Each player needs an amount';
  end if;
  if exists (select 1 from unnest(p_amounts) a where a < 0) then
    raise exception 'An amount can''t be less than $0';
  end if;

  -- App players.
  with wanted as (
    select distinct on (w.id) w.id, w.amount
    from unnest(p_user_ids, p_amounts) as w (id, amount)
    where w.id is not null
  ),
  changing as (
    select u.id, w.amount
    from wanted w
    join public.users u on u.id = w.id
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.user_id = u.id
    where coalesce(d.paid, false) <> p_paid
      or (p_paid and d.paid and d.paid_amount < w.amount)
  ),
  saved as (
    insert into public.dues_payments (season_year, session, user_id, paid, paid_date, paid_by, paid_amount)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end,
      case when p_paid then c.amount end
    from changing c
    on conflict (season_year, session, user_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by,
        paid_amount = excluded.paid_amount
    returning user_id, paid, paid_date, paid_amount
  )
  insert into public.dues_history (season_year, session, user_id, paid, paid_date, paid_amount, changed_by)
  select p_season_year, p_session, s.user_id, s.paid, s.paid_date, s.paid_amount, me
  from saved s;

  -- Teammates who aren't on the app.
  with wanted as (
    select distinct on (w.id) w.id, w.amount
    from unnest(p_user_ids, p_amounts) as w (id, amount)
    where w.id is not null
  ),
  changing as (
    select g.id, w.amount
    from wanted w
    join public.team_guests g on g.id = w.id
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.guest_id = g.id
    where coalesce(d.paid, false) <> p_paid
      or (p_paid and d.paid and d.paid_amount < w.amount)
  ),
  saved as (
    insert into public.dues_payments (season_year, session, guest_id, paid, paid_date, paid_by, paid_amount)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end,
      case when p_paid then c.amount end
    from changing c
    on conflict (season_year, session, guest_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by,
        paid_amount = excluded.paid_amount
    returning guest_id, paid, paid_date, paid_amount
  )
  insert into public.dues_history (season_year, session, guest_id, paid, paid_date, paid_amount, changed_by)
  select p_season_year, p_session, s.guest_id, s.paid, s.paid_date, s.paid_amount, me
  from saved s;
end;
$$;

-- Signed-in players only, like the version without amounts (20261010044222_dues_breakdown.sql).
revoke execute on function public.mark_dues_paid(integer, integer, uuid[], boolean, date, numeric[]) from public, anon;
grant execute on function public.mark_dues_paid(integer, integer, uuid[], boolean, date, numeric[]) to authenticated, service_role;

-- The version without amounts stays for a site that hasn't reloaded since this
-- went live. It records no amount (the current share counts, as before), and
-- marking someone not paid clears the amount the new version recorded.
create or replace function public.mark_dues_paid(
  p_season_year integer,
  p_session integer,
  p_user_ids uuid[],
  p_paid boolean,
  p_paid_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dues_paid(p_season_year, p_session, p_user_ids, p_paid, p_paid_date, null::numeric[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- Same as before (20261014031844_guests_in_games.sql), plus: what a roster
-- name paid moves with the payment.
-- ---------------------------------------------------------------------------

create or replace function public.move_team_guest(p_guest_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.team_guests;
  partner uuid;
begin
  select * into g from public.team_guests where id = p_guest_id;
  if g.id is null or g.linked_user_id is not null then
    raise exception 'That name has already been picked';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such player on the app';
  end if;
  if exists (select 1 from public.team_guests where linked_user_id = p_user_id) then
    raise exception 'That player already has a name on the roster';
  end if;

  -- Sessions the app player has nothing for yet move over as they are.
  update public.dues_payments d set user_id = p_user_id, guest_id = null
  where d.guest_id = p_guest_id
    and not exists (
      select 1 from public.dues_payments u
      where u.user_id = p_user_id and u.season_year = d.season_year and u.session = d.session
    );
  -- Where both have one, a payment the guest made counts (with what they
  -- paid), and so does a custom amount the app player doesn't have.
  update public.dues_payments u set
      paid = u.paid or d.paid,
      paid_date = case when u.paid then u.paid_date else d.paid_date end,
      paid_by = case when u.paid then u.paid_by else d.paid_by end,
      paid_amount = case when u.paid then u.paid_amount else d.paid_amount end,
      override_amount = coalesce(u.override_amount, d.override_amount)
    from public.dues_payments d
    where d.guest_id = p_guest_id and u.user_id = p_user_id
      and u.season_year = d.season_year and u.session = d.session
      and ((d.paid and not u.paid) or (u.override_amount is null and d.override_amount is not null));
  update public.dues_history set user_id = p_user_id, guest_id = null where guest_id = p_guest_id;

  -- Sessions the roster name was on and the app player wasn't. Where both
  -- were, the app player's own entry counts (the roster name's is kept).
  update public.session_roster r set user_id = p_user_id, guest_id = null
  where r.guest_id = p_guest_id
    and not exists (
      select 1 from public.session_roster u
      where u.user_id = p_user_id and u.season_year = r.season_year and u.session = r.session
    );

  -- Game sign-ups and stat lines. Where both have one for a game, the app
  -- player's own counts (the roster name's is kept).
  update public.rsvps r set user_id = p_user_id, guest_id = null
  where r.guest_id = p_guest_id
    and not exists (select 1 from public.rsvps u where u.user_id = p_user_id and u.game_id = r.game_id);
  update public.game_stats s set user_id = p_user_id, guest_id = null
  where s.guest_id = p_guest_id
    and not exists (select 1 from public.game_stats u where u.user_id = p_user_id and u.game_id = s.game_id);
  -- Player of the Match votes for the roster name (except any the player cast
  -- for that name themselves, which would be a vote for themselves).
  update public.potm_votes v set voted_for_id = p_user_id, voted_for_guest_id = null
  where v.voted_for_guest_id = p_guest_id and v.voter_id <> p_user_id;

  -- Details the player hasn't filled in come from the roster.
  update public.player_profiles
    set gender = coalesce(gender, g.gender), position = coalesce(position, g.position)
    where user_id = p_user_id;

  partner := coalesce(g.pays_with_user, g.pays_with_guest);
  update public.team_guests
    set linked_user_id = p_user_id, pays_with_user = null, pays_with_guest = null
    where id = p_guest_id;
  if partner is not null then
    perform public.set_dues_partner(p_user_id, partner);
  end if;
end;
$$;
