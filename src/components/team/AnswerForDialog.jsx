import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { saveSessionAnswer } from '@/components/dues/SessionRosterDialog';
import { DIALOG, DIALOG_TITLE, STATUS_LABEL, STATUS_OPTIONS } from '@/lib/constants';
import { saveFailedToast } from '@/lib/errors';
import { fmtDateShort } from '@/lib/format';
import { entryFor } from '@/lib/roster';
import { cn } from '@/lib/utils';

/**
 * Captains: "Playing session N?" for one teammate, from a name tapped on the Team page's
 * Who's playing card. Three big buttons, no dropdown (a phone zooms in on a small one).
 * `current`: the session about to start (or, between sessions, the one asked about), so the
 * answer is their status right now; otherwise it goes in that session's list only.
 * `answering`: { member, period, startsOn, current } or null.
 */
export function AnswerForDialog({ answering, rows, meId, onOpenChange, onSaved }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!answering) return null;
  const { member, period, startsOn, current } = answering;
  const isMe = member.user_id === meId;
  // Until they answer, they're down as their status carried over (anyone not on the list yet: today's).
  const downAs = entryFor(rows, period, member.user_id)?.status ?? member.status ?? 'active';

  const answer = async (status) => {
    setBusy(true);
    try {
      await saveSessionAnswer({ member, status, period, rows, current, meId });
      await onSaved();
      toast({ title: `${isMe ? 'You' : member.display_name}: ${STATUS_LABEL[status]} for session ${period.session}` });
      onOpenChange(false);
    } catch (err) {
      toast(saveFailedToast(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <span className="text-[11px] font-black uppercase tracking-[0.16em] text-lime-700">Playing session {period.session}?</span>
          <DialogTitle className={DIALOG_TITLE}>{member.display_name}</DialogTitle>
        </DialogHeader>
        <div className="-mt-2 space-y-0.5 text-sm text-zinc-600">
          <p className="text-zinc-500">
            {startsOn ? `Starts ${fmtDateShort(startsOn)}` : 'Start date to come'}
            {member.guest && " · Hasn't joined the site"}
          </p>
          <p>
            {isMe ? "You're down as " : 'Down as '}
            <b className="font-semibold text-zinc-900">{STATUS_LABEL[downAs] || 'Playing'}</b>
            {isMe ? '.' : ' until someone answers.'}
          </p>
        </div>
        <div className="grid gap-2" role="group" aria-label={`${member.display_name} in session ${period.session}`}>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => answer(opt.value)}
              className={cn(
                'min-h-12 rounded-2xl border-2 px-4 font-display text-sm font-extrabold uppercase tracking-[0.04em] transition motion-safe:active:scale-[0.98] disabled:opacity-60',
                // The status they're down as is outlined: tapping it confirms it.
                opt.value === downAs
                  ? 'border-lime-400 bg-white text-lime-700 hover:bg-lime-50'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
