-- Phone notifications for chat (Web Push).
--
-- When a message is posted, the database asks the notify-chat function to send
-- it out. The database decides who gets it (chat_push_targets), so the function
-- can't be talked into sending anything else:
--   - Team Chat messages go to everyone who turned notifications on;
--   - thread messages go to the thread's starter and anyone who has opened it;
--   - never to the author, and not to whoever is looking at that room right now.
-- Each message is handed out once (push_log).

-- ---------------------------------------------------------------------------
-- Which phones and browsers want notifications. One row per device.
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create trigger push_subscriptions_touch before update on public.push_subscriptions
  for each row execute function public.touch_updated_date();

alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;

-- Each player sees and manages only their own devices.
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Saves this device for the signed-in player. A device that was signed in as
-- someone else before now notifies whoever turned notifications on last.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  select (select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300)
  where (select auth.uid()) is not null
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
$$;

-- ---------------------------------------------------------------------------
-- Who's looking at which room right now (the chat page checks in every 15
-- seconds while it's on screen), so their phone doesn't buzz for it.
-- ---------------------------------------------------------------------------

alter table public.chat_reads add column viewing_at timestamptz;

create or replace function public.chat_viewing(p_thread_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.chat_reads (user_id, thread_id, last_read_at, viewing_at)
  values ((select auth.uid()), p_thread_id, now(), now())
  on conflict (user_id, thread_id) do update set viewing_at = excluded.viewing_at;
$$;

-- ---------------------------------------------------------------------------
-- Messages already handed out for notifications. Only the server side reads it.
-- ---------------------------------------------------------------------------

create table public.push_log (
  message_id uuid primary key references public.messages (id) on delete cascade,
  created_date timestamptz not null default now()
);

alter table public.push_log enable row level security;
-- No policies and no grant to players: only the notification sender uses it.
grant select, insert, update on public.push_log to service_role;

-- The phones to notify about one message, with what to say. Returns nothing if
-- the message is gone, older than 10 minutes, or was already handed out.
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
    left join public.chat_threads t on t.id = m.thread_id
    left join public.player_profiles p on p.user_id = m.user_id
    where s.user_id is distinct from m.user_id
      and (
        m.thread_id is null
        or s.user_id = t.created_by
        or exists (select 1 from public.chat_reads r where r.user_id = s.user_id and r.thread_id = m.thread_id)
      )
      and not exists (
        select 1 from public.chat_reads v
        where v.user_id = s.user_id
          and v.thread_id is not distinct from m.thread_id
          and v.viewing_at > now() - interval '40 seconds'
      );
end;
$$;

revoke execute on function public.push_subscribe(text, text, text, text) from public, anon;
revoke execute on function public.chat_viewing(uuid) from public, anon;
revoke execute on function public.chat_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated, service_role;
grant execute on function public.chat_viewing(uuid) to authenticated, service_role;
grant execute on function public.chat_push_targets(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- When a message is posted, ask the notify-chat function to send it out.
-- pg_net makes the call in the background, after the message is saved.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

create or replace function public.chat_push_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://alsskultsdgcbxlukznv.supabase.co/functions/v1/notify-chat',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    -- Notifications must never stop a message from being posted.
    raise warning 'chat notification not sent: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.chat_push_notify() from public, anon, authenticated;

create trigger messages_push after insert on public.messages
  for each row execute function public.chat_push_notify();
