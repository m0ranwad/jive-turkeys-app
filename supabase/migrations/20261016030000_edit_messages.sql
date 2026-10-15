-- Players can fix a typo in their own messages. The message changes for
-- everyone, with an "edited" label (edited_date, set here, not by the site).
-- Only the text can change: not who wrote it, where, when, or what it replies
-- to. Not in a closed thread, and captains don't edit other people's
-- messages (they delete instead). Editing never sends a notification.

alter table public.messages add column edited_date timestamptz;

-- The text is the only thing players can change; everything else is fixed once posted.
revoke update on public.messages from authenticated;
grant update (body) on public.messages to authenticated;

create policy messages_update on public.messages for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_team_member()))
  with check (
    user_id = (select auth.uid())
    and (select public.is_team_member())
    and (
      messages.thread_id is null
      or exists (select 1 from public.chat_threads t where t.id = messages.thread_id and not t.archived)
    )
  );

create or replace function public.message_edited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is distinct from old.body then
    new.edited_date := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.message_edited() from public, anon, authenticated;

create trigger messages_edited before update of body on public.messages
  for each row execute function public.message_edited();
