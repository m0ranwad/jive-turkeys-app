-- The line under "Jive Turkeys" in the site's header ("Season 12 · Indoor
-- Coed") was fixed in the code. Captains now set it in Team Settings; empty
-- shows the old text.

alter table public.team_settings
  add column season_label text check (season_label is null or char_length(btrim(season_label)) between 1 and 40);
