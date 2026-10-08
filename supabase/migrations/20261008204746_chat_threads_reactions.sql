-- Team Chat upgrade: side threads, replies, emoji reactions and unread markers.
--
-- The main Team Chat stays where it is: messages with no thread_id. Anyone can
-- start a thread; its starter and captains can rename, close or remove it.

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  created_by uuid references public.users (id) on delete set null,
  author_name text,
  archived boolean not null default false,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter table public.messages
  add column thread_id uuid references public.chat_threads (id) on delete cascade,
  add column reply_to_id uuid references public.messages (id) on delete set null;

create index messages_thread_created_idx on public.messages (thread_id, created_date desc);

-- ---------------------------------------------------------------------------
-- Reactions: one row per player, message and emoji.
-- ---------------------------------------------------------------------------

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------------------
-- Read markers: how far each player has read in each room. A null thread_id
-- is the main Team Chat, so nulls count as equal for the unique key.
-- ---------------------------------------------------------------------------

create table public.chat_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  thread_id uuid references public.chat_threads (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  unique nulls not distinct (user_id, thread_id)
);

create trigger chat_threads_touch before update on public.chat_threads
  for each row execute function public.touch_updated_date();
create trigger message_reactions_touch before update on public.message_reactions
  for each row execute function public.touch_updated_date();
create trigger chat_reads_touch before update on public.chat_reads
  for each row execute function public.touch_updated_date();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.chat_threads enable row level security;
alter table public.message_reactions enable row level security;
alter table public.chat_reads enable row level security;

grant select, insert, update, delete on public.chat_threads to authenticated, service_role;
grant select, insert, update, delete on public.message_reactions to authenticated, service_role;
grant select, insert, update, delete on public.chat_reads to authenticated, service_role;

-- Threads: everyone reads; you start threads as yourself; the starter and
-- captains manage them.
create policy chat_threads_select on public.chat_threads for select to authenticated using (true);
create policy chat_threads_insert on public.chat_threads for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy chat_threads_update on public.chat_threads for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_captain()))
  with check (created_by = (select auth.uid()) or (select public.is_captain()));
create policy chat_threads_delete on public.chat_threads for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_captain()));

-- Messages: still posted as yourself, and no new messages in a closed thread.
alter policy messages_insert on public.messages
  with check (
    user_id = (select auth.uid())
    and (
      messages.thread_id is null
      or exists (select 1 from public.chat_threads t where t.id = messages.thread_id and not t.archived)
    )
  );

-- Reactions: everyone reads; you add and take back your own.
create policy message_reactions_select on public.message_reactions for select to authenticated using (true);
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_captain()));

-- Read markers are private to each player.
create policy chat_reads_own on public.chat_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Chat summary for the signed-in player: one row per room (null = Team Chat)
-- with its latest message, how far they've read and how many are unread.
-- Rooms they've never opened count as unread from the day they signed up.
-- ---------------------------------------------------------------------------

create or replace function public.chat_overview()
returns table (
  thread_id uuid,
  last_message_at timestamptz,
  last_user_id uuid,
  last_author_name text,
  last_body text,
  last_read_at timestamptz,
  unread bigint
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
      ) as unread
    from public.messages m
    cross join me
    left join reads rd on rd.thread_id is not distinct from m.thread_id
    group by m.thread_id
  )
  select l.thread_id, l.created_date, l.user_id, l.author_name, l.body, rd.last_read_at, c.unread
  from latest l
  join counts c on c.thread_id is not distinct from l.thread_id
  left join reads rd on rd.thread_id is not distinct from l.thread_id;
$$;

-- Moves the player's read marker forward (never back) in one room.
create or replace function public.chat_mark_read(p_thread_id uuid, p_read_at timestamptz)
returns void
language sql
set search_path = public
as $$
  insert into public.chat_reads (user_id, thread_id, last_read_at)
  values ((select auth.uid()), p_thread_id, p_read_at)
  on conflict (user_id, thread_id) do update
    set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
$$;

revoke execute on function public.chat_overview() from public, anon;
revoke execute on function public.chat_mark_read(uuid, timestamptz) from public, anon;
grant execute on function public.chat_overview() to authenticated, service_role;
grant execute on function public.chat_mark_read(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Live updates for new threads and reactions (messages are already live).
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.chat_threads, public.message_reactions;
