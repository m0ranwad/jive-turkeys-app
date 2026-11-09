-- Photos in chat (idea #199). A photo message is an ordinary message whose
-- body is the optional caption, or "Photo" when there isn't one (what the room
-- list, replies, search and notifications show). The file lives in the private
-- Storage bucket chat-media under the poster's user id, and attachments keeps
-- the path and size:
--   [{ "type": "image", "path": "<user_id>/<id>.jpg", "width": 1200, "height": 800 }]
-- GIFs (20261101210000) stay as they were. Rules: docs/chat.md section 9.

-- One GIF from KLIPY, or one photo in the poster's own folder; nothing else.
create or replace function public.chat_attachments_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- coalesce: a missing type/width/height makes the AND NULL, and CHECK treats
  -- NULL as pass — so a path-only object would slip through.
  select coalesce(
    a is null or (
      jsonb_typeof(a) = 'array'
      and jsonb_array_length(a) = 1
      and jsonb_typeof(a -> 0) = 'object'
      and (
        (
          (select bool_and(k in ('type', 'url', 'width', 'height', 'title')) from jsonb_object_keys(a -> 0) k)
          and a -> 0 ->> 'type' = 'gif'
          and coalesce(a -> 0 ->> 'url', '') ~ '^https://([a-z0-9-]+\.)*klipy\.com/[^[:space:]"''<>]+$'
          and length(a -> 0 ->> 'url') <= 500
          and jsonb_typeof(a -> 0 -> 'width') = 'number' and (a -> 0 ->> 'width') ~ '^[1-9][0-9]{0,3}$'
          and jsonb_typeof(a -> 0 -> 'height') = 'number' and (a -> 0 ->> 'height') ~ '^[1-9][0-9]{0,3}$'
          and (a -> 0 -> 'title' is null or (jsonb_typeof(a -> 0 -> 'title') = 'string' and length(a -> 0 ->> 'title') <= 120))
        )
        or
        (
          (select bool_and(k in ('type', 'path', 'width', 'height')) from jsonb_object_keys(a -> 0) k)
          and a -> 0 ->> 'type' = 'image'
          and coalesce(a -> 0 ->> 'path', '') ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg)$'
          and length(a -> 0 ->> 'path') <= 120
          and jsonb_typeof(a -> 0 -> 'width') = 'number' and (a -> 0 ->> 'width') ~ '^[1-9][0-9]{0,3}$'
          and jsonb_typeof(a -> 0 -> 'height') = 'number' and (a -> 0 ->> 'height') ~ '^[1-9][0-9]{0,3}$'
        )
      )
    ),
    false
  );
$$;

-- A photo's path has to be under the signed-in player's folder.
create or replace function public.message_image_path_ok()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Shape (keys, path format) is chat_attachments_ok(); this only checks ownership
  -- when a path is present, so a bad shape still fails the check constraint.
  if new.attachments is not null
     and new.attachments -> 0 ->> 'type' = 'image'
     and new.attachments -> 0 ? 'path'
     and not ((new.attachments -> 0 ->> 'path') like (select auth.uid())::text || '/%') then
    raise exception 'That photo has to be in your own folder.';
  end if;
  return new;
end;
$$;

revoke execute on function public.message_image_path_ok() from public, anon, authenticated;

drop trigger if exists messages_image_path_ok on public.messages;
create trigger messages_image_path_ok before insert on public.messages
  for each row execute function public.message_image_path_ok();

-- A GIF or photo stays as posted: its text (caption) can't be edited.
create or replace function public.message_gif_fixed()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.attachments is not null and new.body is distinct from old.body then
    raise exception 'A GIF or photo can''t be edited. Delete it and send another.';
  end if;
  return new;
end;
$$;

-- Private bucket for chat photos. Team members can read; players upload only
-- under their own user id; the owner or a captain can delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  5242880,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do nothing;

-- RLS is already on for storage.objects on live Supabase; don't alter it
-- here (postgres isn't the owner). The test stubs enable it in stubs.sql.

drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.messages m
        where m.attachments -> 0 ->> 'path' = objects.name
      )
    )
  );

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (select public.is_team_member())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (select public.is_team_member())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_captain())
    )
  );
