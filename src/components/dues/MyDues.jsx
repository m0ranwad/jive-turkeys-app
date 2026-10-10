import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { sessionSlice } from '@/hooks/useDues';
import { CARD } from '@/lib/constants';
import { dollars, feeParts, feeTotal, payNote, teamDues } from '@/lib/dues';
import { today } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmNotPaid, EYEBROW, HEADING, HistoryList, PayButtons, StatusChip, shortDate } from './DuesParts';

/** The signed-in player's share of one session: amount, paid or not, and their partner if they pay together. */
function myShare(data, period, userId) {
  const { row, payments, history } = sessionSlice(data, period);
  if (!row) return { row: null };
  const team = teamDues(Number(row.total_fee) || 0, data.profiles, payments);
  const share = team.shareOf(userId);
  const partner = share ? team.partnerOf(userId) : null;
  const partnerShare = partner ? team.shareOf(partner.user_id) : null;
  const payment = payments.find((p) => p.user_id === userId);
  return {
    row,
    team,
    share,
    partner,
    partnerShare,
    amount: share ? Math.round((share.amount + (partnerShare?.amount ?? 0)) * 100) / 100 : 0,
    paid: !!payment?.paid,
    paidDate: payment?.paid_date ?? null,
    paidBy: payment?.paid_by ?? null,
    history: history.filter((e) => e.user_id === userId),
  };
}

