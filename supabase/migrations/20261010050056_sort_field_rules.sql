-- Sorts the live Field Rules into sections (a line ending with a colon starts
-- one, see src/lib/rules.js): the same rules, word for word, under five
-- headings, with "Coed division rules are the same ... exceptions:" replaced
-- by the "Coed rules:" heading.
--
-- The creator (a co-owner) approved this on 2026-10-10. It changes saved team
-- data, so the rehearsal reports it. It only replaces the list while it is
-- still exactly the one 20261008000000_init.sql saved, so a list a captain has
-- edited is left alone. Undo: a new migration that puts that list back.
-- owner-approved

do $$
declare
  changed integer;
begin
  update public.team_settings
  set rules_bullets = jsonb_build_array(
    'Before you play:',
    'Players must have a completed liability waiver form on file before they will be permitted to play.',
    'Shin guards must be worn by all players. Jewelry must be taped or removed.',
    'Blood from any wound must be stopped and fully covered before a player may be on the field of play.',
    'The game:',
    'Games consist of two 25-minute halves with a 5-minute halftime. The clock starts promptly at the appointed time and will not be stopped.',
    'Substitutions are "on the fly." Guaranteed substitutions are allowed when the ball leaves the field of play and must be completed within 20 seconds. Substitutions are not guaranteed during the final two minutes of a half.',
    'Offside rules do not apply.',
    'A team down by five goals may add an additional field player as long as the differential exists.',
    'The ball and restarts:',
    'Three-line violations occur when a ball is played in the air over all three lines without touching anything. The ball is placed in the middle of the first red line it passed over and a restart is given to the opposing team.',
    'A ball hitting the roof is given to the opposing team and reset at the nearest line.',
    'Out-of-bounds balls are brought back into play at the point they went out.',
    'Passing back to the goalie is permitted from anywhere, but the goalie is NOT permitted to pick the ball up if it is played back with the feet.',
    'Kicks are all direct. Minor fouls inside the box are brought outside the penalty area.',
    'Restarts and penalty kicks must be taken within five seconds.',
    'Fouls and cards:',
    'Slide tackling is not permitted and may result in a red card. The only exception is the goalie, who may slide in the penalty area.',
    'Intentional or violent boarding is not permitted.',
    'Foul or abusive language is not permitted.',
    'Sporting behavior is expected from players and fans. Fighting will result in permanent suspension from the facility without a refund.',
    'Cards: An offending player is sent off for two minutes and the team plays a person down. Three blue cards on the same player result in a red card, and the team plays a person down for five minutes. Red cards are serious and result in at least a one-game suspension, reviewed by management for possible further action.',
    'Coed rules:',
    'Two-goal limit per male.',
    'Minimum of three women field players on the field at all times. A woman playing in goal does not count as a field player.',
    'Women take all kicks.'
  )
  where rules_bullets = jsonb_build_array(
    'Players must have a completed liability waiver form on file before they will be permitted to play.',
    'Shin guards must be worn by all players. Jewelry must be taped or removed.',
    'Sporting behavior is expected from players and fans. Fighting will result in permanent suspension from the facility without a refund.',
    'Games consist of two 25-minute halves with a 5-minute halftime. The clock starts promptly at the appointed time and will not be stopped.',
    'Offside rules do not apply.',
    'Three-line violations occur when a ball is played in the air over all three lines without touching anything. The ball is placed in the middle of the first red line it passed over and a restart is given to the opposing team.',
    'Passing back to the goalie is permitted from anywhere, but the goalie is NOT permitted to pick the ball up if it is played back with the feet.',
    'A ball hitting the roof is given to the opposing team and reset at the nearest line.',
    'Out-of-bounds balls are brought back into play at the point they went out.',
    'A team down by five goals may add an additional field player as long as the differential exists.',
    'Blood from any wound must be stopped and fully covered before a player may be on the field of play.',
    'Substitutions are "on the fly." Guaranteed substitutions are allowed when the ball leaves the field of play and must be completed within 20 seconds. Substitutions are not guaranteed during the final two minutes of a half.',
    'Restarts and penalty kicks must be taken within five seconds.',
    'Slide tackling is not permitted and may result in a red card. The only exception is the goalie, who may slide in the penalty area.',
    'Intentional or violent boarding is not permitted.',
    'Foul or abusive language is not permitted.',
    'Kicks are all direct. Minor fouls inside the box are brought outside the penalty area.',
    'Cards: An offending player is sent off for two minutes and the team plays a person down. Three blue cards on the same player result in a red card, and the team plays a person down for five minutes. Red cards are serious and result in at least a one-game suspension, reviewed by management for possible further action.',
    'Coed division rules are the same as all other age groups with these exceptions:',
    'Two-goal limit per male.',
    'Minimum of three women field players on the field at all times. A woman playing in goal does not count as a field player.',
    'Women take all kicks.'
  );
  get diagnostics changed = row_count;
  raise notice 'Field rules sorted into sections: % team settings row(s) changed', changed;
end
$$;
