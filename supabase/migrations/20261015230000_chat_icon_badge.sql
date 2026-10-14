-- The number on the Home Screen app icon. With each chat notification,
-- notify-chat sends the player's unread chat count, and their phone puts it on
-- the icon. It's the same number as their Chat tab: Team Chat plus threads
-- they've opened, not counting their own messages (chat_overview() and
-- unreadTotal() in src/lib/chat.js).

create or replace function public.chat_push_unread(p_subscription_ids uuid[])
returns table (subscription_id uuid, unread bigint)
language sql
stable
set search_path = public
as $$
  select s.id,
    (
      select count(*)
      from public.messages m
      left join public.chat_reads r on r.user_id = s.user_id and r.thread_id is not distinct from m.thread_id
      where m.user_id is distinct from s.user_id
        and (m.thread_id is null or r.last_read_at is not null)
        and m.created_date > coalesce(r.last_read_at, u.created_date, '-infinity'::timestamptz)
    )
  from public.push_subscriptions s
  left join public.users u on u.id = s.user_id
  where s.id = any(p_subscription_ids);
$$;

-- Only the notification sender asks.
revoke execute on function public.chat_push_unread(uuid[]) from public, anon, authenticated;
grant execute on function public.chat_push_unread(uuid[]) to service_role;
