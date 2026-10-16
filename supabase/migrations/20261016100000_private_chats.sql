-- Private chats and the Captains' Lounge (idea #8).
--
-- Until now every thread was open to the whole team. Now each room is one of:
--   team      Team Chat's side threads, as before: everyone on the team.
--   private   a private chat: only the teammates in it (chat_thread_members).
--             Captains can't read the private chats they aren't in.
--   captains  the Captains' Lounge, built in: only captains.
-- Team Chat itself (messages with no thread) stays open to the whole team.
--
-- Messages and reactions follow their room: whoever can't see a room can't
-- read, post, react or search in it, isn't notified about it, and can't be
-- @mentioned in it.

alter table public.chat_threads
  add column visibility text not null default 'team' check (visibility in ('team', 'private', 'captains'));

-- There's one Captains' Lounge.
create unique index chat_threads_one_lounge on public.chat_threads ((true)) where visibility = 'captains';

-- A room's kind is set when it starts: a private chat can never be opened up
-- to the team, nor a thread closed off. Players change only the name and
-- closed / open.
revoke update on public.chat_threads from authenticated;
grant update (title, archived) on public.chat_threads to authenticated;

-- ---------------------------------------------------------------------------
-- Who's in each private chat. Leaving takes only your place: the messages stay.
-- ---------------------------------------------------------------------------

create table public.chat_thread_members (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  added_by uuid references public.users (id) on delete set null,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (thread_id, user_id)
);

create index chat_thread_members_user_idx on public.chat_thread_members (user_id);

create trigger chat_thread_members_touch before update on public.chat_thread_members
  for each row execute function public.touch_updated_date();

alter table public.chat_thread_members enable row level security;
grant select, insert, update, delete on public.chat_thread_members to authenticated, service_role;

-- The private chats the signed-in player is in. The policies use it (it skips
-- them, so a policy on chat_thread_members can ask without looping).
create or replace function public.chat_my_threads()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select thread_id from public.chat_thread_members where user_id = (select auth.uid());
$$;

-- Whether a player can read a room (null = Team Chat): they're on the team, and
-- it's Team Chat or a thread, the Captains' Lounge and they're a captain, or a
-- private chat they're in. The same rule as the policies below, for the
-- notification sender and the mention check, which ask about other players.
create or replace function public.chat_can_read(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    left join public.chat_threads t on t.id = p_thread_id
    where u.id = p_user_id
      and (u.joined_team_at is not null or u.role = 'admin')
      and (
        p_thread_id is null
        or t.visibility = 'team'
        or (t.visibility = 'captains' and u.role = 'admin')
        or (
          t.visibility = 'private'
          and exists (select 1 from public.chat_thread_members tm where tm.thread_id = t.id and tm.user_id = u.id)
        )
      )
  );
$$;

