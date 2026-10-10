import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Check, Copy } from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { dollars, feeParts, feeTotal, payNote, payOptions } from '@/lib/dues';
import { seasonLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

const paidOn = (date) => (date ? dayjs(date).format('MMM D') : '');

function StatusPill({ paid, date }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em]',
        paid ? 'bg-lime-400 text-black' : 'bg-amber-300 text-black',
      )}
    >
      {paid ? `Paid${date ? ` · ${paidOn(date)}` : ''}` : 'Unpaid'}
    </span>
  );
}

/** League fee, refs and the session total, as the league bills it. */
function FeeBreakdown({ row }) {
  const parts = feeParts(row);
  const refs = parts.ref_fee && parts.game_count ? parts.ref_fee * parts.game_count : 0;
  const line = (label, value, strong) => (
    <div className={cn('flex justify-between gap-3 py-1.5 text-sm', strong ? 'font-bold' : 'font-medium text-zinc-600')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="divide-y divide-zinc-100 rounded-2xl bg-zinc-50 px-3.5 py-1">
      {refs > 0 && line('League fee', dollars(parts.league_fee))}
      {refs > 0 && line(`Refs (${parts.game_count} games × ${dollars(parts.ref_fee)})`, dollars(refs))}
      {line('Session total', dollars(feeTotal(parts)), true)}
    </div>
  );
}

function PayButtons({ row, settings }) {
  const { toast } = useToast();
  const options = payOptions(settings, row.amount, payNote(row.season_year, row.session));
  const note = (settings?.pay_note || '').trim();

  const copy = async (text) => {
    await copyText(text);
    toast({ title: 'Copied', description: text });
  };

  return (
    <div className="space-y-2.5">
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">How to pay</h3>
      {options.map((option) =>
        option.href ? (
          <a
            key={option.key}
            href={option.href}
            target="_blank"
            rel="noreferrer"
            className="block rounded-2xl bg-zinc-950 px-4 py-3 text-white transition hover:bg-zinc-800"
          >
            <span className="block font-display text-sm font-extrabold uppercase tracking-[0.08em]">
              Pay {dollars(row.amount)} with {option.label}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-lime-400">to {option.handle}</span>
          </a>
        ) : (
          <div key={option.key} className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
                {option.label} {dollars(row.amount)} to
              </span>
              <span className="block truncate text-sm font-bold">{option.handle}</span>
            </span>
            <button
              onClick={() => copy(option.handle)}
              aria-label={`Copy ${option.label} details`}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-600 transition hover:bg-zinc-200"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
        ),
      )}
      {note && <p className="text-sm font-medium text-zinc-600">{note}</p>}
      {!options.length && !note && <p className="text-sm font-medium text-zinc-600">Ask your captain how to pay.</p>}
      <p className="text-xs font-semibold text-zinc-400">Your captain marks you paid once the money arrives.</p>
    </div>
  );
}

/** What the signed-in player owes: their share of the latest session's fee, how it's worked out, and ways to pay. */
export function MyDues({ settings }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.dues
      .mine()
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <section className={cn(CARD, 'text-center')}>
        <p className="text-sm font-medium text-zinc-500">Your dues didn't load. Try again in a minute.</p>
      </section>
    );
  }
  if (!rows) return <PageSpinner />;

  const [current, ...older] = rows;
  if (!current) {
    return (
      <section className={cn(CARD, 'text-center')}>
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">Nothing to pay yet</p>
        <p className="mt-2 text-sm text-zinc-500">Your captain hasn't set this session's dues. They'll show up here.</p>
      </section>
    );
  }
  const earlier = older.filter((r) => r.is_active || r.paid);

  return (
    <div className="space-y-5">
      <section className={cn(CARD, 'space-y-4')} data-testid="my-dues">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
              {seasonLabel(current.season_year, current.session)}
            </p>
            {current.is_active ? (
              <>
                <p className="mt-1.5 font-display text-5xl font-extrabold leading-none">{dollars(current.amount)}</p>
                <p className="mt-1.5 text-xs font-semibold text-zinc-500">Your share</p>
              </>
            ) : (
              <p className="mt-1.5 font-display text-2xl font-extrabold uppercase leading-tight">Nothing owed</p>
            )}
          </div>
          {(current.is_active || current.paid) && <StatusPill paid={current.paid} date={current.paid_date} />}
        </div>

        <FeeBreakdown row={current} />
        <p className="text-xs font-semibold text-zinc-500">
          {!current.is_active
            ? "You're not on the active roster this session, so you don't owe anything."
            : current.custom
              ? 'Your captain set a custom amount for you.'
              : `Split evenly across ${current.active_players} active players, rounded up to the next dollar.`}
        </p>

        {current.is_active && current.paid && (
          <p className="flex items-center gap-2 rounded-2xl bg-lime-400 px-4 py-3 text-sm font-bold text-black">
            <Check className="h-4 w-4" strokeWidth={3} />
            You're all paid up. Thanks!
          </p>
        )}
        {current.is_active && !current.paid && current.amount > 0 && <PayButtons row={current} settings={settings} />}
      </section>

      {earlier.length > 0 && (
        <section className={CARD}>
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Earlier sessions</h3>
          <div className="mt-2 divide-y divide-zinc-100">
            {earlier.map((r) => (
              <div key={`${r.season_year}-${r.session}`} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-sm font-semibold">{seasonLabel(r.season_year, r.session)}</span>
                {r.amount != null && <span className="text-sm font-bold">{dollars(r.amount)}</span>}
                <StatusPill paid={r.paid} date={r.paid_date} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
