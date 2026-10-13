import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { entryFor } from '@/lib/roster';
import { cn } from '@/lib/utils';
import { DIALOG, DIALOG_TITLE } from './DuesParts';

const CHOICES = [
  { value: 'active', label: 'Active' },
  { value: 'on_break', label: 'On Break' },
  { value: 'sub_pool', label: 'Sub Pool' },
  { value: 'off', label: 'Not on the team' },
];

/**
 * Captains: correct who was on a past session, say someone who sat it out but
 * was left Active. Only that session's list changes (and so its split).
 */
export function SessionRosterDialog({ open, onOpenChange, period, members, rows, meId, onSaved }) {
  const { toast } = useToast();
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);

  const people = members
    .filter((m) => !(m.guest && m.linked_user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const statusOf = (m) => entryFor(rows, period, m.user_id)?.status ?? 'off';

  useEffect(() => {
    if (open) setPicked({});
  }, [open]);

  const changed = people.filter((m) => picked[m.user_id] && picked[m.user_id] !== statusOf(m));

  const save = async () => {
    setBusy(true);
    try {
      for (const m of changed) {
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
          <DialogTitle className={DIALOG_TITLE}>Who was on session {period.session}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          This changes how session {period.session}'s fee is split. Payments already marked stay marked. Other
          sessions don't change.
        </p>
        <ul className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto">
          {people.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm font-semibold">{m.display_name}</span>
              <select
                aria-label={`${m.display_name} in session ${period.session}`}
                value={picked[m.user_id] ?? statusOf(m)}
                onChange={(e) => setPicked((p) => ({ ...p, [m.user_id]: e.target.value }))}
                className={cn(
                  'h-10 shrink-0 rounded-xl border border-zinc-200 bg-white px-2.5 text-sm font-semibold outline-none focus:border-zinc-900',
                  (picked[m.user_id] ?? statusOf(m)) === 'off' && 'text-zinc-500',
                )}
              >
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
