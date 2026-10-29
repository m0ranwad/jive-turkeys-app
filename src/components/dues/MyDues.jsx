import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { sessionSlice } from '@/hooks/useDues';
import { CARD, EYEBROW } from '@/lib/constants';
import { changeLine, dollars, feeParts, feeTotal, partPayment, payNote, shareChanges, teamDues, topUps } from '@/lib/dues';
import { seasonName, today } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isEarlier } from '@/lib/roster';
import { PayTogetherDialog } from './DuesDialogs';
import { ConfirmNotPaid, HEADING, HistoryList, PartPayment, PayButtons, StatusChip } from './DuesParts';

const round = (value) => Math.round(value * 100) / 100;

/**
 * The signed-in player's share of one session: amount, paid or not (and how
 * much), and their partner if they pay together. `balance` is what each still
 * owes, added together, including any unpaid share; `changed` says
 * what was paid isn't the share, and `short` that it's less. `state` is for
 * the two of you together: 'paid', 'topUp' (paid it all, then the share went
 * up), 'part' (paid part of it, or one of you hasn't paid) or 'unpaid'.
 */
function myShare(data, period, userId) {
  const { row, payments, history, changes, members, linked } = sessionSlice(data, period);
  if (!row) return { row: null };
  // The team as it was that session, so later status changes don't rewrite it.
  const team = teamDues(Number(row.total_fee) || 0, members, payments, data.profiles, { history, changes: [...changes, ...linked] });
  const share = team.shareOf(userId);
  const partner = share ? team.partnerOf(userId) : null;
  const partnerShare = partner ? team.shareOf(partner.user_id) : null;
  const payment = payments.find((p) => p.user_id === userId);
  const paidShares = [share, partnerShare].filter((s) => s?.paid);
  const amount = share ? round(share.amount + (partnerShare?.amount ?? 0)) : 0;
  const paidAmount = share ? round(paidShares.reduce((sum, s) => sum + s.paid_amount, 0)) : (team.notPlayingOf(userId)?.paid_amount ?? null);
  const owing = share ? team.owingTogether(userId).filter((p) => p.due > 0) : [];
  const balance = round(owing.reduce((sum, p) => sum + p.due, 0));
  const hasPayment = paidShares.length > 0;
  const states = share ? [team.stateOf(userId), partner && team.stateOf(partner.user_id)].filter(Boolean) : [];
  const state = !share
    ? null
    : states.every((s) => s === 'paid')
      ? 'paid'
      : states.every((s) => s === 'unpaid')
        ? 'unpaid'
        : states.every((s) => s === 'paid' || s === 'topUp')
          ? 'topUp'
          : 'part';
  return {
    row,
    team,
    share,
    partner,
    partnerShare,
    amount,
    paid: !!payment?.paid,
    hasPayment,
    state,
    // What was paid: for you and your partner, or (not on the roster) what you paid, if it was recorded.
    paidAmount,
    changed: hasPayment && (balance > 0 || paidAmount !== amount),
    short: balance > 0,
    // What you (and your partner) still owe, each, for "Paid part of it?".
    owing,
    balance,
    paidDate: payment?.paid_date ?? null,
    paidBy: payment?.paid_by ?? null,
    history: history.filter((e) => e.user_id === userId),
    // What moved your share since you marked paid, for "Why your share changed".
    why: share?.paid ? shareChanges(changes, history, userId, share.custom) : [],
  };
}

/** Big dark card: what you owe, why it changed (`why`, one line), and how the session total adds up. */
function ShareCard({ mine, why }) {
  const { row, team, share, partner, partnerShare, amount, paid, state, hasPayment, paidDate, paidAmount, changed, short, balance } = mine;
  const statusPaid = share ? state === 'paid' : paid;
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
          <StatusChip
            paid={statusPaid}
            partial={state === 'part'}
            owes={state === 'topUp' ? balance : 0}
            date={statusPaid ? paidDate : null}
            className={statusPaid ? 'bg-lime-400 text-black' : 'bg-amber-300 text-black'}
          />
        )}
      </div>
      {share ? (
        <>
          <p className="mt-2 font-display text-6xl font-extrabold leading-none tracking-tight">{dollars(balance > 0 ? balance : amount)}</p>
          {balance > 0 && <p className="mt-1 text-sm font-bold text-white">{state === 'topUp' ? 'more to pay' : 'left to pay'}</p>}
          {hasPayment && changed && (
            <p className="mt-2 text-sm font-semibold text-amber-300" data-testid="share-changed">
              {state === 'topUp'
                ? `You paid ${dollars(paidAmount)}${partner ? ' together' : ''}. Your share went up to ${dollars(amount)}.`
                : short
                  ? `${dollars(paidAmount)} paid of ${dollars(amount)}.`
                  : `You paid ${dollars(paidAmount)} before your share went down.`}
            </p>
          )}
          {why && (
            <p className="mt-1 text-xs font-medium text-white/70" data-testid="share-why">
              {why}
            </p>
          )}
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
          {paid && (paidAmount != null ? ` You paid ${dollars(paidAmount)} for it` : ' You were marked paid for it')}
          {paid && ', and your captains can see that on Team dues.'}
        </p>
      )}
      <details className="mt-4 border-t border-white/10 pt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-white/80">Fee breakdown</summary>
        <div className="mt-3 space-y-1.5">
          {refs > 0 && line('League fee', dollars(parts.league_fee))}
          {refs > 0 && line(`Refs · ${parts.game_count} games × ${dollars(parts.ref_fee)}`, dollars(refs))}
          {line('Session total', dollars(feeTotal(parts)), true)}
          <p className="pt-1 text-xs text-white/50">
            Split across the {team.active.length} teammates playing, rounded up to the next dollar.
          </p>
        </div>
      </details>
    </section>
  );
}

