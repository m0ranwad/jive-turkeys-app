-- Used by scripts/db-rehearsal.sh: every row snapshotted before the new
-- migrations must still exist with the same values. Added columns are fine.
do $$
declare
  t text;
  total integer;
  lost integer;
  lost_total integer := 0;
begin
  for t in select distinct tbl from rehearsal.snapshot order by 1 loop
    select count(*) into total from rehearsal.snapshot where tbl = t;
    if to_regclass(format('public.%I', t)) is null then
      lost := total;
    else
      execute format(
        'select count(*) from rehearsal.snapshot s where s.tbl = %L
           and not exists (select 1 from public.%I x where to_jsonb(x) - ''updated_date'' @> s.row)',
        t, t
      ) into lost;
    end if;
    if lost > 0 then
      raise warning '%: % of % rows missing or changed', t, lost, total;
      lost_total := lost_total + lost;
    else
      raise notice '%: all % rows kept', t, total;
    end if;
  end loop;
  if lost_total > 0 then
    raise exception '% existing rows were removed or changed', lost_total;
  end if;
end;
$$;
