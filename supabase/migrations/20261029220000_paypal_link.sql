-- owner-approved: Brian requested @kircherbrian as the team's PayPal link.
-- Only the PayPal destination changes; fees, payments, history and all other
-- payment options stay as they are. Captains can edit this setting afterwards.
update public.team_settings
set pay_paypal = 'kircherbrian'
where pay_paypal is distinct from 'kircherbrian';