/** How the whole team is doing, so everyone sees it, with a way to the full list. */
function TeamProgress({ team, onShowTeam }) {
  const pct = team.active.length ? (team.paidCount / team.active.length) * 100 : 0;
  return (
    <section className={CARD} data-testid="team-progress">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={HEADING}>
          Team · {team.paidCount} of {team.active.length} paid
        </h3>
        <span className="text-xs font-semibold text-zinc-500">
          {dollars(team.collected)} in · {dollars(team.stillOwed)} to go
        </span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
        <div className="h-full rounded-full bg-lime-400" style={{ width: `${pct}%` }} />
      </div>
      {team.topUpCount > 0 && <p className="mt-2 text-xs font-medium text-zinc-600">{topUps(team.topUpCount)}</p>}
      <button
        type="button"
        onClick={onShowTeam}
        className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-zinc-600 underline-offset-2 hover:underline"
      >
        See who has and hasn't paid
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}

/** The signed-in player's dues for the chosen session, ways to pay, and their other sessions. */
export function MyDues({ data, period, current, over = false, user, settings, onChanged, onPickSession, onShowTeam }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);

  const nameOf = (userId) => data.profiles.find((p) => p.user_id === userId)?.display_name || '';
  const mine = myShare(data, period, user.id);
  const me = data.profiles.find((p) => p.user_id === user.id);
  const partnerNow = data.profiles.find((p) => p.user_id === me?.pays_with);
  const pairingPlayers = over ? data.profiles : sessionSlice(data, current).members;
  const canPair = !isEarlier(period, current) && pairingPlayers.some((p) => p.user_id === user.id && p.status === 'active' && !p.removed);
  const pairing = canPair && (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500" data-testid="pay-together">
      {partnerNow && <span className="font-medium">{over ? 'Next session: ' : ''}With {partnerNow.display_name}</span>}
      <Button
        variant="ghost"
        onClick={() => setPairingOpen(true)}
        aria-label={partnerNow ? 'Change who you pay with' : 'Pay together'}
        className="h-11 rounded-xl px-2 text-xs font-semibold text-zinc-600 underline underline-offset-4"
      >
        {partnerNow ? 'Change' : 'Pay together'}
      </Button>
      {over && !partnerNow && <span>From next session</span>}
      <PayTogetherDialog
        open={pairingOpen}
        onOpenChange={setPairingOpen}
        player={me}
        profiles={data.profiles}
        options={pairingPlayers.filter((p) => p.status === 'active' && !p.removed)}
        from={current}
        between={over}
        onChanged={onChanged}
      />
    </div>
  );

  const others = [...data.dues]
    .filter((d) => !(d.season_year === Number(period.year) && d.session === Number(period.session)))
    .sort((a, b) => b.season_year - a.season_year || b.session - a.session)
    .map((d) => ({ period: { year: d.season_year, session: d.session }, ...myShare(data, { year: d.season_year, session: d.session }, user.id) }))
    .filter((s) => s.share || s.paid);

  const mark = async (paid) => {
    // Settle only what's still owed: a partner's earlier payment stays as it was.
    const { userIds, amounts } = paid
      ? partPayment(mine.team, user.id, mine.balance)
      : { userIds: [user.id, mine.partner?.user_id].filter(Boolean) };
    setBusy(true);
    try {
      await api.dues.markPaid({
        year: period.year,
        session: period.session,
        userIds,
        paid,
        paidDate: today(),
        amounts,
      });
      await onChanged();
      toast({ title: paid ? 'Marked paid. Thanks!' : 'Marked not paid' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  // Part of what you (and your partner) owe: anyone can record it, for themselves too.
  const payPart = async (amount) => {
    const { userIds, amounts } = partPayment(mine.team, user.id, amount);
    setBusy(true);
    try {
      await api.dues.markPaid({ year: period.year, session: period.session, userIds, paid: true, paidDate: today(), amounts });
      await onChanged();
      toast({ title: `${dollars(amount)} marked paid. Thanks!` });
      return true;
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const partPaymentLink = mine.balance > 0 && (
    <PartPayment max={mine.balance} both={mine.owing.length > 1} busy={busy} onSave={payPart} />
  );
  // A top-up shows the share, with what's owed on the chip.
  const otherAmount = (s) =>
    s.state === 'topUp' ? s.amount : s.balance > 0 ? s.balance : s.paid ? s.paidAmount : s.share ? s.amount : null;

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
              Session {s.period.session} · {seasonName(s.period.year)}
            </span>
            {otherAmount(s) != null && (
              <span className="text-sm font-bold tabular-nums">{dollars(otherAmount(s))}</span>
            )}
            <StatusChip
              paid={s.share ? s.state === 'paid' : s.paid}
              partial={s.state === 'part'}
              owes={s.state === 'topUp' ? s.balance : 0}
              date={s.balance === 0 ? s.paidDate : null}
            />
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
        {pairing}
        {otherSessions}
      </div>
    );
  }

  const names = [nameOf(user.id) || 'You', mine.partner?.display_name].filter(Boolean);
  // The latest change that moved your share since you paid, on the card; the rest are under Payment details.
  const showWhy = mine.paid && mine.changed && mine.why.length > 0;
  const why =
    showWhy &&
    `Why: ${changeLine(mine.why[0], nameOf, user.id)}${mine.why.length > 1 ? ` · and ${mine.why.length - 1} more in Payment details` : ''}`;
  const markedBy =
    mine.paidBy === user.id ? 'you' : mine.paidBy ? nameOf(mine.paidBy).split(' ')[0] || 'a teammate' : null;

  return (
    <div className="space-y-4">
      <ShareCard mine={mine} why={why} />

      {mine.share && !mine.hasPayment && mine.balance > 0 && (
        <section className={cn(CARD, 'space-y-4')}>
          <h3 className={HEADING}>Pay</h3>
          <PayButtons amount={mine.balance} note={payNote(period.year, period.session, names)} settings={settings} />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <span className="text-sm font-semibold text-zinc-500">Already paid?</span>
            <Button onClick={() => mark(true)} disabled={busy} className="h-11 rounded-xl bg-lime-400 px-5 font-bold text-black hover:bg-lime-300">
              {mine.partner ? 'Mark us paid' : 'Mark me paid'}
            </Button>
          </div>
          {partPaymentLink}
        </section>
      )}

      {mine.share && mine.hasPayment && mine.balance > 0 && (
        <section className={cn(CARD, 'space-y-4')} data-testid="pay-difference">
          <h3 className={HEADING}>Pay the rest</h3>
          <PayButtons amount={mine.balance} note={payNote(period.year, period.session, names)} settings={settings} />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <span className="text-sm font-semibold text-zinc-500">Already paid it?</span>
            <Button onClick={() => mark(true)} disabled={busy} className="h-11 rounded-xl bg-lime-400 px-5 font-bold text-black hover:bg-lime-300">
              Mark {dollars(mine.balance)} paid
            </Button>
          </div>
          <div>{partPaymentLink}</div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs font-bold text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
          >
            Not right? Mark as not paid
          </button>
        </section>
      )}

      {mine.share && mine.hasPayment && mine.balance === 0 && (
        <section className={cn(CARD, 'space-y-3')}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-lime-400">
              <Check className="h-5 w-5" strokeWidth={3} />
            </span>
            <span>
              <span className="block font-display text-base font-extrabold uppercase tracking-tight">
                {mine.partner ? "You're both paid up" : "You're paid up"}
              </span>
              {/* The date is on the share card's chip. */}
              {markedBy && <span className="block text-xs font-semibold text-zinc-500">Marked by {markedBy}</span>}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs font-bold text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
          >
            Not right? Mark as not paid
          </button>
        </section>
      )}

      {pairing}

      <TeamProgress team={mine.team} onShowTeam={onShowTeam} />

      {/* One entry just repeats the paid card above. */}
      {(mine.history.length > 1 || showWhy) && (
        <section className={CARD}>
          <details>
            <summary className={cn(HEADING, 'cursor-pointer')}>Payment details</summary>
            {showWhy && (
              <div className="mt-4" data-testid="why-share-changed">
                <h3 className={cn(HEADING, 'mb-3')}>Why your share changed</h3>
                <HistoryList events={mine.why} nameOf={nameOf} meId={user.id} limit={3} />
              </div>
            )}
            {mine.history.length > 1 && (
              <div className="mt-4">
                <h3 className={cn(HEADING, 'mb-3')}>Your history</h3>
                <HistoryList events={mine.history} nameOf={nameOf} meId={user.id} limit={3} />
              </div>
            )}
          </details>
        </section>
      )}

      {otherSessions}

      <ConfirmNotPaid open={confirming} onOpenChange={setConfirming} names={names} onConfirm={() => mark(false)} />
    </div>
  );
}

