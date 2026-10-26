select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);

do $$
begin
  if not exists (
    select 1 from public.team_guest_links l, public.session_roster r
    where l.guest_id = '00000000-0000-4000-8000-000000000004'
      and r.user_id = '00000000-0000-4000-8000-000000000002' and r.season_year = 2026 and r.session = 1
      and r.id = any (l.moved_partners)
  ) then
    raise exception 'FAILED: the upgrade records the old pick''s past partner';
  end if;
  raise notice 'ok - the upgrade records the old pick''s past partner';

  perform public.unlink_team_guest('00000000-0000-4000-8000-000000000004');
  if (select count(*) from public.session_roster
      where season_year = 2026 and session in (1, 2)
        and ((guest_id = '00000000-0000-4000-8000-000000000004' and pays_with_user = '00000000-0000-4000-8000-000000000002')
          or (user_id = '00000000-0000-4000-8000-000000000002' and pays_with_guest = '00000000-0000-4000-8000-000000000004'))) <> 4 then
    raise exception 'FAILED: undo restores both sides of the couple in past and current sessions';
  end if;
  raise notice 'ok - undo restores both sides of the couple in past and current sessions';

  if (select count(*) from public.dues_payments
      where season_year = 2026 and session = 1 and paid and paid_amount = 40
        and (guest_id = '00000000-0000-4000-8000-000000000004' or user_id = '00000000-0000-4000-8000-000000000002')) <> 2 then
    raise exception 'FAILED: both payments survive the upgrade and undo';
  end if;
  raise notice 'ok - both payments survive the upgrade and undo';
end;
$$;
