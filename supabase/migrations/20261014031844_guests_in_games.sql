-- Players who haven't joined the site yet (roster names, team_guests) in game
-- sign-ups, headcounts, results and Player of the Match. Most of the roster
-- hasn't joined, so headcounts read "short" and their goals couldn't be
-- recorded. Captains now set a roster name's RSVP and enter their stat line;
-- teammates can vote for them (they can't vote, having no account). When they
-- join and pick their name, all of it moves to their account, as dues do.

-- A sign-up, stat line or vote belongs to an app player or a roster name
-- (exactly one), like dues_payments in 20261010141838_team_guests.sql.
alter table public.rsvps alter column user_id drop not null;
alter table public.rsvps add column guest_id uuid references public.team_guests (id);
alter table public.rsvps add constraint rsvps_one_player check (num_nonnulls(user_id, guest_id) = 1);
create unique index rsvps_game_guest on public.rsvps (game_id, guest_id);

alter table public.game_stats alter column user_id drop not null;
alter table public.game_stats add column guest_id uuid references public.team_guests (id);
alter table public.game_stats add constraint game_stats_one_player check (num_nonnulls(user_id, guest_id) = 1);
create unique index game_stats_game_guest on public.game_stats (game_id, guest_id);

alter table public.potm_votes alter column voted_for_id drop not null;
alter table public.potm_votes add column voted_for_guest_id uuid references public.team_guests (id);
alter table public.potm_votes add constraint potm_votes_one_player check (num_nonnulls(voted_for_id, voted_for_guest_id) = 1);

-- Sign-ups and stat lines for roster names: captains only, through the rules
-- already there (players write only rows with their own user_id). Votes: a vote
-- for a roster name has no voted_for_id, so "not for yourself" allows it.
alter policy potm_insert on public.potm_votes
  with check (
    voter_id = (select auth.uid()) and voted_for_id is distinct from voter_id and (select public.is_team_member())
  );
alter policy potm_update on public.potm_votes
  using (voter_id = (select auth.uid()) and (select public.is_team_member()))
  with check (
    voter_id = (select auth.uid()) and voted_for_id is distinct from voter_id and (select public.is_team_member())
  );

-- ---------------------------------------------------------------------------
-- Same as before (20261013225036_session_roster.sql), plus: a roster name's
-- sign-ups, stat lines and votes move to the app player who picks it.
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
  -- Where both have one, a payment the guest made counts, and so does a
  -- custom amount the app player doesn't have.
  update public.dues_payments u set
      paid = u.paid or d.paid,
      paid_date = case when u.paid then u.paid_date else d.paid_date end,
      paid_by = case when u.paid then u.paid_by else d.paid_by end,
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
