-- Dues: PayPal as a way to pay, and a history of every paid / not paid
-- change, so a mistaken tap never loses who paid and when.

-- A PayPal.Me name, or any PayPal link (like the one in a PayPal QR code).
alter table public.team_settings add column pay_paypal text;

-- ---------------------------------------------------------------------------
-- Every time a player is marked paid or not paid: when, by whom, and the paid
-- date it recorded. Written only by mark_dues_paid() below, so nobody can edit
-- or remove the history, captains included. The whole team can read it.
-- ---------------------------------------------------------------------------

create table public.dues_history (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  session integer not null,
  user_id uuid not null references public.users (id) on delete cascade,
  paid boolean not null,
  paid_date date,
  changed_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now()
);

create index dues_history_session_idx on public.dues_history (season_year, session, created_date);

alter table public.dues_history enable row level security;
create policy dues_history_select on public.dues_history for select to authenticated using (true);
grant select, insert, update, delete on public.dues_history to authenticated, service_role;

-- Payments already marked paid start the history, so unmarking one later
-- still shows when it was paid and who marked it.
insert into public.dues_history (season_year, session, user_id, paid, paid_date, changed_by, created_date)
select season_year, session, user_id, true, paid_date, paid_by,
  -- Midday UTC, so the paid date doesn't show as the evening before in US time.
  coalesce((paid_date + time '12:00') at time zone 'UTC', updated_date)
from public.dues_payments
where paid;

-- ---------------------------------------------------------------------------
-- Same as before, plus: only players whose status actually changes are
-- touched (marking a paid player paid again keeps the original date), and
-- each change is added to the history.
-- ---------------------------------------------------------------------------

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
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  with changing as (
    select u.id
    from public.users u
    left join public.dues_payments d
      on d.season_year = p_season_year and d.session = p_session and d.user_id = u.id
    where u.id = any (p_user_ids) and coalesce(d.paid, false) <> p_paid
  ),
  saved as (
    insert into public.dues_payments (season_year, session, user_id, paid, paid_date, paid_by)
    select p_season_year, p_session, c.id, p_paid,
      case when p_paid then coalesce(p_paid_date, current_date) end,
      case when p_paid then me end
    from changing c
    on conflict (season_year, session, user_id) do update
      set paid = excluded.paid, paid_date = excluded.paid_date, paid_by = excluded.paid_by
    returning user_id, paid, paid_date
  )
  insert into public.dues_history (season_year, session, user_id, paid, paid_date, changed_by)
  select p_season_year, p_session, s.user_id, s.paid, s.paid_date, me
  from saved s;
end;
$$;
