import { useEffect, useState } from 'react';
import { CaptainsOnly, PageHeader, PageSpinner } from '@/components/PageSpinner';
import { TeamCodeCard } from '@/components/TeamCodeCard';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { CARD, DEFAULT_SETTINGS } from '@/lib/constants';
import { saveTeamSettings } from '@/lib/actions';
import { saveFailedToast } from '@/lib/errors';
import { hoursLabel } from '@/lib/potm';
import { createSettingsAutosave } from '@/lib/settings-autosave';
import { cn } from '@/lib/utils';

const WINDOW_HOURS = [6, 12, 24, 48];
const REMINDER_HOURS = [0, 1, 2, 3, 6, 12];
const GAME_REMINDER_HOURS = [2, 4, 6, 12, 24];

/** A setting picked from a row of buttons, like the Player of the Match award choice. */
function Choice({ label, hint, options, value, onPick }) {
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <div>
        <Label>{label}</Label>
        {hint && <p className="mt-0.5 text-[11px] font-medium text-zinc-500">{hint}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            aria-pressed={value === opt.v}
            onClick={() => onPick(opt.v)}
            className={cn(
              'rounded-2xl border-2 px-3 py-2 text-xs font-bold uppercase tracking-[0.06em] transition',
              value === opt.v ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
            )}
          >
            {opt.l}
          </button>
        ))}
      </div>
    </div>
  );
}

const ON_OFF = [
  { v: true, l: 'On' },
  { v: false, l: 'Off' },
];

// A save can outlive this page. Returning while it is pending (or after a
// failure) uses the same draft and queue, rather than starting a competing save.
const drafts = new Map();

/**
 * Captains' team settings. Every change saves as it's made: a choice when it's
 * tapped, a typed field after a short pause or when you leave it. Navigation
 * flushes the draft too, including browser Back, which doesn't blur the field.
 */
