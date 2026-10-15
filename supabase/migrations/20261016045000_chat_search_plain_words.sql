-- Searching the chat: what's typed is just text. websearch_to_tsquery read a
-- leading "-" as "without" (so "-4417" found every message except the one
-- with that number) and "or" as either word. plainto_tsquery only matches
-- words, still in any form ("parked" finds "parking").

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
    select plainto_tsquery('english', q) as words,
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
