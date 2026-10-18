-- Dues: a session fee or a custom amount can't be below $0. The fee box now
-- refuses a blank or negative number before it saves, and the database refuses
-- one too, however it's saved.
--
-- "not valid": rows already saved aren't checked (there shouldn't be any below
-- $0), so this can't fail on the live database; every new or changed row is.

alter table public.session_dues
  add constraint session_dues_total_fee_not_negative check (total_fee >= 0) not valid;
alter table public.session_dues
  add constraint session_dues_league_fee_not_negative check (league_fee >= 0) not valid;
alter table public.session_dues
  add constraint session_dues_ref_fee_not_negative check (ref_fee >= 0) not valid;
alter table public.dues_payments
  add constraint dues_payments_override_amount_not_negative check (override_amount >= 0) not valid;
