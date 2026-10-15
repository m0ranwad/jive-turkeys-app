-- @mentions in the chat. Typing @ in the message box picks a teammate; the text
-- keeps the readable "@Jordan R." and the message keeps who it mentions
-- (messages.mentions, their user ids, set by the site when sending or editing).
-- Captains can also ping everyone with @team (messages.mentions_team).
--
-- Mentions get their own count next to the unread number (chat_overview), and a
-- notification even in a thread the player hasn't opened, or with chat
-- notifications off, unless they turn @mentions off (notify_mentions).

alter table public.messages
  add column mentions uuid[],
  add column mentions_team boolean not null default false;

alter table public.player_profiles
  add column notify_mentions boolean not null default true;

-- An edit can change who a message mentions, along with its text.
grant update (mentions, mentions_team) on public.messages to authenticated;

-- Whatever the site sends, a message only mentions teammates on the site, each
-- once and never its author, and only a captain's message can mention @team.
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
        and (u.joined_team_at is not null or u.role = 'admin')
      order by u.id
    ),
    '{}'
  );
  new.mentions_team := coalesce(new.mentions_team, false)
    and exists (select 1 from public.users u where u.id = new.user_id and u.role = 'admin');
  return new;
end;
$$;

revoke execute on function public.message_mentions() from public, anon, authenticated;

create trigger messages_mentions before insert or update of mentions, mentions_team on public.messages
  for each row execute function public.message_mentions();

-- ---------------------------------------------------------------------------
-- Chat summary: same as 20261008204746_chat_threads_reactions.sql, plus each
-- room's unread messages that mention you (by name or @team). Recreated
-- because it returns a new column.
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
  mentions bigint
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
  latest as (
    select distinct on (m.thread_id) m.thread_id, m.created_date, m.user_id, m.author_name, left(m.body, 140) as body
    from public.messages m
    order by m.thread_id, m.created_date desc, m.id desc
  ),
  counts as (
    select m.thread_id,
      count(*) filter (
        where m.user_id is distinct from me.id and m.created_date > coalesce(rd.last_read_at, me.joined)
      ) as unread,
      count(*) filter (
        where m.user_id is distinct from me.id and m.created_date > coalesce(rd.last_read_at, me.joined)
          and (m.mentions_team or me.id = any(m.mentions))
      ) as mentions
    from public.messages m
    cross join me
    left join reads rd on rd.thread_id is not distinct from m.thread_id
    group by m.thread_id
  )
  select l.thread_id, l.created_date, l.user_id, l.author_name, l.body, rd.last_read_at, c.unread, c.mentions
  from latest l
  join counts c on c.thread_id is not distinct from l.thread_id
  left join reads rd on rd.thread_id is not distinct from l.thread_id;
$$;

revoke execute on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who gets a message: same as 20261015200000_notification_choices.sql, plus
-- everyone it mentions (by name or @team) who has @mentions on, wherever it is.
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
    join public.users u on u.id = s.user_id and (u.joined_team_at is not null or u.role = 'admin')
    left join public.player_profiles mine on mine.user_id = s.user_id
    left join public.chat_threads t on t.id = m.thread_id
    left join public.player_profiles p on p.user_id = m.user_id
    where s.user_id is distinct from m.user_id
      and (
        (
          coalesce(mine.notify_chat, true)
          and (
            m.thread_id is null
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
-- The app icon number: same as 20261015230000_chat_icon_badge.sql, except
-- players who turned chat messages off get none (0 clears it), since an
-- @mention can now reach them.
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
      left join public.chat_reads r on r.user_id = s.user_id and r.thread_id is not distinct from m.thread_id
      where m.user_id is distinct from s.user_id
        and (m.thread_id is null or r.last_read_at is not null)
        and m.created_date > coalesce(r.last_read_at, u.created_date, '-infinity'::timestamptz)
    ) else 0 end
  from public.push_subscriptions s
  left join public.users u on u.id = s.user_id
  left join public.player_profiles p on p.user_id = s.user_id
  where s.id = any(p_subscription_ids);
$$;
