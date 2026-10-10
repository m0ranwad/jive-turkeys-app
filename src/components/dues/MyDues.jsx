import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Check, Copy } from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { dollars, feeParts, feeTotal, payNote, payOptions, teamDues } from '@/lib/dues';
import { seasonLabel, shortName, today } from '@/lib/format';
import { cn } from '@/lib/utils';

const paidOn = (date) => (date ? dayjs(date).format('MMM D') : '');

export function StatusPill({ paid, date }) {
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
  const refs = parts.ref_fee && parts.game_count ? feeTotal(parts) - parts.league_fee : 0;
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

function PayButtons({ amount, note, settings }) {
  const { toast } = useToast();
  const options = payOptions(settings, amount, note);
  const extra = (settings?.pay_note || '').trim();

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
              Pay {dollars(amount)} with {option.label}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-lime-400">to {option.handle}</span>
          </a>
        ) : (
          <div key={option.key} className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
                {option.label} {dollars(amount)} to
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
      {extra && <p className="text-sm font-medium text-zinc-600">{extra}</p>}
      {!options.length && !extra && <p className="text-sm font-medium text-zinc-600">Ask your captain how to pay.</p>}
    </div>
  );
}

/** The signed-in player's dues for every session with a fee set, newest first. */
function myRows(user, allDues, payments, profiles) {
  return [...allDues]
    .sort((a, b) => b.season_year - a.season_year || b.session - a.session)
    .map((row) => {
      const sessionPayments = payments.filter((p) => p.season_year === row.season_year && p.session === row.session);
      const team = teamDues(Number(row.total_fee) || 0, profiles, sessionPayments);
      const share = team.shareOf(user.id);
      const partner = share ? team.partnerOf(user.id) : null;
      const payment = sessionPayments.find((p) => p.user_id === user.id);
      return {
        row,
        team,
        share,
        partner,
        partnerShare: partner ? team.shareOf(partner.user_id) : null,
        paid: !!payment?.paid,
        paidDate: payment?.paid_date ?? null,
        paidBy: payment?.paid_by ?? null,
      };
    });
}

/** What the signed-in player owes, how it's worked out, ways to pay, and a button to mark it paid. */
export function MyDues({ user, settings }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [allDues, payments, profiles] = await Promise.all([
        api.entities.SessionDues.list(),
        api.entities.DuesPayment.list(),
        api.entities.PlayerProfile.list(),
      ]);
      setData({ allDues, payments, profiles });
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) {
    return (
      <section className={cn(CARD, 'text-center')}>
        <p className="text-sm font-medium text-zinc-500">Your dues didn't load. Try again in a minute.</p>
      </section>
    );
  }
  if (!data || !user) return <PageSpinner />;

  const [current, ...older] = myRows(user, data.allDues, data.payments, data.profiles);
  if (!current) {
    return (
      <section className={cn(CARD, 'text-center')}>
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">Nothing to pay yet</p>
        <p className="mt-2 text-sm text-zinc-500">Your captain hasn't set this session's dues. They'll show up here.</p>
      </section>
    );
  }
  const earlier = older.filter((r) => r.share || r.paid);

  const { row, team, share, partner, partnerShare } = current;
  const amount = share ? share.amount + (partnerShare?.amount ?? 0) : 0;
  const names = [data.profiles.find((p) => p.user_id === user.id)?.display_name, partner?.display_name].filter(Boolean);
  const whoMarked =
    current.paidBy === user.id
      ? 'you'
      : shortName(data.profiles.find((p) => p.user_id === current.paidBy)?.display_name || '');

  const mark = async (paid) => {
    setBusy(true);
    try {
      await api.dues.markPaid({
        year: row.season_year,
        session: row.session,
        userIds: [user.id, partner?.user_id].filter(Boolean),
        paid,
        paidDate: today(),
      });
      await load();
      toast({ title: paid ? 'Marked paid. Thanks!' : 'Marked unpaid' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className={cn(CARD, 'space-y-4')} data-testid="my-dues">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
              {seasonLabel(row.season_year, row.session)}
            </p>
            {share ? (
              <>
                <p className="mt-1.5 font-display text-5xl font-extrabold leading-none">{dollars(amount)}</p>
                <p className="mt-1.5 text-xs font-semibold text-zinc-500">
                  {partner
                    ? share.amount === partnerShare.amount
                      ? `For you and ${partner.display_name} (${dollars(share.amount)} each)`
                      : `For you (${dollars(share.amount)}) and ${partner.display_name} (${dollars(partnerShare.amount)})`
                    : 'Your share'}
                </p>
              </>
            ) : (
              <p className="mt-1.5 font-display text-2xl font-extrabold uppercase leading-tight">Nothing owed</p>
            )}
          </div>
          {(share || current.paid) && <StatusPill paid={current.paid} date={current.paidDate} />}
        </div>

        <FeeBreakdown row={row} />
        <p className="text-xs font-semibold text-zinc-500">
          {!share
            ? "You're not on the active roster this session, so you don't owe anything."
            : share.custom
              ? 'Your captain set a custom amount for you.'
              : `Split evenly across ${team.active.length} active players, rounded up to the next dollar.`}
        </p>

        {share && current.paid && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 rounded-2xl bg-lime-400 px-4 py-3 text-sm font-bold text-black">
              <Check className="h-4 w-4" strokeWidth={3} />
              {partner ? "You're both paid up. Thanks!" : "You're all paid up. Thanks!"}
            </p>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-zinc-500">
              <span>
                Marked paid{current.paidDate ? ` ${paidOn(current.paidDate)}` : ''}
                {current.paidBy ? ` by ${whoMarked}` : ''}.
              </span>
              <button onClick={() => mark(false)} disabled={busy} className="font-bold text-zinc-700 underline underline-offset-2">
                Not paid yet? Undo
              </button>
            </p>
          </div>
        )}
        {share && !current.paid && amount > 0 && (
          <>
            <PayButtons amount={amount} note={payNote(row.season_year, row.session, names)} settings={settings} />
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
              <span className="text-sm font-semibold text-zinc-600">Paid already?</span>
              <Button onClick={() => mark(true)} disabled={busy} className="h-10 rounded-xl font-bold">
                {partner ? 'Mark us paid' : 'Mark me paid'}
              </Button>
            </div>
          </>
        )}
      </section>

      {earlier.length > 0 && (
        <section className={CARD}>
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Earlier sessions</h3>
          <div className="mt-2 divide-y divide-zinc-100">
            {earlier.map((r) => (
              <div key={`${r.row.season_year}-${r.row.session}`} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-sm font-semibold">{seasonLabel(r.row.season_year, r.row.session)}</span>
                {r.share && <span className="text-sm font-bold">{dollars(r.share.amount)}</span>}
                <StatusPill paid={r.paid} date={r.paidDate} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
