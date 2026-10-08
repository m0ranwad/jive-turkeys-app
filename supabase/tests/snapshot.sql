-- Used by scripts/db-rehearsal.sh: copies every row of every app table aside
-- (minus updated_date) so compare.sql can check them after new migrations.
create schema rehearsal;
create table rehearsal.snapshot (tbl text not null, row jsonb not null);

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('insert into rehearsal.snapshot select %L, to_jsonb(x) - ''updated_date'' from public.%I x', t, t);
  end loop;
end;
$$;