revoke execute on function public.chat_my_threads() from public, anon;
grant execute on function public.chat_my_threads() to authenticated, service_role;
revoke execute on function public.chat_can_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_can_read(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Rooms: threads for the team, the Lounge for captains, private chats for the people in them.
alter policy chat_threads_select on public.chat_threads
  using (
    (select public.is_team_member())
    and (
      visibility = 'team'
      or (visibility = 'captains' and (select public.is_captain()))
      or (visibility = 'private' and id in (select public.chat_my_threads()))
    )
  );

-- Players start threads directly; private chats start with chat_start_private()
-- (so the people come with them), and the Lounge is built in.
alter policy chat_threads_insert on public.chat_threads
  with check (created_by = (select auth.uid()) and (select public.is_team_member()) and visibility = 'team');

-- A thread: its starter or a captain. A private chat: its starter, while
-- they're still in it (captains have no say there). The Lounge stays as it is.
alter policy chat_threads_update on public.chat_threads
  using (
    (select public.is_team_member())
    and (
      (visibility = 'team' and (created_by = (select auth.uid()) or (select public.is_captain())))
      or (visibility = 'private' and created_by = (select auth.uid()) and id in (select public.chat_my_threads()))
    )
  )
  with check (
    (select public.is_team_member())
    and (
      (visibility = 'team' and (created_by = (select auth.uid()) or (select public.is_captain())))
      or (visibility = 'private' and created_by = (select auth.uid()) and id in (select public.chat_my_threads()))
    )
  );
alter policy chat_threads_delete on public.chat_threads
  using (
    (select public.is_team_member())
    and (
      (visibility = 'team' and (created_by = (select auth.uid()) or (select public.is_captain())))
      or (visibility = 'private' and created_by = (select auth.uid()) and id in (select public.chat_my_threads()))
    )
  );

-- Messages: Team Chat, plus the rooms you can see (the subquery only finds
-- those). Posting and editing already check the room the same way: they look
-- for an open room in chat_threads, which only has the ones you can see.
alter policy messages_select on public.messages
  using (
    (select public.is_team_member())
    and (thread_id is null or thread_id in (select t.id from public.chat_threads t))
  );

-- Deleting: your own messages; captains any message, except in private chats,
-- where everyone deletes only their own.
alter policy messages_delete on public.messages
  using (
    (user_id = (select auth.uid()) and (select public.is_team_member()))
    or (
      (select public.is_captain())
      and (thread_id is null or thread_id in (select t.id from public.chat_threads t where t.visibility <> 'private'))
    )
  );

-- Reactions: on the messages you can see, and the same captain rule for removing.
alter policy message_reactions_select on public.message_reactions
  using (
    (select public.is_team_member())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );
alter policy message_reactions_insert on public.message_reactions
  with check (
    user_id = (select auth.uid())
    and (select public.is_team_member())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );
alter policy message_reactions_delete on public.message_reactions
  using (
    (user_id = (select auth.uid()) and (select public.is_team_member()))
    or (
      (select public.is_captain())
      and exists (
        select 1 from public.messages m
        left join public.chat_threads t on t.id = m.thread_id
        where m.id = message_reactions.message_id and (m.thread_id is null or t.visibility <> 'private')
      )
    )
  );

-- Who's in a private chat: only its people see. People are added with
-- chat_start_private() and chat_add_members(). Anyone can leave; the starter
-- can also take someone out.
create policy chat_thread_members_select on public.chat_thread_members for select to authenticated
  using ((select public.is_team_member()) and thread_id in (select public.chat_my_threads()));
create policy chat_thread_members_delete on public.chat_thread_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.is_team_member())
      and thread_id in (select public.chat_my_threads())
      and exists (
        select 1 from public.chat_threads t
        where t.id = chat_thread_members.thread_id and t.created_by = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Starting a private chat, and adding people to one
-- ---------------------------------------------------------------------------

-- Starts a private chat with the teammates picked; the starter is in it too.
-- Only teammates on the site can be in one. Returns the new chat.
create or replace function public.chat_start_private(p_title text, p_user_ids uuid[])
returns public.chat_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  room public.chat_threads;
begin
  if me is null or not public.is_team_member() then
    raise exception 'Only teammates can start a private chat';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = any(p_user_ids) and u.id <> me and (u.joined_team_at is not null or u.role = 'admin')
  ) then
    raise exception 'Pick at least one teammate';
  end if;

  insert into public.chat_threads (title, created_by, author_name, visibility)
  select btrim(p_title), me, coalesce(p.display_name, u.full_name), 'private'
  from public.users u
  left join public.player_profiles p on p.user_id = u.id
  where u.id = me
  returning * into room;

  insert into public.chat_thread_members (thread_id, user_id, added_by)
  select room.id, u.id, me
  from public.users u
  where u.id = me or (u.id = any(p_user_ids) and (u.joined_team_at is not null or u.role = 'admin'));
  return room;
end;
$$;

