import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { rosterProfiles } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const STAT_COLUMNS = [
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'blue_cards', label: 'Blue' },
  { key: 'red_cards', label: 'Red' },
];

/** Captain enters the score and each player's line for a game. */
export function ResultDialog({ open, onOpenChange, game, profiles, rsvps, stats, onSave }) {
  const [scoreUs, setScoreUs] = useState(0);
  const [scoreThem, setScoreThem] = useState(0);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !game) return;
    const rsvpByUser = {};
    rsvps.filter((r) => r.game_id === game.id).forEach((r) => (rsvpByUser[r.user_id] = r));
    const statByUser = {};
    stats.filter((s) => s.game_id === game.id).forEach((s) => (statByUser[s.user_id] = s));
    setScoreUs(game.score_us ?? 0);
    setScoreThem(game.score_them ?? 0);
    setRows(
      rosterProfiles(profiles)
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((profile) => {
          const s = statByUser[profile.user_id];
          return {
            profile,
            // Default to whoever RSVP'd IN when there's no line yet.
            played: s ? !!s.played : rsvpByUser[profile.user_id]?.status === 'in',
            goals: s?.goals || 0,
            assists: s?.assists || 0,
            blue_cards: s?.blue_cards || 0,
            red_cards: s?.red_cards || 0,
          };
        }),
    );
  }, [open, game, profiles, rsvps, stats]);

  if (!open || !game) return null;

  const updateRow = (userId, patch) =>
    setRows((list) => list.map((r) => (r.profile.user_id === userId ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ score_us: Number(scoreUs) || 0, score_them: Number(scoreThem) || 0, rows });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Game result</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Jive Turkeys</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={scoreUs}
                onChange={(e) => setScoreUs(e.target.value)}
                className="text-center font-display text-xl font-extrabold"
              />
            </div>
            <div className="space-y-2">
              <Label>{game.opponent}</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={scoreThem}
                onChange={(e) => setScoreThem(e.target.value)}
                className="text-center font-display text-xl font-extrabold"
              />
            </div>
          </div>
        </div>
        <div className="mt-2 border-t border-zinc-100">
          <div className="flex items-center gap-2 px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
            <span className="flex-1">Player</span>
            <span className="w-14 text-center">Played</span>
            {STAT_COLUMNS.map((c) => (
              <span key={c.key} className="w-11 text-center">
                {c.label}
              </span>
            ))}
          </div>
          <div className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <div key={row.profile.user_id} className="px-6 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {row.profile.display_name}
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-zinc-400">
                        {row.profile.gender === 'F' ? 'W' : 'M'}
                      </span>
                    </div>
                    {row.profile.gender === 'M' && row.goals >= 2 && (
                      <span className="mt-1 inline-block rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-black">
                        2-goal cap reached
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => updateRow(row.profile.user_id, { played: !row.played })}
                    aria-label={row.played ? 'Played' : 'Did not play'}
                    className={cn(
                      'grid h-8 w-14 place-items-center rounded-xl border-2 transition',
                      row.played ? 'border-lime-400 bg-lime-400 text-black' : 'border-zinc-200 text-zinc-300',
                    )}
                  >
                    {row.played ? <Check className="h-4 w-4" /> : <span className="text-[10px] font-bold">—</span>}
                  </button>
                  {STAT_COLUMNS.map((c) => (
                    <input
                      key={c.key}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={row[c.key]}
                      disabled={!row.played && c.key !== 'red_cards'}
                      aria-label={`${row.profile.display_name} ${c.key.replace('_', ' ')}`}
                      onChange={(e) =>
                        updateRow(row.profile.user_id, { [c.key]: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-8 w-11 rounded-xl border border-zinc-200 text-center text-sm font-semibold outline-none transition focus:border-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-300"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2 px-6 pb-6 pt-4 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
