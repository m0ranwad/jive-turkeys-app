import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { gameLink } from '@/components/game/ShareButtons';
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar';
import { cn } from '@/lib/utils';

/** "Add to calendar" for one game: iPhone / Outlook (an .ics file), or Google Calendar. */
export function AddToCalendar({ game, settings, className }) {
  const [open, setOpen] = useState(false);
  const link = gameLink(game);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-white transition hover:bg-white/10',
          className,
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Add to calendar</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-600">
            vs {game.opponent}, with the field, jersey and a link back here.
          </p>
          <div className="grid gap-2">
            <Button
              onClick={() => {
                downloadIcs(game, settings, link);
                setOpen(false);
              }}
              className="h-12"
            >
              iPhone, Outlook or other calendar
            </Button>
            <a
              href={googleCalendarUrl(game, settings, link)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="inline-flex h-12 items-center justify-center rounded-md border border-input text-sm font-medium shadow-sm transition-colors hover:bg-accent"
            >
              Google Calendar
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