export function SettingsPage() {
  const { user, settings, isCaptain, loading, reload, roster } = useTeam();
  const { toast } = useToast();
  const [editor, setEditor] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  // Filled once: saving reloads the team's settings, which mustn't wipe a field still being typed in.
  useEffect(() => {
    if (loading || !isCaptain || !user?.id) return;
    let autosave = drafts.get(user.id);
    if (!autosave) {
      autosave = createSettingsAutosave({ ...DEFAULT_SETTINGS, ...(settings || {}) }, {
        save: saveTeamSettings,
        onSaved: async () => {
          toast({ title: 'Team settings saved' });
          // A failed refresh is retried by the next screen's load; the write
          // itself has already succeeded.
          await reload().catch(() => {});
        },
        onError: (error) => toast(saveFailedToast(error)),
      });
      drafts.set(user.id, autosave);
    }
    setEditor(autosave);
    const unsubscribe = autosave.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      autosave.flush().finally(() => {
        if (drafts.get(user.id) === autosave && !autosave.hasSubscribers() && !autosave.isDirty()) drafts.delete(user.id);
      });
    };
    // Settings is only the starting value. Reloads mustn't overwrite a draft.
  }, [loading, isCaptain, user?.id, reload, toast]);

  if (loading) return <PageSpinner />;
  if (!isCaptain) return <CaptainsOnly>Team defaults are managed by the captains.</CaptainsOnly>;
  if (!editor || !snapshot) return <PageSpinner />;

  const { form, status } = snapshot;
  const pick = (patch) => editor.change(patch, true);

  // Typing schedules a save; blur/Enter also retries a failed field.
  const field = (label, key, props = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`setting-${key}`}>{label}</Label>
      <Input
        id={`setting-${key}`}
        value={form[key] ?? ''}
        onChange={(e) => editor.change({ [key]: e.target.value })}
        onBlur={() => editor.change({ [key]: form[key] }, true)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        {...props}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Team settings" subtitle="Defaults for every game, the coed minimums, and awards." />
      <p data-testid="settings-status" aria-live="polite" className="-mt-2 text-xs font-semibold text-zinc-500">
        {status === 'saving' ? 'Saving…' : status === 'error' ? 'Some changes haven’t saved. Try again.'
          : status === 'dirty' ? 'Unsaved changes.' : status === 'saved' ? 'All changes saved' : 'Changes save as you make them.'}
        {status === 'error' && <button type="button" onClick={() => editor.retry()} className="ml-1 inline-flex min-h-11 items-center px-2 underline underline-offset-2">Retry saving</button>}
      </p>
      <TeamCodeCard meId={user?.id} roster={roster} />
      <section className={cn(CARD, 'space-y-5')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('Primary jersey', 'primary_jersey')}
          {field('Backup jersey', 'backup_jersey')}
        </div>
        {field('Default venue name', 'venue_name')}
        {field('Default venue address', 'venue_address')}
        <div className="grid gap-4 sm:grid-cols-2">
          {field('Minimum players needed', 'min_players', { type: 'number', inputMode: 'numeric' })}
          {field('Minimum women field players', 'min_women', { type: 'number', inputMode: 'numeric' })}
        </div>
        <div className="space-y-2">
          <Label>Player of the Match</Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'overall', l: 'One overall award' },
              { v: 'separate', l: 'Man & Woman of the Match' },
            ].map((opt) => (
              <button
                key={opt.v}
                aria-pressed={form.potm_mode === opt.v}
                onClick={() => pick({ potm_mode: opt.v })}
                className={cn(
                  'rounded-2xl border-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.06em] transition',
                  form.potm_mode === opt.v ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <section className="space-y-4 rounded-2xl bg-zinc-50 p-3.5" aria-label="Player of the Match voting">
          <div>
            <span className="block text-sm font-bold">Player of the Match voting</span>
            <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">
              Voting opens when a captain posts the result. Players who played can vote until it closes. Notifications
              reach players who turned them on with the bell in the chat.
            </span>
          </div>
          <Choice
            label="Voting stays open for"
            options={WINDOW_HOURS.map((h) => ({ v: h, l: hoursLabel(h) }))}
            value={Number(form.potm_window_hours)}
            onPick={(h) =>
              // A reminder needs to come before voting closes.
              pick({
                potm_window_hours: h,
                potm_reminder_hours: Number(form.potm_reminder_hours) < h ? form.potm_reminder_hours : Math.max(...REMINDER_HOURS.filter((r) => r < h)),
              })
            }
          />
          <Choice
            label="Tell the team when voting opens"
            hint="A notification with the score and when voting closes."
            options={ON_OFF}
            value={!!form.potm_notify}
            onPick={(v) => pick({ potm_notify: v })}
          />
          <Choice
            label="Remind players who haven't voted"
            hint="Only players who played and haven't voted yet. Says how long is left."
            options={REMINDER_HOURS.filter((h) => h < Number(form.potm_window_hours)).map((h) => ({
              v: h,
              l: h === 0 ? 'Off' : `${hoursLabel(h)} before`,
            }))}
            value={Number(form.potm_reminder_hours)}
            onPick={(h) => pick({ potm_reminder_hours: h })}
          />
          <Choice
            label="Post the winners in Team Chat"
            hint="When voting closes, with the vote counts. Everyone with chat notifications on hears about it."
            options={ON_OFF}
            value={!!form.potm_announce}
            onPick={(v) => pick({ potm_announce: v })}
          />
        </section>
        <section className="space-y-4 rounded-2xl bg-zinc-50 p-3.5" aria-label="Game reminders">
          <div>
            <span className="block text-sm font-bold">Game reminders</span>
            <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">
              Before each game, Playing teammates who haven't answered get "Are you in?". If we're short, players available to sub who haven't said OUT are asked (only women, when it's women we need). Phones with
              notifications on only. Captains can also tap "Remind team" or "Call for subs" on a game any time to post one in Team Chat.
            </span>
          </div>
          <Choice
            label="Send game reminders"
            options={ON_OFF}
            value={!!form.game_reminders}
            onPick={(v) => pick({ game_reminders: v })}
          />
          {form.game_reminders && (
            <Choice
              label="How long before kickoff"
              options={GAME_REMINDER_HOURS.map((h) => ({ v: h, l: hoursLabel(h) }))}
              value={Number(form.game_reminder_hours)}
              onPick={(h) => pick({ game_reminder_hours: h })}
            />
          )}
        </section>
      </section>
    </div>
  );
}
