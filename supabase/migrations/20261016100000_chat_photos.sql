-- Photos in the chat: team pics, the standings board, a screenshot of the
-- schedule, or a GIF saved on the phone. The site shrinks photos before they
-- upload (GIFs go up as they are, so they keep moving) into a private storage
-- bucket, chat-media, one folder per player. A message lists its photos in
-- messages.attachments: [{ "type": "image", "path": "<user id>/<name>.jpg",
-- "width": 1600, "height": 1200 }], up to 4. Photos with no caption still have
-- a body ("📷 Photo", "🎞️ GIF" or "📷 3 photos"), since every message needs text;
-- it's what the room list, notifications, replies and search show.
--
-- Photos are fixed once posted (only the caption can be edited). Deleting the
-- message is how a photo goes: the site then removes its files. Only team
-- members see them.

alter table public.messages add column attachments jsonb;

-- Whatever the site sends: 1 to 4 images, each the poster's own upload, with its size.
create or replace function public.message_attachments()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  a jsonb;
begin
  if new.attachments is null then
    return new;
  end if;
  if jsonb_typeof(new.attachments) <> 'array' or jsonb_array_length(new.attachments) not between 1 and 4 then
    raise exception 'A message can have 1 to 4 photos' using errcode = 'check_violation';
  end if;
  for a in select value from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(a) <> 'object'
      or a ->> 'type' is distinct from 'image'
      or coalesce(a ->> 'path', '') !~ ('^' || coalesce(new.user_id::text, '-') || '/[A-Za-z0-9_-]{1,64}\.(jpg|png|gif|webp)$')
      or jsonb_typeof(a -> 'width') is distinct from 'number'
      or jsonb_typeof(a -> 'height') is distinct from 'number'
    then
      raise exception 'A message can only show photos its author uploaded' using errcode = 'check_violation';
    end if;
    if (a ->> 'width')::numeric not between 1 and 10000 or (a ->> 'height')::numeric not between 1 and 10000 then
      raise exception 'That photo''s size looks wrong' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.message_attachments() from public, anon, authenticated;

create trigger messages_attachments before insert on public.messages
  for each row execute function public.message_attachments();

-- ---------------------------------------------------------------------------
-- Where the photos are kept: private, images only, 5 MB each at most (photos
-- are shrunk to well under that; it's GIFs that can be big).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 5242880, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- Team members see every chat photo.
create policy chat_media_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and (select public.is_team_member()));

-- Players upload only into their own folder (named after their user id).
create policy chat_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (select public.is_team_member())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The poster or a captain removes a photo. So does anyone tidying up after a
-- deleted message or thread: a file no message shows anymore can go.
create policy chat_media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (select public.is_team_member())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_captain())
      or not exists (
        select 1 from public.messages m
        where m.attachments @> jsonb_build_array(jsonb_build_object('path', objects.name))
      )
    )
  );
