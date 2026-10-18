import { useId, useState } from 'react';
import dayjs from 'dayjs';
import { CalendarPlus, Download, ExternalLink, MapPin } from 'lucide-react';
import { gameLink } from '@/components/game/ShareButtons';
import { JerseyDot } from '@/components/schedule/GameCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GAME_MINUTES, downloadIcs, googleCalendarUrl } from '@/lib/calendar';
import { DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { fmtDateShort, jerseyText, venueText } from '@/lib/format';
import { normalizeTime } from '@/lib/schedule-import';
import { cn } from '@/lib/utils';

/** "7:00 – 7:55 PM", the hour the event takes up. A game with no time yet goes in as an all-day event. */
function timeRange(game) {
  const time = normalizeTime(game.time);
  if (!time) return 'All day · time TBD';
  const start = dayjs(`${game.date}T${time}`);
  const end = start.add(GAME_MINUTES, 'minute');
  const from = start.format('A') === end.format('A') ? start.format('h:mm') : start.format('h:mm A');
  return `${from} – ${end.format('h:mm A')}`;
}

// Android phones come with Google Calendar; iPhones, Macs and Outlook open the file.
const prefersGoogle = () => /android/i.test(navigator.userAgent);

/** One way to add it: an icon, a name, and what will happen. A button, or a link with `as="a"`. */
function Choice({ as: Tag = 'button', icon: Icon, title, hint, primary, ...props }) {
  const id = useId();
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      className="flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-white p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-black/10 hover:bg-zinc-50 active:scale-[0.99]"
      {...props}
    >
      <span
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
          primary ? 'bg-lime-400 text-black' : 'bg-zinc-100 text-zinc-700',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-sm font-bold text-zinc-950">
          {title}
        </span>
        <span id={`${id}-hint`} className="mt-0.5 block text-xs text-zinc-500">
          {hint}
        </span>
      </span>
    </Tag>
  );
}

/** What lands in the calendar: a date tile, the title, when, and where. */
function EventPreview({ game, settings }) {
  const day = dayjs(game.date);
  const where = game.location || venueText(settings);
  return (
    <div className="flex gap-3.5 rounded-2xl bg-zinc-50 p-3.5">
      <div
        aria-hidden="true"
        className="w-14 shrink-0 self-start overflow-hidden rounded-xl bg-white text-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/5"
      >
        <div className="bg-lime-400 py-0.5 text-[11px] font-black uppercase tracking-[0.14em] text-black">{day.format('MMM')}</div>
        <div className="py-1.5 font-display text-2xl font-extrabold leading-none">{day.format('D')}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold leading-snug text-zinc-950">Jive Turkeys vs {game.opponent}</div>
        <div className="mt-0.5 text-xs font-semibold text-zinc-600">
          {fmtDateShort(game.date)} · {timeRange(game)}
        </div>
        <div className="mt-2 space-y-1 text-xs text-zinc-500">
          {where && (
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{where}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="grid w-3.5 shrink-0 place-items-center">
              <JerseyDot jersey={game.jersey} className="h-2.5 w-2.5" />
            </span>
            Field {game.field_number || 'TBD'} · {jerseyText(game.jersey, settings)} jersey
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Add to calendar" for one game: Apple Calendar / Outlook (an .ics file), or Google Calendar. */
export function AddToCalendar({ game, settings, className }) {
  const [open, setOpen] = useState(false);
  const link = gameLink(game);

  const choices = [
    {
      key: 'file',
      icon: Download,
      title: 'Apple Calendar, Outlook & others',
      hint: 'Adds it from a calendar file',
      onClick: () => {
        downloadIcs(game, settings, link);
        setOpen(false);
      },
    },
    {
      key: 'google',
      as: 'a',
      href: googleCalendarUrl(game, settings, link),
      target: '_blank',
      rel: 'noreferrer',
      icon: ExternalLink,
      title: 'Google Calendar',
      hint: 'Opens Google Calendar',
      onClick: () => setOpen(false),
    },
  ];
  if (prefersGoogle()) choices.reverse();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-white transition hover:bg-white/10',
          className,
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" /> Add to calendar
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={DIALOG}>
          <DialogHeader className="text-left">
            <DialogTitle className={DIALOG_TITLE}>Add to calendar</DialogTitle>
          </DialogHeader>
          <EventPreview game={game} settings={settings} />
          <div className="grid gap-2">
            {choices.map(({ key, ...choice }, i) => (
              <Choice key={key} primary={i === 0} {...choice} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