-- Adds teammates to a private chat you're in (not while it's closed). They
-- see the whole chat, earlier messages included.
create or replace function public.chat_add_members(p_thread_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not public.is_team_member() then
    raise exception 'Only teammates can add people';
  end if;
  if not exists (
    select 1 from public.chat_threads t
    join public.chat_thread_members tm on tm.thread_id = t.id and tm.user_id = me
    where t.id = p_thread_id and t.visibility = 'private'
  ) then
    raise exception 'You''re not in that chat';
  end if;
  if exists (select 1 from public.chat_threads where id = p_thread_id and archived) then
    raise exception 'That chat is closed';
  end if;

  insert into public.chat_thread_members (thread_id, user_id, added_by)
  select p_thread_id, u.id, me
  from public.users u
  where u.id = any(p_user_ids) and (u.joined_team_at is not null or u.role = 'admin')
  on conflict (thread_id, user_id) do nothing;
end;
$$;

revoke execute on function public.chat_start_private(text, uuid[]) from public, anon;
revoke execute on function public.chat_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.chat_start_private(text, uuid[]) to authenticated, service_role;
grant execute on function public.chat_add_members(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Captains' Lounge
-- ---------------------------------------------------------------------------

insert into public.chat_threads (title, visibility)
select 'Captains'' Lounge', 'captains'
where not exists (select 1 from public.chat_threads where visibility = 'captains');

-- ---------------------------------------------------------------------------
-- @mentions: same as 20261016090000_chat_mentions.sql, except a message only
-- mentions teammates who can read its room, and @team only works in Team Chat
-- and threads (a private chat or the Lounge never pings the whole team).
-- ---------------------------------------------------------------------------

create or replace function public.message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.mentions := nullif(
    array(
      select u.id from public.users u
      where u.id = any(new.mentions)
        and u.id is distinct from new.user_id
        and public.chat_can_read(new.thread_id, u.id)
      order by u.id
    ),
    '{}'
  );
  new.mentions_team := coalesce(new.mentions_team, false)
    and exists (select 1 from public.users u where u.id = new.user_id and u.role = 'admin')
    and (new.thread_id is null or exists (select 1 from public.chat_threads t where t.id = new.thread_id and t.visibility = 'team'));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat summary: same as 20261016090000_chat_mentions.sql, plus each room's
-- kind (visibility; null for Team Chat), so private chats and the Lounge count
-- toward the Chat tab like Team Chat does. In a private chat, what was said
-- before you were added isn't unread. Rooms you can't see aren't listed (the
-- policies hide their messages). Recreated because it returns a new column.
-- ---------------------------------------------------------------------------

drop function public.chat_overview();

create function public.chat_overview()
returns table (
  thread_id uuid,
  last_message_at timestamptz,
  last_user_id uuid,
  last_author_name text,
  last_body text,
  last_read_at timestamptz,
  unread bigint,
  mentions bigint,
  visibility text
)
language sql
stable
set search_path = public
as $$
  with me as (
    select (select auth.uid()) as id,
      coalesce((select u.created_date from public.users u where u.id = (select auth.uid())), '-infinity'::timestamptz) as joined
  ),
  reads as (
    select r.thread_id, r.last_read_at from public.chat_reads r, me where r.user_id = me.id
  ),
  added as (
    select tm.thread_id, tm.created_date from public.chat_thread_members tm, me where tm.user_id = me.id
  ),
  latest as (
    select distinct on (m.thread_id) m.thread_id, m.created_date, m.user_id, m.author_name, left(m.body, 140) as body
    from public.messages m
    order by m.thread_id, m.created_date desc, m.id desc
  ),
  counts as (
    select m.thread_id,
      count(*) filter (
        where m.user_id is distinct from me.id
          and m.created_date > coalesce(rd.last_read_at, greatest(me.joined, ad.created_date))
      ) as unread,
      count(*) filter (
        where m.user_id is distinct from me.id
          and m.created_date > coalesce(rd.last_read_at, greatest(me.joined, ad.created_date))
          and (m.mentions_team or me.id = any(m.mentions))
      ) as mentions
    from public.messages m
    cross join me
    left join reads rd on rd.thread_id is not distinct from m.thread_id
    left join added ad on ad.thread_id = m.thread_id
    group by m.thread_id
  )
  select l.thread_id, l.created_date, l.user_id, l.author_name, l.body, rd.last_read_at, c.unread, c.mentions, t.visibility
  from latest l
  join counts c on c.thread_id is not distinct from l.thread_id
  left join reads rd on rd.thread_id is not distinct from l.thread_id
  left join public.chat_threads t on t.id = l.thread_id;
$$;

revoke execute on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who gets a message: same as 20261016090000_chat_mentions.sql, except only
-- players who can read its room, and everyone in a private chat or the Lounge
-- follows it (like Team Chat), not just those who opened it.
-- ---------------------------------------------------------------------------

create or replace function public.chat_push_targets(p_message_id uuid)
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  thread_id uuid,
  thread_title text,
  author_name text,
  body text
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.created_date < now() - interval '10 minutes' then
    return;
  end if;
  insert into public.push_log (message_id) values (p_message_id) on conflict do nothing;
  if not found then
    return;
  end if;

  return query
    select s.id, s.endpoint, s.p256dh, s.auth, m.thread_id, t.title,
      coalesce(p.display_name, m.author_name, 'Player'), m.body
    from public.push_subscriptions s
    left join public.player_profiles mine on mine.user_id = s.user_id
    left join public.chat_threads t on t.id = m.thread_id
    left join public.player_profiles p on p.user_id = m.user_id
    where s.user_id is distinct from m.user_id
      and public.chat_can_read(m.thread_id, s.user_id)
      and (
        (
          coalesce(mine.notify_chat, true)
          and (
            m.thread_id is null
            or t.visibility <> 'team'
            or s.user_id = t.created_by
            or exists (select 1 from public.chat_reads r where r.user_id = s.user_id and r.thread_id = m.thread_id)
          )
        )
        or (
          coalesce(mine.notify_mentions, true)
          and (m.mentions_team or s.user_id = any(m.mentions))
        )
      )
      and not exists (
        select 1 from public.chat_reads v
        where v.user_id = s.user_id
          and v.thread_id is not distinct from m.thread_id
          and v.viewing_at > now() - interval '40 seconds'
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- The app icon number: same as 20261016090000_chat_mentions.sql, with the
-- Chat tab's new rule (unreadTotal in src/lib/chat.js): Team Chat, the private
-- chats you're in and the Lounge for captains, plus threads you've opened.
-- ---------------------------------------------------------------------------

create or replace function public.chat_push_unread(p_subscription_ids uuid[])
returns table (subscription_id uuid, unread bigint)
language sql
stable
set search_path = public
as $$
  select s.id,
    case when coalesce(p.notify_chat, true) then (
      select count(*)
      from public.messages m
      left join public.chat_threads t on t.id = m.thread_id
      left join public.chat_reads r on r.user_id = s.user_id and r.thread_id is not distinct from m.thread_id
      left join public.chat_thread_members tm on tm.thread_id = m.thread_id and tm.user_id = s.user_id
      where m.user_id is distinct from s.user_id
        and (
          m.thread_id is null
          or (t.visibility = 'team' and r.last_read_at is not null)
          or (t.visibility = 'captains' and u.role = 'admin')
          or (t.visibility = 'private' and tm.user_id is not null)
        )
        and m.created_date > coalesce(r.last_read_at, greatest(u.created_date, tm.created_date), '-infinity'::timestamptz)
    ) else 0 end
  from public.push_subscriptions s
  left join public.users u on u.id = s.user_id
  left join public.player_profiles p on p.user_id = s.user_id
  where s.id = any(p_subscription_ids);
$$;

-- ---------------------------------------------------------------------------
-- Live updates: being added to (or taken out of) a private chat.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.chat_thread_members;
