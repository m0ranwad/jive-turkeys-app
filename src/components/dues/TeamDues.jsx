import { useState } from 'react';
import { Copy, Pencil, UserPlus } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { sessionSlice } from '@/hooks/useDues';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { DUES_DEFAULTS, cleanPayHandle, dollars, duesEvents, feeParts, feeTotal, notPlayingLabel, reminderText, stepSession, teamDues, topUps } from '@/lib/dues';
import { shortName, today } from '@/lib/format';
import { isEarlier } from '@/lib/roster';
import { cn } from '@/lib/utils';
import { FeeDialog, PaySettingsDialog, PlayerSheet } from './DuesDialogs';
import { SessionRosterDialog } from './SessionRosterDialog';
import { Avatar, EYEBROW, HEADING, HistoryList, StatusChip, feeLine } from './DuesParts';

const DARK_BUTTON =
  'inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/20 disabled:opacity-40';

/** Dark summary card: how many have paid, money in and still to come, the fee. */
function Summary({ row, team, total, isCaptain, onCopyReminder, onEditFee }) {
  const pct = team.active.length ? (team.paidCount / team.active.length) * 100 : 0;
  return (
    <section className="rounded-3xl bg-zinc-950 p-5 text-white">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight">
          {team.paidCount} of {team.active.length} paid
        </h2>
        <span className="text-sm font-bold text-lime-400">{dollars(team.perPlayer)} each</span>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Players paid"
        aria-valuemin={0}
        aria-valuemax={team.active.length}
        aria-valuenow={team.paidCount}
      >
        <div className="h-full rounded-full bg-lime-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {team.topUpCount > 0 && <p className="mt-2 text-xs font-semibold text-amber-300">{topUps(team.topUpCount)}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="font-display text-2xl font-extrabold leading-none text-lime-400">{dollars(team.collected)}</div>
          <div className={cn(EYEBROW, 'mt-1 text-white/50')}>Collected</div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-extrabold leading-none">{dollars(team.stillOwed)}</div>
          <div className={cn(EYEBROW, 'mt-1 text-white/50')}>Still to collect</div>
        </div>
      </div>
      <p className="mt-4 border-t border-white/10 pt-3 text-xs font-medium text-white/50">
        {feeLine(row)}
        {team.extra > 0 && `. Rounding up adds ${dollars(team.extra)}.`}
        {team.extra < 0 && `. Custom amounts leave ${dollars(-team.extra)} of the ${dollars(total)} uncovered.`}
        {team.notPlayingPaid > 0 &&
          `${team.extra ? ' ' : '. '}Collected includes ${dollars(team.notPlayingPaid)} from players not playing.`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {team.stillToPay.length > 0 && (
          <button type="button" onClick={onCopyReminder} className={DARK_BUTTON}>
            <Copy className="h-3.5 w-3.5" />
            Copy reminder
          </button>
        )}
        {isCaptain && (
          <button type="button" onClick={onEditFee} className={DARK_BUTTON}>
            <Pencil className="h-3.5 w-3.5" />
            Edit fee
          </button>
        )}
      </div>
    </section>
  );
}

/** The whole team's dues for one session. Anyone can mark players paid; captains also set the fee and amounts. */
export function TeamDues({ data, period, current, over = false, user, isCaptain, settings, onChanged, onSettingsSaved }) {
  const { toast } = useToast();
  const [sheetFor, setSheetFor] = useState(null);
  const [feeOpen, setFeeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rosterOpen, setRosterOpen] = useState(false);

  // The team as it was that session, so later status changes don't rewrite it.
  const { row, payments, history, changes, members, started, linked } = sessionSlice(data, period);
  // Paid / not paid, and what moved the split (the fee, custom amounts, the roster), newest first.
  const events = duesEvents(history, changes);
  const total = row ? Number(row.total_fee) || 0 : 0;
  const team = teamDues(total, members, payments, data.profiles, { history, changes: [...changes, ...linked] });
  // Over: an earlier session, or the current one once its games are all played and nothing else is on the
  // schedule (`over`). Status changes don't reach them, so captains correct them here.
  const past = !!current && (isEarlier(period, current) || (over && !isEarlier(current, period)));
  // A later session hasn't started. It has a list already only if captains asked who's playing it ahead.
  const notStarted = !!current && isEarlier(current, period);
  const askedAhead = notStarted && started;
  // Between sessions: this is the session that just ended, and couples linked now count from the next one.
  const between = past && !isEarlier(period, current);
  // The session a couple linked now counts from: the one being played, else the next one.
  const couplesFrom = !current ? period : over ? stepSession(current, 1) : current;
  // Paid includes anyone who owes only a top-up after their share went up; part payments are still to pay.
  const unpaid = team.active.filter((p) => ['unpaid', 'part'].includes(team.stateOf(p.user_id)));
  const paid = team.active.filter((p) => ['paid', 'topUp'].includes(team.stateOf(p.user_id)));
  const nameOf = (userId) => data.profiles.find((p) => p.user_id === userId)?.display_name || '';

  // A new session's fee starts from the last one saved, so there's usually nothing to type.
  const latest = [...data.dues].sort((a, b) => b.season_year - a.season_year || b.session - a.session)[0];
  const feeStart = row ? feeParts(row) : latest ? feeParts(latest) : DUES_DEFAULTS;
  // What a new fee is checked against ("more than double…"): this session's fee, or the last one set.
  const previousFee = row ? { total: Number(row.total_fee) || 0, now: true } : latest ? { total: Number(latest.total_fee) || 0, now: false } : null;

  const saveFee = async (parts) => {
    const fields = { ...parts, total_fee: feeTotal(parts) };
    try {
      if (row) await api.entities.SessionDues.update(row.id, fields);
      else await api.entities.SessionDues.create({ season_year: Number(period.year), session: Number(period.session), ...fields });
      await onChanged();
      toast({ title: 'Session fee saved', description: 'Everyone sees their share on My dues.' });
    } catch (err) {
      toast({ title: "The fee didn't save", description: err.message });
      throw err;
    }
  };

  // Marks a player (and their partner) paid for their share right now; for someone already paid, that's the difference.
  const markPaid = async (player) => {
    const partner = team.partnerOf(player.user_id);
    const ids = [player.user_id, partner?.user_id].filter(Boolean);
    // Everyone in it already paid: this pays the difference after their share went up.
    const balance = ids.every((id) => team.shareOf(id).paid) ? team.balanceOf(player.user_id) : 0;
    const names = [player.display_name, partner?.display_name].filter(Boolean).join(' & ');
    setBusyId(player.user_id);
    try {
      await api.dues.markPaid({
        year: period.year,
        session: period.session,
        userIds: ids,
        paid: true,
        paidDate: today(),
        amounts: ids.map((id) => team.shareOf(id).amount),
      });
      await onChanged();
      toast({ title: balance ? `${names}: ${dollars(balance)} more marked paid` : `${names} marked paid` });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const copyReminder = async () => {
    await copyText(
      reminderText({
        session: period.session,
        parts: feeParts(row),
        perPlayer: team.perPlayer,
        activeCount: team.active.length,
        unpaid: team.stillToPay,
        link: `${window.location.origin}/dues`,
      }),
    );
    toast({ title: 'Reminder copied', description: 'Paste it into the team chat or group text.' });
  };

  const markedBy = (userId) => {
    const payment = payments.find((x) => x.user_id === userId);
    return payment?.paid && payment.paid_by && payment.paid_by !== userId ? `marked by ${shortName(nameOf(payment.paid_by))}` : null;
  };

  const playerRow = (p) => {
    const share = team.shareOf(p.user_id);
    const partner = team.partnerOf(p.user_id);
    // Paid players show what they paid, and their share when that's different: part of it (or paid
    // before it went up), or more than it is now.
    const changed = share.paid && share.paid_amount !== share.amount;
    const shareNote = share.paid_amount < share.amount ? `share is ${dollars(share.amount)}` : `share is now ${dollars(share.amount)}`;
    const balance = team.owingTogether(p.user_id).reduce((sum, x) => sum + x.due, 0);
    const partPaid = team.stateOf(p.user_id) === 'part';
    const topUp = team.stateOf(p.user_id) === 'topUp';
    const details = [
      p.guest && 'not joined yet',
      partner && `with ${shortName(partner.display_name)}`,
      share.custom && 'custom amount',
      partPaid
        ? `${dollars(share.paid_amount)} paid of ${dollars(share.amount)}`
        : topUp
          ? 'share went up'
          : changed && shareNote,
      share.paid && markedBy(p.user_id),
    ].filter(Boolean);
    return (
      <li key={p.user_id} className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => setSheetFor(p.user_id)}
          className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-zinc-50"
        >
          {/* Heard as "Details for" and the name and notes on screen. */}
          <span className="sr-only">Details for </span>
          <Avatar name={p.display_name} className={cn(p.guest && 'border border-dashed border-zinc-300 bg-white')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{p.display_name}</span>
            {details.length > 0 && <span className="block truncate text-[11px] font-medium text-zinc-500">{details.join(' · ')}</span>}
          </span>
        </button>
        <span className="text-sm font-bold tabular-nums text-zinc-700" aria-label={`Amount for ${p.display_name}`}>
          {dollars(partPaid ? share.shortBy : share.paid ? share.paid_amount : share.amount)}
          {partPaid && <span className="block text-right text-[11px] font-medium text-zinc-500">left</span>}
        </span>
        {balance > 0 && (!share.paid || share.shortBy > 0) && (share.paid || (partner && team.shareOf(partner.user_id).paid)) ? (
          <button
            type="button"
            onClick={() => markPaid(p)}
            disabled={busyId === p.user_id}
            aria-label={`Mark ${dollars(balance)} paid for ${p.display_name}`}
            className="h-8 min-w-[78px] shrink-0 whitespace-nowrap rounded-full bg-lime-400 px-3 text-[11px] font-black uppercase tracking-[0.08em] text-black transition hover:bg-lime-300 disabled:opacity-50"
          >
            Mark {dollars(balance)} paid
          </button>
        ) : share.paid ? (
          <StatusChip paid date={share.paid_date} dateOnly className="h-8 w-[78px] justify-center" />
        ) : (
          <button
            type="button"
            onClick={() => markPaid(p)}
            disabled={busyId === p.user_id}
            aria-label={`Mark paid for ${p.display_name}`}
            className="h-8 w-[78px] shrink-0 rounded-full bg-lime-400 text-[11px] font-black uppercase tracking-[0.08em] text-black transition hover:bg-lime-300 disabled:opacity-50"
          >
            Mark paid
          </button>
        )}
      </li>
    );
  };

  // Paid for the session but not on its active roster: what they paid, and why they're not on it.
  const notPlayingRow = (entry) => {
    const p = entry.player;
    const details = [
      p.guest && 'not joined yet',
      notPlayingLabel(entry),
      entry.paid_amount == null && 'amount not recorded',
      markedBy(p.user_id),
    ].filter(Boolean);
    return (
      <li key={p.user_id} className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => setSheetFor(p.user_id)}
          className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-zinc-50"
        >
          <span className="sr-only">Details for </span>
          <Avatar name={p.display_name} className={cn(p.guest && 'border border-dashed border-zinc-300 bg-white')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{p.display_name}</span>
            <span className="block truncate text-[11px] font-medium text-zinc-500">{details.join(' · ')}</span>
          </span>
        </button>
        {entry.paid_amount != null && (
          <span className="text-sm font-bold tabular-nums text-zinc-700" aria-label={`Amount for ${p.display_name}`}>
            {dollars(entry.paid_amount)}
          </span>
        )}
        <StatusChip paid date={entry.paid_date} dateOnly className="h-8 w-[78px] justify-center" />
      </li>
    );
  };

  const payLinks = [
    cleanPayHandle('venmo', settings?.pay_venmo) && `Venmo @${cleanPayHandle('venmo', settings.pay_venmo)}`,
    settings?.pay_paypal && 'PayPal',
    settings?.pay_cashapp && `Cash App $${cleanPayHandle('cashapp', settings.pay_cashapp)}`,
    settings?.pay_zelle && 'Zelle',
  ].filter(Boolean);

  const paymentLinksCard = isCaptain && (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={HEADING}>Payment links</h3>
        <Button variant="outline" size="sm" onClick={() => setPayOpen(true)} className="rounded-full font-bold">
          Edit
        </Button>
      </div>
      <p className="mt-2 text-sm text-zinc-500">
        {payLinks.length ? payLinks.join(' · ') : 'Add your Venmo or PayPal so players get a pay button.'}
      </p>
    </section>
  );

  const dialogs = (
    <>
      {isCaptain && <FeeDialog open={feeOpen} onOpenChange={setFeeOpen} period={period} initial={feeStart} previous={previousFee} onSave={saveFee} />}
      {isCaptain && <PaySettingsDialog open={payOpen} onOpenChange={setPayOpen} settings={settings} onSaved={onSettingsSaved} />}
      <PlayerSheet
        open={!!sheetFor}
        onOpenChange={(open) => !open && setSheetFor(null)}
        player={data.profiles.find((p) => p.user_id === sheetFor) || null}
        team={team}
        payments={payments}
        history={events}
        profiles={data.profiles}
        period={period}
        past={past}
        started={started}
        between={between}
        from={couplesFrom}
        meId={user.id}
        isCaptain={isCaptain}
        onChanged={onChanged}
      />
      {isCaptain && started && past && (
        <SessionRosterDialog
          open={rosterOpen}
          onOpenChange={setRosterOpen}
          period={period}
          members={data.profiles}
          rows={data.roster}
          meId={user.id}
          onSaved={onChanged}
        />
      )}
    </>
  );

  const startsLater = notStarted && (
    <p className="mb-3 rounded-2xl bg-zinc-50 px-3.5 py-2.5 text-xs font-medium text-zinc-500" data-testid="dues-not-started">
      Session {period.session} hasn't started, so this uses today's roster.{' '}
      {askedAhead
        ? `Answers so far to "Playing session ${period.session}?" count too.`
        : "When it starts, everyone's status is kept for it and players can say if they're playing."}
    </p>
  );

  if (!row) {
    return (
      <div className="space-y-4">
        <section className={cn(CARD, 'py-8 text-center')}>
          <p className="font-display text-lg font-extrabold uppercase tracking-tight">No fee yet</p>
          {isCaptain ? (
            <>
              <p className="mt-1 text-sm text-zinc-500">
                Set this session's fee and everyone sees their share. Last fee: {feeLine(feeStart)}.
              </p>
              <Button onClick={() => setFeeOpen(true)} className="mt-4 h-11 rounded-xl bg-lime-400 px-6 font-bold text-black hover:bg-lime-300">
                Set the fee
              </Button>
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">The fee for this session hasn't been set yet.</p>
          )}
        </section>
        {paymentLinksCard}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Summary
        row={row}
        team={team}
        total={total}
        isCaptain={isCaptain}
        onCopyReminder={copyReminder}
        onEditFee={() => setFeeOpen(true)}
      />

      <section className={CARD}>
        {startsLater}
        {unpaid.length > 0 && (
          <div data-testid="dues-unpaid">
            <h3 className={cn(EYEBROW, 'text-zinc-500')}>Still to pay · {unpaid.length}</h3>
            <ul className="divide-y divide-zinc-100">{unpaid.map(playerRow)}</ul>
          </div>
        )}
        {paid.length > 0 && (
          <div data-testid="dues-paid" className={cn(unpaid.length > 0 && 'mt-4')}>
            <h3 className={cn(EYEBROW, 'text-zinc-500')}>Paid · {paid.length}</h3>
            <ul className="divide-y divide-zinc-100">{paid.map(playerRow)}</ul>
          </div>
        )}
        {team.notPlaying.length > 0 && (
          <div data-testid="dues-not-playing" className={cn((unpaid.length > 0 || paid.length > 0) && 'mt-4')}>
            <h3 className={cn(EYEBROW, 'text-zinc-500')}>Paid, not playing · {team.notPlaying.length}</h3>
            <ul className="divide-y divide-zinc-100">{team.notPlaying.map(notPlayingRow)}</ul>
            <p className="text-[11px] font-medium text-zinc-500">
              They paid for this session but aren't on its roster, so they don't owe anything. What they paid counts in
              Collected.
            </p>
          </div>
        )}
        {team.active.length === 0 && (
          <p className="py-3 text-sm text-zinc-500">No active players yet. Set roster statuses on the Team page.</p>
        )}
        {isCaptain && !past && (
          <Link
            to="/team"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-3 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:border-zinc-900 hover:text-black"
          >
            <UserPlus className="h-4 w-4" />
            Add players to the roster on the Team page
          </Link>
        )}
        {isCaptain && started && past && (
          <button
            type="button"
            onClick={() => setRosterOpen(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-3 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:border-zinc-900 hover:text-black"
          >
            <Pencil className="h-4 w-4" />
            Change who was on session {period.session}
          </button>
        )}
        <p className="mt-3 border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-500">
          {past && !between && !isCaptain
            ? 'Tap a player to see their history or fix a mistake.'
            : 'Tap a player to see their history, link a couple who pay together, or fix a mistake.'}
        </p>
      </section>

      {events.length > 0 && (
        <section className={CARD}>
          <details>
            <summary className={cn(HEADING, 'cursor-pointer')}>Recent changes</summary>
            <div className="mt-3"><HistoryList events={events} nameOf={nameOf} meId={user.id} limit={5} /></div>
          </details>
        </section>
      )}

      {paymentLinksCard}
      {dialogs}
    </div>
  );
}
