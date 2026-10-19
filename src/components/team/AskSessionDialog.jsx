import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { saveFailedToast } from '@/lib/errors';

/**
 * Captains: ask "Playing session N?" before its schedule is out, or while this
 * session still has games left. Its first game's date is all it needs. Asking
 * again changes the date; Stop asking takes the question away.
 */
export function AskSessionDialog({ open, onOpenChange, period, ask, onSaved }) {
  const { toast } = useToast();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDate(ask?.starts_on || '');
  }, [open, ask]);

  if (!period) return null;

  const save = async (startsOn) => {
    setBusy(true);
    try {
      await api.roster.ask({ year: period.year, session: period.session, startsOn });
      await onSaved();
      toast({
        title: startsOn ? `Asking who's playing session ${period.session}` : `Stopped asking about session ${period.session}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast(saveFailedToast(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Ask who's playing session {period.session}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-zinc-600">
          Everyone sees "Playing session {period.session}?" on Schedule now, even before the schedule is out or while this
          session still has games left. Their answers only count for session {period.session}. Add its games when the
          league sends them.
        </p>
        <div className="space-y-2">
          <Label htmlFor="session-starts">First game's date</Label>
          <Input id="session-starts" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Button
          onClick={() => save(date)}
          disabled={busy || !date}
          className="h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]"
        >
          {ask ? 'Save the date' : 'Ask the team'}
        </Button>
        {ask && (
          <Button
            variant="outline"
            onClick={() => save(null)}
            disabled={busy}
            className="h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]"
          >
            Stop asking
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
