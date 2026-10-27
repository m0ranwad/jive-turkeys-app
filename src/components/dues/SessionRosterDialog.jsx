import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { entryFor } from '@/lib/roster';
import { cn } from '@/lib/utils';

const CHOICES = [
  { value: 'active', label: 'Playing' },
  { value: 'sub_pool', label: 'Available to sub' },
  { value: 'on_break', label: 'Unavailable' },
  { value: 'off', label: 'Not on the team' },
];

/**
 * Captains: correct who was on a past session, say someone who sat it out but
 * was left Active. Only that session's list changes (and so its split). Also
 * used to answer "Playing session N?" for teammates in a session asked about
 * ahead (`ahead`): there, anyone not on its list yet shows their status right now.
 * Between sessions that session is already the current one (`current`), so an
 * answer is their status right now, as when tapping a status on the Team page.
 */
export function SessionRosterDialog({ open, onOpenChange, period, members, rows, meId, onSaved, ahead = false, current = false }) {
  const { toast } = useToast();
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);

  const people = members
    .filter((m) => !(m.guest && m.linked_user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const statusOf = (m) => entryFor(rows, period, m.user_id)?.status ?? (ahead ? m.status : 'off');

  useEffect(() => {
    if (open) setPicked({});
  }, [open]);

  // Answering ahead, anyone who hasn't answered shows "No answer yet", and any pick is their answer.
  const waiting = (m) => ahead && !entryFor(rows, period, m.user_id)?.answered_at;
  const shown = (m) => picked[m.user_id] ?? (waiting(m) ? '' : statusOf(m));
  const changed = people.filter((m) => picked[m.user_id] && (picked[m.user_id] !== statusOf(m) || waiting(m)));

  const save = async () => {
    setBusy(true);
    try {
      for (const m of changed) {
        // The current session's list follows everyone's status (the database's follow triggers).
        // "Not on the team" is for this session only, so it goes on the list.
        if (current && picked[m.user_id] !== 'off') {
          const status = picked[m.user_id];
          if (m.guest) await api.entities.TeamGuest.update(m.id, { status });
          else await api.entities.PlayerProfile.update(m.id, { status });
          continue;
        }
        const fields = { status: picked[m.user_id], answered_at: new Date().toISOString(), changed_by: meId };
        const entry = entryFor(rows, period, m.user_id);
        if (entry) await api.entities.SessionRoster.update(entry.id, fields);
        else {
          await api.entities.SessionRoster.create({
            season_year: Number(period.year),
            session: Number(period.session),
            user_id: m.guest ? null : m.user_id,
            guest_id: m.guest ? m.user_id : null,
            ...fields,
          });
        }
      }
      await onSaved();
      toast({ title: `Session ${period.session} updated` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>
            {ahead ? `Answers for session ${period.session}` : `Who was on session ${period.session}`}
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          {ahead && current
            ? `Answer for anyone, including roster names who haven't joined. It's their status for session ${period.session}, as on the Team page.`
            : ahead
            ? `Answer for anyone, including roster names who haven't joined. Only session ${period.session} changes, not the session being played.`
            : `This changes how session ${period.session}'s fee is split. Payments already marked stay marked. Other sessions don't change.`}
        </p>
        <ul className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto">
          {people.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm font-semibold">{m.display_name}</span>
              <select
                aria-label={`${m.display_name} in session ${period.session}`}
                value={shown(m)}
                onChange={(e) => setPicked((p) => ({ ...p, [m.user_id]: e.target.value }))}
                className={cn(
                  'h-10 shrink-0 rounded-xl border border-zinc-200 bg-white px-2.5 text-sm font-semibold outline-none focus:border-zinc-900',
                  ['off', ''].includes(shown(m)) && 'text-zinc-500',
                )}
              >
                {waiting(m) && (
                  <option value="" disabled>
                    No answer yet
                  </option>
                )}
                {CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <Button
          onClick={save}
          disabled={busy || changed.length === 0}
          className="h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]"
        >
          {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'No changes'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
