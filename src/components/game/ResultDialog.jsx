import { useEffect, useState } from 'react';
import { Minus, Plus, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import {
  MAX_GOALS_MAN,
  atGoalLimit,
  fillInLabel,
  gameFillIns,
  goalsTotal,
  listedRows,
  resultRows,
  scoreFollowsGoals,
} from '@/lib/results';
import { EYEBROW } from '@/lib/constants';
import { saveFailedToast } from '@/lib/errors';
import { HALVES, suggestedKeepers } from '@/lib/keepers';
import { cn } from '@/lib/utils';

const TEAM = 'Jive Turkeys';
let nextFillInKey = 0;
const SMALL_BUTTON =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-black uppercase tracking-[0.08em] transition';

/**
 * − number + with fingertip-sized buttons, so nobody needs the keyboard. `onStep(±1)` replaces
 * onChange for a number that isn't a plain count (goals against: "?" until someone sets it).
 */
function Stepper({ label, value, onChange, onStep, addLabel, removeLabel, valueLabel, canAdd = true, canRemove = value > 0, strong = false, tone }) {
  const step = (delta) => (onStep ? onStep(delta) : onChange(value + delta));
  return (
    <div className="flex min-w-0 items-center overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <button
        type="button"
        aria-label={removeLabel}
        disabled={!canRemove}
        onClick={() => step(-1)}
        className="grid h-11 w-10 shrink-0 place-items-center text-zinc-500 transition active:bg-zinc-100 disabled:text-zinc-200"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1 text-center leading-none">
        <output aria-label={valueLabel} className="block font-display text-lg font-extrabold">
          {value}
        </output>
        <span className={cn('mt-0.5 block truncate text-[11px] font-black uppercase tracking-[0.06em]', tone || 'text-zinc-500')}>
          {label}
        </span>
      </div>
      <button
        type="button"
        aria-label={addLabel}
        disabled={!canAdd}
        onClick={() => step(1)}
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
      <div className={cn(EYEBROW, 'truncate', dim ? 'text-zinc-500' : 'text-zinc-900')}>{team}</div>
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
            dim && 'text-zinc-500',
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

const genderLetter = (gender) => (gender === 'F' ? 'W' : gender === 'M' ? 'M' : '');
const META = 'mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-zinc-500';
const LimitTag = () => <span className="rounded-full bg-amber-300 px-1.5 py-px text-black">{MAX_GOALS_MAN}-goal limit</span>;

/** Goals (men stop at two) and assists, for a teammate or a fill-in. */
function GoalsAndAssists({ name, gender, goals, assists, onChange }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      <Stepper
        label="Goals"
        value={goals}
        onChange={(value) => onChange({ goals: Math.max(0, value) })}
        canAdd={!atGoalLimit(gender, goals)}
        strong
        addLabel={`Add a goal for ${name}`}
        removeLabel={`Take away a goal from ${name}`}
        valueLabel={`${name} goals`}
      />
      <Stepper
        label="Assists"
        value={assists}
        onChange={(value) => onChange({ assists: Math.max(0, value) })}
        addLabel={`Add an assist for ${name}`}
        removeLabel={`Take away an assist from ${name}`}
        valueLabel={`${name} assists`}
      />
    </div>
  );
}

function PlayerRow({ row, cardsOpen, onToggleCards, onChange }) {
  const name = row.profile.display_name;
  const meta = [genderLetter(row.profile.gender), row.profile.guest && 'Not joined', !row.played && "Didn't play"]
    .filter(Boolean)
    .join(' · ');
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
          <div className={META}>
            {meta && <span>{meta}</span>}
            {row.played && atGoalLimit(row.profile.gender, row.goals) && <LimitTag />}
            {row.blue_cards > 0 && <span className="rounded-full bg-sky-100 px-1.5 py-px text-sky-700">{row.blue_cards} blue</span>}
            {row.red_cards > 0 && <span className="rounded-full bg-red-100 px-1.5 py-px text-red-700">{row.red_cards} red</span>}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={showCards}
          aria-label={`Card for ${name}`}
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
            className={cn(SMALL_BUTTON, 'text-zinc-500 hover:text-zinc-900')}
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
        <GoalsAndAssists name={name} gender={row.profile.gender} goals={row.goals} assists={row.assists} onChange={onChange} />
      )}

      {showCards && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stepper
            label="Blue"
            tone="text-sky-700"
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

const NOBODY = '';

/**
 * Who was in goal each half, and the other team's goals in each half (they add up to their
 * score, so setting one fills in the other). A half at 0 is a clean sheet. Captains always
 * enter goals against; Team Settings decides whether the site shows them (docs/games.md section 2).
 */
function KeepersBox({ options, keepers, onPick, suggested, opponent, total, split, onStepAgainst, onNotSure }) {
  return (
    <section aria-label="Keepers" className="mb-4 rounded-2xl bg-zinc-50 p-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
        <span className={cn(EYEBROW, 'text-zinc-900')}>Keepers</span>
        {suggested && <span className="text-[11px] font-semibold text-zinc-500">From &ldquo;I&apos;ll play GK&rdquo;</span>}
      </div>
      <div className="space-y-2">
        {HALVES.map((half, h) => {
          const value = split ? split[h] : null;
          return (
            <div key={half} data-half={half} className="rounded-2xl border border-zinc-200 bg-white p-2.5">
              <div className="flex items-center gap-2">
                <span className={cn(EYEBROW, 'w-[68px] shrink-0 text-zinc-500')}>{half}</span>
                <select
                  aria-label={`Keeper, ${half}`}
                  value={keepers[h] ?? NOBODY}
                  onChange={(e) => onPick(h, e.target.value || null)}
                  className={cn(
                    'h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2.5 text-base font-semibold outline-none focus:border-zinc-900 md:text-sm',
                    !keepers[h] && 'text-zinc-500',
                  )}
                >
                  <option value={NOBODY}>Nobody recorded</option>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 grid grid-cols-2 items-center gap-2">
                <Stepper
                  label="Against"
                  value={value ?? '?'}
                  onStep={(delta) => onStepAgainst(h, delta)}
                  canAdd={total > 0 && (value === null || value < total)}
                  canRemove={total > 0 && (value === null || value > 0)}
                  addLabel={`Add a goal against in the ${half}`}
                  removeLabel={`Take away a goal against in the ${half}`}
                  valueLabel={`Goals against, ${half}`}
                />
                {value === 0 ? (
                  <span className="inline-flex h-9 items-center justify-self-start rounded-full border border-lime-500 bg-lime-50 px-3 text-[11px] font-black uppercase tracking-[0.08em] text-lime-800">
                    Clean sheet
                  </span>
                ) : value === null ? (
                  <span className="pl-1 text-[11px] font-semibold leading-snug text-zinc-500">Not sure yet</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {total > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 px-0.5 text-[11px] font-semibold text-zinc-500">
          <span>
            The halves add up to {opponent}
            {/s$/i.test(opponent || '') ? "'" : "'s"} {total}.
          </span>
          {split && (
            <button
              type="button"
              onClick={onNotSure}
              className="inline-flex min-h-9 items-center font-bold uppercase tracking-[0.08em] text-zinc-900 underline underline-offset-2"
            >
              Not sure
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Someone from outside the team who played for us: name if anyone caught it, goals and assists. */
function FillInRow({ fillIn, label, number, onChange, onRemove }) {
  return (
    <div data-fill-in={label} className="rounded-2xl border border-dashed border-lime-500 bg-lime-50/50 p-3">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            maxLength={60}
            aria-label={`Name of fill-in ${number}`}
            placeholder="Name, if you know it"
            value={fillIn.display_name}
            onChange={(e) => onChange({ display_name: e.target.value })}
            className="h-9 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-zinc-500 focus:border-zinc-900"
          />
          <div className={META}>
            <span>{[genderLetter(fillIn.gender), 'Fill-in, not on the team'].filter(Boolean).join(' · ')}</span>
            {atGoalLimit(fillIn.gender, fillIn.goals) && <LimitTag />}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className={cn(SMALL_BUTTON, 'text-zinc-500 hover:text-zinc-900')}
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden min-[360px]:inline">Remove</span>
        </button>
      </div>
      <GoalsAndAssists name={label} gender={fillIn.gender} goals={fillIn.goals} assists={fillIn.assists} onChange={onChange} />
    </div>
  );
}

/**
 * Captain enters the score and the line for each player who played, plus any
 * fill-ins from outside the team. Full screen on phones, with the score on top
 * and Save always in reach.
 */
export function ResultDialog({ open, onOpenChange, game, profiles, rsvps, stats, fillIns: savedFillIns = [], onSave }) {
  const [rows, setRows] = useState([]);
  // People from outside the team who played: { key, id (once saved), display_name, gender, goals, assists }.
  const [fillIns, setFillIns] = useState([]);
  // null: our score follows the players' goals; a number once a captain changes it.
  const [ourScore, setOurScore] = useState(null);
  const [scoreThem, setScoreThem] = useState(0);
  const [cardsOpen, setCardsOpen] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // Who was in goal each half: a player's user_id, `fill:<key>` for a fill-in, or null.
  const [keepers, setKeepers] = useState([null, null]);
  const [suggested, setSuggested] = useState(false);
  // The other team's goals in the 1st half; null until someone's sure.
  const [againstFirst, setAgainstFirst] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !game) return;
    const initial = resultRows({ game, profiles, rsvps, stats });
    const initialFillIns = gameFillIns(game, savedFillIns).map((f) => ({
      key: f.id,
      id: f.id,
      display_name: f.display_name || '',
      gender: f.gender,
      goals: f.goals || 0,
      assists: f.assists || 0,
      gk_first_half: !!f.gk_first_half,
      gk_second_half: !!f.gk_second_half,
    }));
    const saved = ['gk_first_half', 'gk_second_half'].map((flag) => {
      const row = initial.find((r) => r[flag]);
      if (row) return row.profile.user_id;
      const fill = initialFillIns.find((f) => f[flag]);
      return fill ? `fill:${fill.key}` : null;
    });
    // A game with no keeper yet suggests whoever said "I'll play GK" (saved only when Save is tapped).
    const suggestion = saved.some(Boolean) ? null : suggestedKeepers(initial, rsvps, game);
    setKeepers(suggestion || saved);
    setSuggested(!!suggestion?.some(Boolean));
    setAgainstFirst(game.has_result ? (game.score_them_first_half ?? null) : null);
    setRows(initial);
    setFillIns(initialFillIns);
    setOurScore(scoreFollowsGoals(game, initial, initialFillIns) ? null : (game.score_us ?? 0));
    setScoreThem(game.score_them ?? 0);
    setCardsOpen([]);
    setAdding(false);
    // Only when it opens, so a reload behind it doesn't wipe what's entered.
  }, [open]);

  if (!open || !game) return null;

  const goals = goalsTotal(rows, fillIns);
  const scoreUs = ourScore ?? goals;
  const listed = listedRows(rows);
  const others = rows.filter((row) => !listed.includes(row));
  const playedCount = rows.filter((row) => row.played).length + fillIns.length;

  // Taking a keeper off the list takes them out of goal too.
  const dropKeeper = (key) => setKeepers((list) => list.map((k) => (k === key ? null : k)));
  const updateRow = (userId, patch) => {
    if (patch.played === false) dropKeeper(userId);
    setRows((list) => list.map((r) => (r.profile.user_id === userId ? { ...r, ...patch } : r)));
  };
  const keeperOptions = [
    ...listed.filter((row) => row.played).map((row) => ({ key: row.profile.user_id, label: row.profile.display_name })),
    ...fillIns.map((f, i) => ({ key: `fill:${f.key}`, label: `${fillInLabel(f, i, fillIns.length)} (fill-in)` })),
  ];
  const keeperShown = (k) => (keeperOptions.some((o) => o.key === k) ? k : null);
  const shownKeepers = keepers.map(keeperShown);
  const pickKeeper = (half, key) => {
    setSuggested(false);
    setKeepers((list) => list.map((k, h) => (h === half ? key : k)));
  };
  // Goals against: the two halves add up to the other team's score.
  const totalAgainst = Number(scoreThem) || 0;
  const firstAgainst = againstFirst === null ? null : Math.min(againstFirst, totalAgainst);
  const split = totalAgainst === 0 ? [0, 0] : firstAgainst === null ? null : [firstAgainst, totalAgainst - firstAgainst];
  const stepAgainst = (half, delta) => {
    // The first tap on a "?" sets that half to 1 (or 0), and the other half to the rest.
    const current = split ? split[half] : delta > 0 ? 0 : 1;
    const next = Math.max(0, Math.min(totalAgainst, current + delta));
    setAgainstFirst(half === 0 ? next : totalAgainst - next);
  };
  const addFillIn = (gender) => {
    nextFillInKey += 1;
    const key = `new-${nextFillInKey}`;
    setFillIns((list) => [...list, { key, display_name: '', gender, goals: 0, assists: 0 }]);
  };
  const updateFillIn = (key, patch) => setFillIns((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const removeFillIn = (key) => {
    dropKeeper(`fill:${key}`);
    setFillIns((list) => list.filter((f) => f.key !== key));
  };
  const toggleCards = (userId) =>
    setCardsOpen((open) => (open.includes(userId) ? open.filter((id) => id !== userId) : [...open, userId]));

  const save = async () => {
    setBusy(true);
    try {
      const inGoal = (key) => ({ gk_first_half: shownKeepers[0] === key, gk_second_half: shownKeepers[1] === key });
      await onSave({
        score_us: Number(scoreUs) || 0,
        score_them: totalAgainst,
        score_them_first_half: split ? split[0] : null,
        rows: rows.map((row) => ({ ...row, ...inGoal(row.profile.user_id) })),
        fillIns: fillIns.map((f) => ({ ...f, ...inGoal(`fill:${f.key}`) })),
      });
      onOpenChange(false);
    } catch (err) {
      // The screen stays open with everything entered, to try again.
      toast(saveFailedToast(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // No keyboard popping up over the screen as it opens on a phone.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[100dvh] max-h-[100dvh] max-w-none flex-col gap-0 overflow-hidden border-0 p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-zinc-100 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className={cn(EYEBROW, 'text-lime-700')}>vs {game.opponent}</div>
          <DialogTitle className="mt-0.5 font-display text-lg font-extrabold uppercase tracking-tight">Game result</DialogTitle>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ScoreBox team={TEAM} value={scoreUs} onChange={setOurScore} />
            <ScoreBox team={game.opponent} value={scoreThem} onChange={setScoreThem} dim />
          </div>
          {ourScore === null ? (
            <p className="mt-2 text-[11px] font-medium text-zinc-500">Our score adds up as you give players goals.</p>
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
          <KeepersBox
            options={keeperOptions}
            keepers={shownKeepers}
            onPick={pickKeeper}
            suggested={suggested && shownKeepers.some(Boolean)}
            opponent={game.opponent}
            total={totalAgainst}
            split={split}
            onStepAgainst={stepAgainst}
            onNotSure={() => setAgainstFirst(null)}
          />
          <div className={cn(EYEBROW, 'mb-2 text-zinc-500')}>Who played · {playedCount}</div>
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
            {fillIns.map((fillIn, i) => (
              <FillInRow
                key={fillIn.key}
                fillIn={fillIn}
                label={fillInLabel(fillIn, i, fillIns.length)}
                number={i + 1}
                onChange={(patch) => updateFillIn(fillIn.key, patch)}
                onRemove={() => removeFillIn(fillIn.key)}
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
                  className="rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white"
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
                      <Plus className="h-3.5 w-3.5 text-zinc-500" />
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

          {/* Someone from outside the team, maybe without a name: their goals count for the score. */}
          <div className="mt-2 flex items-center gap-1.5 rounded-2xl border-2 border-dashed border-zinc-200 py-1.5 pl-4 pr-1.5">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500">Add a fill-in</div>
              <div className="text-[11px] text-zinc-500">Not on the team</div>
            </div>
            {[
              ['M', 'Man'],
              ['F', 'Woman'],
            ].map(([gender, label]) => (
              <button
                key={gender}
                type="button"
                aria-label={`Add a fill-in ${label.toLowerCase()}`}
                onClick={() => addFillIn(gender)}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-700 transition active:bg-zinc-100"
              >
                <Plus className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
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
