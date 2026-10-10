import { useState } from 'react';
import dayjs from 'dayjs';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { dollars, feeParts, feeTotal, payOptions } from '@/lib/dues';
import { shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

export const DIALOG = 'max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-3xl p-5 sm:max-w-md';
export const DIALOG_TITLE = 'font-display text-lg font-extrabold uppercase tracking-tight';
export const HEADING = 'font-display text-sm font-extrabold uppercase tracking-[0.12em]';
export const EYEBROW = 'text-[10px] font-black uppercase tracking-[0.14em]';

export const shortDate = (date) => (date ? dayjs(date).format('MMM D') : '');

/** "‹ Session 2 · 2026 ›" */
export function SessionStepper({ period, note, onStep }) {
  const arrow = 'grid h-10 w-10 place-items-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-black';
  return (
    <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <button type="button" onClick={() => onStep(-1)} aria-label="Previous session" className={arrow}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="text-center">
        <div className="font-display text-sm font-extrabold uppercase tracking-[0.12em]" data-testid="dues-session">
          Session {period.session} · {period.year}
        </div>
        {note && <div className={cn(EYEBROW, 'mt-0.5 text-zinc-400')}>{note}</div>}
      </div>
      <button type="button" onClick={() => onStep(1)} aria-label="Next session" className={arrow}>
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Paid (pale lime, with the date) or Unpaid (amber). Not a button. `dateOnly` drops the word "Paid". */
export function StatusChip({ paid, date, dateOnly, className }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]',
        paid ? 'bg-lime-100 text-lime-900' : 'bg-amber-100 text-amber-900',
        className,
      )}
    >
      {paid && <Check className="h-3 w-3" strokeWidth={3.5} />}
      {paid ? (dateOnly && date ? shortDate(date) : `Paid${date ? ` ${shortDate(date)}` : ''}`) : 'Unpaid'}
    </span>
  );
}

export function Avatar({ name, className }) {
  const letters = (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
  return (
    <span
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 font-display text-[11px] font-black text-zinc-600',
        className,
      )}
    >
      {letters}
    </span>
  );
}

/** "$595 league + 7 × $18 refs = $721", or just the total for fees saved without the breakdown. */
export function feeLine(row) {
  const parts = feeParts(row);
  const total = dollars(feeTotal(parts));
  if (!parts.ref_fee || !parts.game_count) return `${total} session fee`;
  return `${dollars(parts.league_fee)} league + ${parts.game_count} × ${dollars(parts.ref_fee)} refs = ${total}`;
}

/** One line of the paid / not paid history: who marked whom, and when. */
export function historyLine(event, nameOf, meId) {
  const actor = !event.changed_by ? 'Someone' : event.changed_by === meId ? 'You' : shortName(nameOf(event.changed_by));
  const subject =
    event.user_id === event.changed_by
      ? actor === 'You'
        ? 'yourself'
        : 'themselves'
      : event.user_id === meId
        ? 'you'
        : shortName(nameOf(event.user_id));
  return `${actor} marked ${subject} ${event.paid ? 'paid' : 'not paid'}`;
}

export function HistoryList({ events, nameOf, meId, limit }) {
  const [all, setAll] = useState(false);
  const shown = all || !limit ? events : events.slice(0, limit);
  return (
    <div>
      <ul className="space-y-2.5">
        {shown.map((event) => (
          <li key={event.id} className="flex gap-3">
            <span
              className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', event.paid ? 'bg-lime-400' : 'bg-amber-400')}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-800">{historyLine(event, nameOf, meId)}</span>
              <span className="block text-[11px] font-medium text-zinc-400">
                {dayjs(event.created_date).format('ddd, MMM D · h:mm A')}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {limit && events.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-3 text-xs font-bold text-zinc-500 underline underline-offset-2"
        >
          {all ? 'Show less' : `Show all ${events.length}`}
        </button>
      )}
    </div>
  );
}

const BRAND = {
  venmo: { letter: 'V', className: 'bg-[#008CFF] text-white' },
  paypal: { letter: 'P', className: 'bg-[#003087] text-white' },
  cashapp: { letter: '$', className: 'bg-[#00D632] text-white' },
  zelle: { letter: 'Z', className: 'bg-[#6D1ED4] text-white' },
};

/** A row per way to pay. Venmo, PayPal.Me and Cash App open with the amount filled in. */
export function PayButtons({ amount, note, settings }) {
  const { toast } = useToast();
  const options = payOptions(settings, amount, note);
  const extra = (settings?.pay_note || '').trim();

  const copy = async (text) => {
    await copyText(text);
    toast({ title: 'Copied', description: text });
  };

  if (!options.length && !extra) return <p className="text-sm font-medium text-zinc-500">Ask your captain how to pay.</p>;

  return (
    <div className="space-y-2">
      {options.map((option) => {
        const brand = BRAND[option.key];
        const icon = (
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display text-base font-black', brand.className)}>
            {brand.letter}
          </span>
        );
        if (!option.href) {
          return (
            <div key={option.key} className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-2.5 pr-3">
              {icon}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">
                  {option.label} {dollars(amount)}
                </span>
                <span className="block truncate text-xs font-medium text-zinc-500">{option.handle}</span>
              </span>
              <button
                type="button"
                onClick={() => copy(option.handle)}
                aria-label={`Copy ${option.label} details`}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-600 transition hover:bg-zinc-200"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          );
        }
        return (
          <a
            key={option.key}
            href={option.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Pay ${dollars(amount)} with ${option.label}`}
            className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-2.5 pr-3 transition hover:border-zinc-900"
          >
            {icon}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{option.label}</span>
              <span className="block truncate text-xs font-medium text-zinc-500">
                {option.prefilled ? option.handle : `Opens PayPal. Enter ${dollars(amount)}.`}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-950 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-lime-400">
              Pay {dollars(amount)}
              <ExternalLink className="h-3 w-3" />
            </span>
          </a>
        );
      })}
      {extra && <p className="px-1 pt-1 text-sm font-medium text-zinc-600">{extra}</p>}
    </div>
  );
}

/**
 * "Mark as not paid?" Clearing a payment takes a second, deliberate tap, and
 * says that the history keeps it.
 */
export function ConfirmNotPaid({ open, onOpenChange, names, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const who = names.join(' and ');
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Mark as not paid?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-600">
          {who} will show as <b>unpaid</b>. The payment stays in the history, so it can be put back.
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 rounded-xl font-bold">
            Keep as paid
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy} className="h-11 rounded-xl font-bold">
            {busy ? 'Saving…' : 'Mark not paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
