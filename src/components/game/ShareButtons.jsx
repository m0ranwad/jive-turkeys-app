import { useCallback, useState } from 'react';
import { Megaphone, UserPlus } from 'lucide-react';
import { PostToChatDialog } from '@/components/PostToChatDialog';
import { gameReminder, subsCall, subsToAsk } from '@/lib/team-posts';

export const gameLink = (game) => `${window.location.origin}/games/${game.id}`;

const BUTTON =
  'inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/20';

/** "Are you in?" for Team Chat, @mentioning whoever hasn't answered (or to copy). */
export function RemindTeamButton({ game, headcount, settings }) {
  const [open, setOpen] = useState(false);
  const message = useCallback(
    (nameOf) => gameReminder({ game, headcount, settings, link: gameLink(game), nameOf }),
    [game, headcount, settings],
  );

  return (
    <>
      <button onClick={() => setOpen(true)} className={BUTTON}>
        <Megaphone className="h-3.5 w-3.5" />
        Remind team
      </button>
      <PostToChatDialog
        open={open}
        onOpenChange={setOpen}
        title="Remind the team"
        intro="Whoever hasn't answered is named, so their phone buzzes."
        message={message}
        about={headcount.groups.none.map((e) => e.profile)}
      />
    </>
  );
}

/** "Subs needed" for Team Chat, @mentioning the available subs who haven't said IN or OUT (or to copy). */
export function CallForSubsButton({ game, settings, profiles, rsvps }) {
  const [open, setOpen] = useState(false);
  const message = useCallback(
    (nameOf) => subsCall({ game, settings, profiles, rsvps, link: gameLink(game), nameOf }),
    [game, settings, profiles, rsvps],
  );

  return (
    <>
      <button onClick={() => setOpen(true)} className={BUTTON}>
        <UserPlus className="h-3.5 w-3.5" />
        Call for subs
      </button>
      <PostToChatDialog
        open={open}
        onOpenChange={setOpen}
        title="Call for subs"
        intro="Teammates available to sub who haven't answered are named, so their phones buzz."
        message={message}
        about={subsToAsk({ game, profiles, rsvps })}
      />
    </>
  );
}