/** Big dark card: what you owe and how the session total adds up. */
function ShareCard({ mine }) {
  const { row, team, share, partner, partnerShare, amount, paid, paidDate } = mine;
  const parts = feeParts(row);
  const refs = parts.ref_fee && parts.game_count ? feeTotal(parts) - parts.league_fee : 0;
  const line = (label, value, strong) => (
    <div className={cn('flex justify-between gap-3', strong ? 'font-bold text-white' : 'text-white/60')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <section className="rounded-3xl bg-zinc-950 p-5 text-white" data-testid="my-dues">
      <div className="flex items-center justify-between gap-3">
        <span className={cn(EYEBROW, 'text-lime-400')}>
          {!share ? 'Not on the roster' : partner ? `You + ${partner.display_name.split(' ')[0]}` : 'Your share'}
        </span>
        {(share || paid) && (
          <StatusChip paid={paid} date={paidDate} className={paid ? 'bg-lime-400 text-black' : 'bg-amber-300 text-black'} />
        )}
      </div>
      {share ? (
        <>
          <p className="mt-2 font-display text-6xl font-extrabold leading-none tracking-tight">{dollars(amount)}</p>
          <p className="mt-2 text-sm font-medium text-white/70">
            {partner
              ? share.amount === partnerShare.amount
                ? `${dollars(share.amount)} each for you and ${partner.display_name}`
                : `${dollars(share.amount)} for you, ${dollars(partnerShare.amount)} for ${partner.display_name}`
              : share.custom
                ? 'A custom amount your captain set for you'
                : `An even share of the ${dollars(feeTotal(parts))} session fee`}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm font-medium text-white/70">
          You're not on the active roster this session, so you don't owe anything.
        </p>
      )}
      <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
        {refs > 0 && line('League fee', dollars(parts.league_fee))}
        {refs > 0 && line(`Refs · ${parts.game_count} games × ${dollars(parts.ref_fee)}`, dollars(refs))}
        {line('Session total', dollars(feeTotal(parts)), true)}
        <p className="pt-1 text-xs text-white/40">
          Split across {team.active.length} active players, rounded up to the next dollar.
        </p>
      </div>
    </section>
  );
}

/** The signed-in player's dues for the chosen session, ways to pay, and their other sessions. */
export function MyDues({ data, period, user, settings, onChanged, onPickSession }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const nameOf = (userId) => data.profiles.find((p) => p.user_id === userId)?.display_name || '';
  const mine = myShare(data, period, user.id);

  const others = [...data.dues]
    .filter((d) => !(d.season_year === Number(period.year) && d.session === Number(period.session)))
    .sort((a, b) => b.season_year - a.season_year || b.session - a.session)
    .map((d) => ({ period: { year: d.season_year, session: d.session }, ...myShare(data, { year: d.season_year, session: d.session }, user.id) }))
    .filter((s) => s.share || s.paid);

  const mark = async (paid) => {
    setBusy(true);
    try {
      await api.dues.markPaid({
        year: period.year,
        session: period.session,
        userIds: [user.id, mine.partner?.user_id].filter(Boolean),
        paid,
        paidDate: today(),
      });
      await onChanged();
      toast({ title: paid ? 'Marked paid. Thanks!' : 'Marked not paid' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const otherSessions = others.length > 0 && (
    <section className={CARD}>
      <h3 className={HEADING}>Other sessions</h3>
      <div className="mt-2 divide-y divide-zinc-100">
        {others.map((s) => (
          <button
            key={`${s.period.year}-${s.period.session}`}
            type="button"
            onClick={() => onPickSession(s.period)}
            className="flex w-full items-center gap-3 py-3 text-left"
          >
            <span className="flex-1 text-sm font-semibold">
              Session {s.period.session} · {s.period.year}
            </span>
            {s.share && <span className="text-sm font-bold tabular-nums">{dollars(s.amount)}</span>}
            <StatusChip paid={s.paid} date={s.paidDate} />
            <ChevronRight className="h-4 w-4 text-zinc-300" />
          </button>
        ))}
      </div>
    </section>
  );

  if (!mine.row) {
    return (
      <div className="space-y-4">
        <section className={cn(CARD, 'py-8 text-center')}>
          <p className="font-display text-lg font-extrabold uppercase tracking-tight">No fee yet</p>
          <p className="mt-1 text-sm text-zinc-500">The fee for this session hasn't been set. It'll show up here.</p>
        </section>
        {otherSessions}
      </div>
    );
  }

  const names = [nameOf(user.id) || 'You', mine.partner?.display_name].filter(Boolean);
  const markedBy =
    mine.paidBy === user.id ? 'you' : mine.paidBy ? nameOf(mine.paidBy).split(' ')[0] || 'a teammate' : null;

  return (
    <div className="space-y-4">
      <ShareCard mine={mine} />

      {mine.share && !mine.paid && mine.amount > 0 && (
        <section className={cn(CARD, 'space-y-4')}>
          <h3 className={HEADING}>Pay</h3>
          <PayButtons amount={mine.amount} note={payNote(period.year, period.session, names)} settings={settings} />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <span className="text-sm font-semibold text-zinc-500">Already paid?</span>
            <Button onClick={() => mark(true)} disabled={busy} className="h-11 rounded-xl bg-lime-400 px-5 font-bold text-black hover:bg-lime-300">
              {mine.partner ? 'Mark us paid' : 'Mark me paid'}
            </Button>
          </div>
        </section>
      )}

      {mine.share && mine.paid && (
        <section className={cn(CARD, 'space-y-3')}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-lime-400">
              <Check className="h-5 w-5" strokeWidth={3} />
            </span>
            <span>
              <span className="block font-display text-base font-extrabold uppercase tracking-tight">
                {mine.partner ? "You're both paid up" : "You're paid up"}
              </span>
              <span className="block text-xs font-semibold text-zinc-500">
                Marked paid {shortDate(mine.paidDate)}
                {markedBy ? ` by ${markedBy}` : ''}. Thanks!
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs font-bold text-zinc-400 underline underline-offset-2 hover:text-zinc-700"
          >
            Not right? Mark as not paid
          </button>
        </section>
      )}

      {/* One entry just repeats the paid card above. */}
      {mine.history.length > 1 && (
        <section className={CARD}>
          <h3 className={cn(HEADING, 'mb-3')}>Your history</h3>
          <HistoryList events={mine.history} nameOf={nameOf} meId={user.id} limit={3} />
        </section>
      )}

      {otherSessions}

      <ConfirmNotPaid open={confirming} onOpenChange={setConfirming} names={names} onConfirm={() => mark(false)} />
    </div>
  );
}

