-- GIFs in chat (the GIF button; idea #5). A GIF message is an ordinary message
-- whose body is "GIF" (what the room list, replies, search and notifications
-- show) with the GIF itself in `attachments`:
--   [{ "type": "gif", "url": "https://static.klipy.com/...", "width": 300, "height": 200, "title": "..." }]
-- Only GIFs from KLIPY's own servers can be saved: the site's pages are allowed
-- to load images from there (public/_headers), and a message can't point
-- players' phones anywhere else. Once posted, a GIF can't be changed, only
-- deleted (players' update rights stay body and mentions; this blocks the body
-- too). Rules: docs/chat.md section 8.

-- One GIF, as the GIF picker sends it; nothing else.
create or replace function public.chat_attachments_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select a is null or (
    jsonb_typeof(a) = 'array'
    and jsonb_array_length(a) = 1
    and jsonb_typeof(a -> 0) = 'object'
    and (select bool_and(k in ('type', 'url', 'width', 'height', 'title')) from jsonb_object_keys(a -> 0) k)
    and a -> 0 ->> 'type' = 'gif'
    and coalesce(a -> 0 ->> 'url', '') ~ '^https://([a-z0-9-]+\.)*klipy\.com/[^[:space:]"''<>]+$'
    and length(a -> 0 ->> 'url') <= 500
    and jsonb_typeof(a -> 0 -> 'width') = 'number' and (a -> 0 ->> 'width') ~ '^[1-9][0-9]{0,3}$'
    and jsonb_typeof(a -> 0 -> 'height') = 'number' and (a -> 0 ->> 'height') ~ '^[1-9][0-9]{0,3}$'
    and (a -> 0 -> 'title' is null or (jsonb_typeof(a -> 0 -> 'title') = 'string' and length(a -> 0 ->> 'title') <= 120))
  );
$$;

grant execute on function public.chat_attachments_ok(jsonb) to authenticated, service_role;

alter table public.messages add column attachments jsonb;
alter table public.messages add constraint messages_attachments_ok check (public.chat_attachments_ok(attachments));

-- A GIF message stays a GIF: its text can't be edited.
create or replace function public.message_gif_fixed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.attachments is not null and new.body is distinct from old.body then
    raise exception 'A GIF can''t be edited. Delete it and send another.';
  end if;
  return new;
end;
$$;

revoke execute on function public.message_gif_fixed() from public, anon, authenticated;

create trigger messages_gif_fixed before update of body on public.messages
  for each row execute function public.message_gif_fixed();
