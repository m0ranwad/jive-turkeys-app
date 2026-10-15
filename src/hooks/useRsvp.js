import { useState } from 'react';
import { api } from '@/api';
import { useToast } from '@/components/ui/toast';
import { saveFailedToast } from '@/lib/errors';

/**
 * Your own RSVP for a game: IN, MAYBE or OUT, and playing GK. Shared by the
 * Next game card on Schedule, the upcoming games list and the game page.
 * `data` is useSeasonData()'s; each answer is put in place (putRsvp) rather
 * than reloading everything.
 */
export function useRsvp(data) {
  const { toast } = useToast();
  // Games with a save on the way. Per game, so answering a second game doesn't
  // unlock the first one's buttons before its save is back.
  const [saving, setSaving] = useState(() => new Set());

  const mine = (game) => (data.rsvps || []).find((r) => r.game_id === game.id && r.user_id === data.user?.id) || null;

  const save = async (game, write) => {
    setSaving((s) => new Set(s).add(game.id));
    try {
      data.putRsvp(await write());
    } catch (err) {
      toast(saveFailedToast(err));
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(game.id);
        return next;
      });
    }
  };

  const setStatus = (game, status) => {
    const current = mine(game);
    if (current?.status === status) return undefined;
    return save(game, () =>
      current
        ? api.entities.Rsvp.update(current.id, { status, playing_gk: status === 'in' && !!current.playing_gk })
        : api.entities.Rsvp.create({ game_id: game.id, user_id: data.user.id, status, playing_gk: false }),
    );
  };

  const toggleGk = (game) => {
    const current = mine(game);
    if (!current) return undefined;
    return save(game, () => api.entities.Rsvp.update(current.id, { playing_gk: !current.playing_gk }));
  };

  return { mine, setStatus, toggleGk, isBusy: (game) => saving.has(game.id) };
}
