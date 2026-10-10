-- Dues: the session fee as the league bills it (a league fee plus a ref fee
-- for every game), how players pay, and each player's own share.

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

-- ---------------------------------------------------------------------------
-- A player's own dues: one row per session the captains have set a fee for,
-- newest first, with how it splits and the signed-in player's share and
-- payment. Only captains can read dues_payments, so this runs with the
-- owner's rights and returns nothing about anyone else's amount or payment.
-- Splits the same way as splitDues() in src/lib/dues.js.
-- ---------------------------------------------------------------------------

create or replace function public.my_dues()
returns table (
  season_year integer,
  session integer,
  total_fee numeric,
  league_fee numeric,
  ref_fee numeric,
  game_count integer,
  active_players integer,
  per_player numeric,
  is_active boolean,
  custom boolean,
  amount numeric,
  paid boolean,
  paid_date date
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select (select auth.uid()) as id
  ),
  split as (
    select d.id, d.season_year, d.session, d.total_fee, d.league_fee, d.ref_fee, d.game_count,
      count(a.user_id)::integer as active_players,
      count(a.user_id) filter (where p.override_amount is null)::integer as auto_players,
      coalesce(sum(p.override_amount), 0) as custom_sum
    from public.session_dues d
    left join public.player_profiles a on a.status = 'active'
    left join public.dues_payments p
      on p.season_year = d.season_year and p.session = d.session and p.user_id = a.user_id
    group by d.id
  ),
  shares as (
    select s.*,
      case when s.auto_players > 0
        then ceil(greatest(0, s.total_fee - s.custom_sum) / s.auto_players)
        else 0
      end as per_player
    from split s
  )
  select s.season_year, s.session, s.total_fee, s.league_fee, s.ref_fee, s.game_count,
    s.active_players,
    s.per_player,
    a.user_id is not null,
    a.user_id is not null and mine.override_amount is not null,
    case when a.user_id is not null then coalesce(mine.override_amount, s.per_player) end,
    coalesce(mine.paid, false),
    mine.paid_date
  from shares s
  cross join me
  left join public.player_profiles a on a.user_id = me.id and a.status = 'active'
  left join public.dues_payments mine
    on mine.season_year = s.season_year and mine.session = s.session and mine.user_id = me.id
  where me.id is not null
  order by s.season_year desc, s.session desc;
$$;

revoke execute on function public.my_dues() from public, anon;
grant execute on function public.my_dues() to authenticated, service_role;
