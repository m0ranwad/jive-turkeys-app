import { useState } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import dayjs from 'dayjs';

// How long after joining a player sees the tip.
const NEW_FOR_DAYS = 14;
const closedKey = (userId) => `jt_new_player_tip_${userId}`;

function readClosed(userId) {
  try {
    return !!localStorage.getItem(closedKey(userId));
  } catch {
    return false;
  }
}

/** "New here? Indoor rules are different": one line on Schedule for a player's first two weeks, until they close it. */
export function NewPlayerTip({ profile }) {
  const [closed, setClosed] = useState(() => !profile || readClosed(profile.user_id));
  if (closed || !profile?.created_date || dayjs().diff(dayjs(profile.created_date), 'day') >= NEW_FOR_DAYS) return null;

  const close = () => {
    try {
      localStorage.setItem(closedKey(profile.user_id), '1');
    } catch {
      // Private mode: it shows again next time.
    }
    setClosed(true);
  };

  return (
    <p
      className="flex items-center gap-2 rounded-2xl bg-lime-50 py-1.5 pl-4 pr-1.5 text-xs font-semibold text-lime-900"
      data-testid="new-player-tip"
    >
      <span className="flex-1">
        New here? Indoor rules are different.{' '}
        <Link to="/rules" className="underline underline-offset-2">
          Field Rules
        </Link>
      </span>
      <button
        type="button"
        onClick={close}
        aria-label="Close the Field Rules tip"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lime-900 transition hover:bg-lime-100"
      >
        <X className="h-4 w-4" />
      </button>
    </p>
  );
}
