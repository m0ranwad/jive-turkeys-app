import { useState } from 'react';
import { Copy, Pencil, UserPlus } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { sessionSlice } from '@/hooks/useDues';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { DUES_DEFAULTS, cleanPayHandle, dollars, feeParts, feeTotal, reminderText, teamDues } from '@/lib/dues';
import { shortName, today } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AddGuestDialog, FeeDialog, PaySettingsDialog, PlayerSheet } from './DuesDialogs';
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
export function TeamDues({ data, period, user, isCaptain, settings, onChanged, onSettingsSaved }) {
  const { toast } = useToast();
  const [sheetFor, setSheetFor] = useState(null);
  const [feeOpen, setFeeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const { row, payments, history } = sessionSlice(data, period);
  const total = row ? Number(row.total_fee) || 0 : 0;
  const team = teamDues(total, data.profiles, payments);
  const unpaid = team.active.filter((p) => !team.shareOf(p.user_id).paid);
  const paid = team.active.filter((p) => team.shareOf(p.user_id).paid);
  const nameOf = (userId) => data.profiles.find((p) => p.user_id === userId)?.display_name || '';

  // A new session's fee starts from the last one saved, so there's usually nothing to type.
  const latest = [...data.dues].sort((a, b) => b.season_year - a.season_year || b.session - a.session)[0];
  const feeStart = row ? feeParts(row) : latest ? feeParts(latest) : DUES_DEFAULTS;

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

  const markPaid = async (player) => {
    const partner = team.partnerOf(player.user_id);
    setBusyId(player.user_id);
    try {
      await api.dues.markPaid({
        year: period.year,
        session: period.session,
        userIds: [player.user_id, partner?.user_id].filter(Boolean),
        paid: true,
        paidDate: today(),
      });
      await onChanged();
      toast({ title: `${[player.display_name, partner?.display_name].filter(Boolean).join(' & ')} marked paid` });
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

  const playerRow = (p) => {
    const share = team.shareOf(p.user_id);
    const partner = team.partnerOf(p.user_id);
    const payment = payments.find((x) => x.user_id === p.user_id);
    const details = [
      p.guest && 'not on the app',
      partner && `with ${shortName(partner.display_name)}`,
      share.custom && 'custom amount',
      share.paid && payment?.paid_by && payment.paid_by !== p.user_id && `marked by ${shortName(nameOf(payment.paid_by))}`,
    ].filter(Boolean);
    return (
      <li key={p.user_id} className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => setSheetFor(p.user_id)}
          aria-label={`Details for ${p.display_name}`}
          className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-zinc-50"
        >
          <Avatar name={p.display_name} className={cn(p.guest && 'border border-dashed border-zinc-300 bg-white')} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{p.display_name}</span>
            {details.length > 0 && <span className="block truncate text-[11px] font-medium text-zinc-400">{details.join(' · ')}</span>}
          </span>
        </button>
        <span className="text-sm font-bold tabular-nums text-zinc-700" aria-label={`Amount for ${p.display_name}`}>
          {dollars(share.amount)}
        </span>
        {share.paid ? (
          <StatusChip paid date={share.paid_date} dateOnly className="h-8 w-[78px] justify-center" />
        ) : (
          <button
            type="button"
            onClick={() => markPaid(p)}
            disabled={busyId === p.user_id}
            aria-label={`Mark ${p.display_name} paid`}
            className="h-8 w-[78px] shrink-0 rounded-full bg-lime-400 text-[10px] font-black uppercase tracking-[0.08em] text-black transition hover:bg-lime-300 disabled:opacity-50"
          >
            Mark paid
          </button>
        )}
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
      {isCaptain && <FeeDialog open={feeOpen} onOpenChange={setFeeOpen} period={period} initial={feeStart} onSave={saveFee} />}
      {isCaptain && <PaySettingsDialog open={payOpen} onOpenChange={setPayOpen} settings={settings} onSaved={onSettingsSaved} />}
      {isCaptain && <AddGuestDialog open={addOpen} onOpenChange={setAddOpen} guests={data.guests || []} meId={user.id} onChanged={onChanged} />}
      <PlayerSheet
        open={!!sheetFor}
        onOpenChange={(open) => !open && setSheetFor(null)}
        player={data.profiles.find((p) => p.user_id === sheetFor) || null}
        team={team}
        payments={payments}
        history={history}
        profiles={data.profiles}
        period={period}
        meId={user.id}
        isCaptain={isCaptain}
        onChanged={onChanged}
      />
    </>
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
        {unpaid.length > 0 && (
          <div data-testid="dues-unpaid">
            <h3 className={cn(EYEBROW, 'text-zinc-400')}>Still to pay · {unpaid.length}</h3>
            <ul className="divide-y divide-zinc-100">{unpaid.map(playerRow)}</ul>
          </div>
        )}
        {paid.length > 0 && (
          <div data-testid="dues-paid" className={cn(unpaid.length > 0 && 'mt-4')}>
            <h3 className={cn(EYEBROW, 'text-zinc-400')}>Paid · {paid.length}</h3>
            <ul className="divide-y divide-zinc-100">{paid.map(playerRow)}</ul>
          </div>
        )}
        {team.active.length === 0 && (
          <p className="py-3 text-sm text-zinc-400">No active players yet. Set roster statuses on the Team page.</p>
        )}
        {isCaptain && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 py-3 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:border-zinc-900 hover:text-black"
          >
            <UserPlus className="h-4 w-4" />
            Add someone not on the app
          </button>
        )}
        <p className="mt-3 border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-400">
          Tap a player to see their history, link a couple who pay together, or fix a mistake.
        </p>
      </section>

      {history.length > 0 && (
        <section className={CARD}>
          <h3 className={cn(HEADING, 'mb-3')}>Recent changes</h3>
          <HistoryList events={history} nameOf={nameOf} meId={user.id} limit={5} />
        </section>
      )}

      {paymentLinksCard}
      {dialogs}
    </div>
  );
}
