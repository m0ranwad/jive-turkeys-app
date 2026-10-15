-- Searching the chat: find that address, payment handle or field number
-- someone posted weeks ago. Words match in any form ("parking" finds
-- "park"), and anything else typed (a handle, a number) matches as written.
-- Runs with the searcher's own permissions, so it only finds messages they
-- can read.

alter table public.messages
  add column search tsvector generated always as (to_tsvector('english', body)) stored;

create index messages_search_idx on public.messages using gin (search);

-- The 50 best matches for `q`, newest first among equally good ones, with
-- the thread's title (null for Team Chat).
create or replace function public.chat_search(q text)
returns table (
  id uuid,
  thread_id uuid,
  thread_title text,
  user_id uuid,
  author_name text,
  body text,
  created_date timestamptz
)
language sql
stable
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', q) as words,
      '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as text_like
  )
  select m.id, m.thread_id, t.title, m.user_id, m.author_name, m.body, m.created_date
  from public.messages m
  left join public.chat_threads t on t.id = m.thread_id
  cross join query
  where char_length(btrim(q)) >= 2
    and (m.search @@ query.words or m.body ilike query.text_like)
  order by ts_rank(m.search, query.words) desc, m.created_date desc
  limit 50;
$$;

revoke execute on function public.chat_search(text) from public, anon;
grant execute on function public.chat_search(text) to authenticated, service_role;
