-- Announcements: a badge for posts you haven't seen, and captains can fix or
-- take down a post (issue #37).
--
-- Each player's read marker is one row here: posts after it are new to them.
-- With no marker yet, posts from after they joined the team count (account
-- creation for a captain who never entered the team code), so a new player
-- doesn't start with a pile of old news. Players move only their own marker,
-- and only as members.
--
-- Captains already update and delete announcements (announcements_write).
-- Changing a post's title or text sets edited_date ("Edited" on the post),
-- here, not by the site. It never notifies anyone and doesn't make the post
-- new again: created_date stays.

create table public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create trigger announcement_reads_touch before update on public.announcement_reads
  for each row execute function public.touch_updated_date();

alter table public.announcement_reads enable row level security;

create policy announcement_reads_own on public.announcement_reads for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_team_member()))
  with check (user_id = (select auth.uid()) and (select public.is_team_member()));

grant select, insert, update, delete on public.announcement_reads to authenticated, service_role;

-- How many announcements the signed-in player hasn't seen. Runs as the player,
-- so the policies apply: anyone not on the team counts none.
create or replace function public.announcements_unread()
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.users u
  left join public.announcement_reads r on r.user_id = u.id
  join public.announcements a on a.created_date > coalesce(r.last_read_at, u.joined_team_at, u.created_date)
  where u.id = (select auth.uid());
$$;

-- Marks announcements read up to p_read_at: the newest post the player has on
-- screen, so one posted while the page loaded still counts. Never moves the
-- marker back, or past now.
create or replace function public.announcements_mark_read(p_read_at timestamptz)
returns void
language sql
set search_path = public
as $$
  insert into public.announcement_reads (user_id, last_read_at)
  values ((select auth.uid()), least(p_read_at, now()))
  on conflict (user_id) do update
    set last_read_at = greatest(public.announcement_reads.last_read_at, excluded.last_read_at);
$$;

revoke execute on function public.announcements_unread() from public, anon;
revoke execute on function public.announcements_mark_read(timestamptz) from public, anon;
grant execute on function public.announcements_unread() to authenticated, service_role;
grant execute on function public.announcements_mark_read(timestamptz) to authenticated, service_role;

alter table public.announcements add column edited_date timestamptz;

create or replace function public.announcement_edited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.edited_date := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.announcement_edited() from public, anon, authenticated;

create trigger announcements_edited before update of title, body on public.announcements
  for each row execute function public.announcement_edited();
