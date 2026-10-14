import { useEffect, useState } from 'react';
import { Minus, Plus, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { MAX_GOALS_MAN, atGoalLimit, goalsTotal, listedRows, resultRows, scoreFollowsGoals } from '@/lib/results';
import { cn } from '@/lib/utils';

const TEAM = 'Jive Turkeys';
const EYEBROW = 'text-[10px] font-black uppercase tracking-[0.14em]';
const SMALL_BUTTON =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-black uppercase tracking-[0.08em] transition';

/** − number + with fingertip-sized buttons, so nobody needs the keyboard. */
function Stepper({ label, value, onChange, addLabel, removeLabel, valueLabel, canAdd = true, strong = false, tone }) {
  return (
    <div className="flex min-w-0 items-center overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <button
        type="button"
        aria-label={removeLabel}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className="grid h-11 w-10 shrink-0 place-items-center text-zinc-500 transition active:bg-zinc-100 disabled:text-zinc-200"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1 text-center leading-none">
        <output aria-label={valueLabel} className="block font-display text-lg font-extrabold">
          {value}
        </output>
        <span className={cn('mt-0.5 block truncate text-[9px] font-black uppercase tracking-[0.06em]', tone || 'text-zinc-400')}>
          {label}
        </span>
      </div>
      <button
        type="button"
        aria-label={addLabel}
        disabled={!canAdd}
        onClick={() => onChange(value + 1)}
        className={cn(
          'grid h-11 w-10 shrink-0 place-items-center transition disabled:bg-zinc-50 disabled:text-zinc-200',
          strong ? 'bg-lime-400 text-black active:bg-lime-300' : 'text-zinc-900 active:bg-zinc-100',
        )}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** One team's score: big + and −, and the number can still be typed. */
function ScoreBox({ team, value, onChange, dim = false }) {
  const n = Number(value) || 0;
  return (
    <div className="min-w-0">
      <div className={cn(EYEBROW, 'truncate', dim ? 'text-zinc-400' : 'text-zinc-900')}>{team}</div>
      <div className="mt-1.5 flex items-center gap-1">
        <button
          type="button"
          aria-label={`Take away a goal from ${team}`}
          disabled={n <= 0}
          onClick={() => onChange(n - 1)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-zinc-200 text-zinc-500 transition active:bg-zinc-100 disabled:text-zinc-200"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label={`${team} score`}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value)) || 0))}
          className={cn(
            'h-11 w-full min-w-0 rounded-xl bg-transparent text-center font-display text-3xl font-extrabold outline-none focus:bg-zinc-50',
            dim && 'text-zinc-400',
          )}
        />
        <button
          type="button"
          aria-label={`Add a goal for ${team}`}
          onClick={() => onChange(n + 1)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-zinc-200 text-zinc-900 transition active:bg-zinc-100"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PlayerRow({ row, cardsOpen, onToggleCards, onChange }) {
  const name = row.profile.display_name;
  const gender = row.profile.gender === 'F' ? 'W' : row.profile.gender === 'M' ? 'M' : '';
  const meta = [gender, row.profile.guest && 'Not joined', !row.played && "Didn't play"].filter(Boolean).join(' · ');
  const limit = atGoalLimit(row);
  const showCards = cardsOpen || (!row.played && row.blue_cards + row.red_cards > 0);
  const set = (key) => (value) => onChange({ [key]: Math.max(0, value) });

  return (
    <div
      data-player={name}
      className={cn('rounded-2xl border p-3', row.played ? 'border-zinc-200 bg-white' : 'border-dashed border-zinc-300 bg-zinc-50')}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-zinc-400">
            {meta && <span>{meta}</span>}
            {limit && row.played && <span className="rounded-full bg-amber-300 px-1.5 py-px text-black">{MAX_GOALS_MAN}-goal limit</span>}
            {row.blue_cards > 0 && <span className="rounded-full bg-sky-100 px-1.5 py-px text-sky-700">{row.blue_cards} blue</span>}
            {row.red_cards > 0 && <span className="rounded-full bg-red-100 px-1.5 py-px text-red-700">{row.red_cards} red</span>}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={showCards}
          aria-label={`Cards for ${name}`}
          onClick={onToggleCards}
          className={cn(SMALL_BUTTON, showCards ? 'bg-zinc-900 text-white' : 'border border-zinc-200 text-zinc-600')}
        >
          <span className="flex gap-0.5" aria-hidden="true">
            <span className="h-3 w-2 rounded-[2px] bg-sky-400" />
            <span className="h-3 w-2 rounded-[2px] bg-red-500" />
          </span>
          Card
        </button>
        {row.played ? (
          <button
            type="button"
            aria-label={`${name} didn't play`}
            onClick={() => onChange({ played: false, goals: 0, assists: 0 })}
            className={cn(SMALL_BUTTON, 'text-zinc-400 hover:text-zinc-900')}
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden min-[360px]:inline">Didn&apos;t play</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={`${name} played`}
            onClick={() => onChange({ played: true })}
            className={cn(SMALL_BUTTON, 'border border-zinc-200 text-zinc-600')}
          >
            <Plus className="h-3.5 w-3.5" /> Played
          </button>
        )}
      </div>

      {(row.played || row.goals + row.assists > 0) && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Stepper
            label="Goals"
            value={row.goals}
            onChange={set('goals')}
            canAdd={!limit}
            strong
            addLabel={`Add a goal for ${name}`}
            removeLabel={`Take away a goal from ${name}`}
            valueLabel={`${name} goals`}
          />
          <Stepper
            label="Assists"
            value={row.assists}
            onChange={set('assists')}
            addLabel={`Add an assist for ${name}`}
            removeLabel={`Take away an assist from ${name}`}
            valueLabel={`${name} assists`}
          />
        </div>
      )}

      {showCards && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stepper
            label="Blue"
            tone="text-sky-600"
            value={row.blue_cards}
            onChange={set('blue_cards')}
            addLabel={`Add a blue card for ${name}`}
            removeLabel={`Take away a blue card from ${name}`}
            valueLabel={`${name} blue cards`}
          />
          <Stepper
            label="Red"
            tone="text-red-600"
            value={row.red_cards}
            onChange={set('red_cards')}
            addLabel={`Add a red card for ${name}`}
            removeLabel={`Take away a red card from ${name}`}
            valueLabel={`${name} red cards`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Captain enters the score and the line for each player who played. Full
 * screen on phones, with the score on top and Save always in reach.
 */
export function ResultDialog({ open, onOpenChange, game, profiles, rsvps, stats, onSave }) {
  const [rows, setRows] = useState([]);
  // null: our score follows the players' goals; a number once a captain changes it.
  const [ourScore, setOurScore] = useState(null);
  const [scoreThem, setScoreThem] = useState(0);
  const [cardsOpen, setCardsOpen] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !game) return;
    const initial = resultRows({ game, profiles, rsvps, stats });
    setRows(initial);
    setOurScore(scoreFollowsGoals(game, initial) ? null : (game.score_us ?? 0));
    setScoreThem(game.score_them ?? 0);
    setCardsOpen([]);
    setAdding(false);
    // Only when it opens, so a reload behind it doesn't wipe what's entered.
  }, [open]);

  if (!open || !game) return null;

  const goals = goalsTotal(rows);
  const scoreUs = ourScore ?? goals;
  const listed = listedRows(rows);
  const others = rows.filter((row) => !listed.includes(row));
  const playedCount = rows.filter((row) => row.played).length;

  const updateRow = (userId, patch) =>
    setRows((list) => list.map((r) => (r.profile.user_id === userId ? { ...r, ...patch } : r)));
  const toggleCards = (userId) =>
    setCardsOpen((open) => (open.includes(userId) ? open.filter((id) => id !== userId) : [...open, userId]));

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
      <DialogContent
        // No keyboard popping up over the screen as it opens on a phone.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[100dvh] max-h-[100dvh] max-w-none flex-col gap-0 overflow-hidden border-0 p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-zinc-100 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className={cn(EYEBROW, 'text-lime-600')}>vs {game.opponent}</div>
          <DialogTitle className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight">Game result</DialogTitle>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ScoreBox team={TEAM} value={scoreUs} onChange={setOurScore} />
            <ScoreBox team={game.opponent} value={scoreThem} onChange={setScoreThem} dim />
          </div>
          {ourScore === null ? (
            <p className="mt-2 text-[11px] font-medium text-zinc-400">Our score adds up as you give players goals.</p>
          ) : Number(scoreUs) !== goals ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-amber-700">
              <span>
                Players&apos; goals: {goals} · Score: {Number(scoreUs) || 0}
              </span>
              <button
                type="button"
                onClick={() => setOurScore(null)}
                className="font-bold uppercase tracking-[0.08em] text-zinc-900 underline underline-offset-2"
              >
                Use {goals}
              </button>
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
          <div className={cn(EYEBROW, 'mb-2 text-zinc-400')}>Who played · {playedCount}</div>
          {rows.length > 0 && listed.length === 0 && (
            <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-500">Nobody&apos;s marked as playing yet. Add who played.</p>
          )}
          <div className="space-y-2">
            {listed.map((row) => (
              <PlayerRow
                key={row.profile.user_id}
                row={row}
                cardsOpen={cardsOpen.includes(row.profile.user_id)}
                onToggleCards={() => toggleCards(row.profile.user_id)}
                onChange={(patch) => updateRow(row.profile.user_id, patch)}
              />
            ))}
          </div>

          {adding ? (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-zinc-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={cn(EYEBROW, 'text-zinc-500')}>Who else played?</span>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-full bg-zinc-950 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white"
                >
                  Done
                </button>
              </div>
              {others.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">Everyone on the team is already on the list.</p>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {others.map((row) => (
                    <button
                      key={row.profile.user_id}
                      type="button"
                      aria-label={`Add ${row.profile.display_name}`}
                      onClick={() => updateRow(row.profile.user_id, { played: true })}
                      className={cn(
                        'inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition active:bg-zinc-100',
                        row.profile.guest ? 'border-dashed border-zinc-300 text-zinc-600' : 'border-zinc-200',
                      )}
                    >
                      <Plus className="h-3.5 w-3.5 text-zinc-400" />
                      {row.profile.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
            >
              <UserPlus className="h-4 w-4" /> Add a player
            </button>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-zinc-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 flex-1 rounded-2xl">
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} className="h-12 flex-[2] rounded-2xl font-bold">
            {busy ? 'Saving…' : 'Save result'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
