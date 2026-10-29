import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveTeamSettings } from '@/lib/actions';
import { BIG_BUTTON, DIALOG, DIALOG_TITLE, EYEBROW } from '@/lib/constants';
import { cleanPayHandle, dollars, feeProblem, feeTotal, feeWarning, notPlayingLabel, partPayment } from '@/lib/dues';
import { today } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HistoryList, PartPayment, StatusChip, shortDate } from './DuesParts';

const SECTION = 'space-y-2 border-t border-zinc-100 pt-4';
const FIELD_LABEL = cn(EYEBROW, 'text-zinc-500');

/**
 * Captains: the session fee as the league bills it. Every box needs a number of
 * $0 or more. A $0 fee, or one more than double `previous` ({ total, now }: the
 * fee it replaces, or last session's), asks before it saves.
 */
export function FeeDialog({ open, onOpenChange, period, initial, previous, onSave }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        league_fee: String(initial.league_fee),
        ref_fee: String(initial.ref_fee),
        game_count: String(initial.game_count),
      });
      setConfirming(null);
    }
    // Only when it opens, so a reload behind it doesn't wipe what's typed.
  }, [open]);

  // Nothing to say until the boxes are filled in from the saved fee.
  const problem = 'league_fee' in form ? feeProblem(form) : null;
  const parts = {
    league_fee: Number(form.league_fee) || 0,
    ref_fee: Number(form.ref_fee) || 0,
    game_count: Math.max(0, Math.floor(Number(form.game_count) || 0)),
  };
  const total = feeTotal(parts);

  const save = async (e) => {
    e.preventDefault();
    if (problem) return;
    const warning = feeWarning(total, previous?.total);
    if (warning && !confirming) {
      setConfirming(warning);
      return;
    }
    setBusy(true);
    try {
      await onSave(parts);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, prefix) => (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={`fee-${key}`} className="block truncate text-xs font-semibold text-zinc-500">
        {label}
      </Label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">{prefix}</span>}
        <Input
          id={`fee-${key}`}
          type="number"
          inputMode={prefix ? 'decimal' : 'numeric'}
          min="0"
          step={prefix ? '0.01' : '1'}
          value={form[key] ?? ''}
          onChange={(e) => {
            setForm((f) => ({ ...f, [key]: e.target.value }));
            setConfirming(null);
          }}
          className={cn('h-11 rounded-xl font-display text-lg font-extrabold', prefix && 'pl-7')}
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>
            Session {period.session} fee
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {field('League fee', 'league_fee', '$')}
            {field('Ref fee / game', 'ref_fee', '$')}
            {field('Games', 'game_count')}
          </div>
          {problem ? (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" role="alert">
              {problem}
            </p>
          ) : (
            <div className="flex items-baseline justify-between rounded-2xl bg-zinc-50 px-4 py-3">
              <span className="text-sm font-semibold text-zinc-500">
                {dollars(parts.league_fee)} + {parts.game_count} × {dollars(parts.ref_fee)}
              </span>
              <span className="font-display text-2xl font-extrabold">{dollars(total)}</span>
            </div>
          )}
          {confirming ? (
            <div className="space-y-3 rounded-2xl bg-amber-50 p-4" role="alert">
              <p className="text-sm text-amber-950">
                {confirming === 'zero' ? (
                  <>
                    Set the session fee to <b>$0</b>? Nobody will owe anything.
                  </>
                ) : (
                  <>
                    That's <b>{dollars(total)}</b>, more than double{' '}
                    {previous.now ? `the ${dollars(previous.total)} it is now` : `last session's ${dollars(previous.total)}`}. Save it?
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirming(null)} className="h-11 rounded-xl bg-white font-bold">
                  Go back
                </Button>
                <Button type="submit" disabled={busy} className="h-11 rounded-xl font-bold">
                  {busy ? 'Saving…' : confirming === 'zero' ? 'Set to $0' : 'Save it'}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" disabled={busy || !!problem} className={BIG_BUTTON}>
              {busy ? 'Saving…' : 'Save fee'}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Captains: where players send their dues. Takes a name or a pasted profile link. */
export function PaySettingsDialog({ open, onOpenChange, settings, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        pay_venmo: settings.pay_venmo || '',
        pay_paypal: settings.pay_paypal || '',
        pay_cashapp: settings.pay_cashapp || '',
        pay_zelle: settings.pay_zelle || '',
        pay_note: settings.pay_note || '',
      });
    }
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveTeamSettings({
        pay_venmo: cleanPayHandle('venmo', form.pay_venmo) || null,
        pay_paypal: cleanPayHandle('paypal', form.pay_paypal) || null,
        pay_cashapp: cleanPayHandle('cashapp', form.pay_cashapp) || null,
        pay_zelle: form.pay_zelle.trim() || null,
        pay_note: form.pay_note.trim() || null,
      });
      await onSaved();
      onOpenChange(false);
      toast({ title: 'Payment links saved', description: 'Players see them on My dues.' });
    } catch (err) {
      toast({ title: "Payment links didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, placeholder, hint) => (
    <div className="space-y-1.5">
      <Label htmlFor={key} className="text-xs font-semibold text-zinc-500">
        {label}
      </Label>
      <Input
        id={key}
        value={form[key] ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-11 rounded-xl"
      />
      {hint && <p className="text-[11px] font-medium text-zinc-500">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Payment links</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-zinc-500">Paste a profile link or type a name. Leave out any you don't use.</p>
        <form onSubmit={save} className="space-y-3.5">
          {field('Venmo', 'pay_venmo', 'venmo.com/u/your-name', 'Players get a button with their amount filled in.')}
          {field('PayPal', 'pay_paypal', 'paypal.me/yourname or your PayPal link', 'A PayPal.Me link fills in the amount; other PayPal links open your PayPal.')}
          {field('Cash App', 'pay_cashapp', '$YourCashtag')}
          {field('Zelle phone or email', 'pay_zelle', 'you@example.com')}
          {field('Anything else players should know', 'pay_note', 'Cash at the field works too.')}
          <Button type="submit" disabled={busy} className={BIG_BUTTON}>
            {busy ? 'Saving…' : 'Save payment links'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who a player pays together with, picked from `options` (the players of the
 * session it's for). `current` is their partner there, also when they aren't
 * one of the options (`away` says why). Picking someone who pays with somebody
 * else (`partnerOf`) asks first, since that somebody then pays on their own.
 */
function PartnerPicker({ id, label, hint, player, current, away, options, partnerOf, busy, onPick }) {
  const [asking, setAsking] = useState(null);

  useEffect(() => setAsking(null), [player.user_id, current?.user_id]);

  const pick = (partnerId) => {
    const picked = options.find((p) => p.user_id === partnerId);
    const theirs = picked && partnerOf(partnerId);
    const displaced = [theirs, current].filter(
      (p, i, all) => p && p.user_id !== player.user_id && p.user_id !== partnerId && all.findIndex((other) => other?.user_id === p.user_id) === i,
    );
    if (picked && displaced.length) setAsking({ picked, theirs, displaced });
    else onPick(partnerId || null);
  };
  const first = (p) => p.display_name.split(' ')[0];

  return (
    <div className={SECTION}>
      <Label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </Label>
      <select
        id={id}
        value={current?.user_id ?? ''}
        onChange={(e) => pick(e.target.value)}
        disabled={busy || !!asking}
        className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-zinc-900"
      >
        <option value="">Nobody (pays on their own)</option>
        {current && !options.some((p) => p.user_id === current.user_id) && (
          <option value={current.user_id} disabled>
            {current.display_name} ({away})
          </option>
        )}
        {options.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.display_name}
          </option>
        ))}
      </select>
      {asking && (
        <div className="space-y-3 rounded-2xl bg-amber-50 p-4" role="alert">
          <p className="text-sm text-amber-900">
            {asking.theirs && asking.theirs.user_id !== player.user_id &&
              `${asking.picked.display_name} pays together with ${asking.theirs.display_name}. `}
            {current && current.user_id !== asking.picked.user_id && `${player.display_name} pays together with ${current.display_name}. `}
            Link {first(asking.picked)} with {first(player)} instead?{' '}
            {asking.displaced.map((p) => p.display_name).join(' and ')} will pay on their own.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setAsking(null)} disabled={busy} className="h-11 rounded-xl bg-white font-bold">
              Keep as is
            </Button>
            <Button onClick={() => onPick(asking.picked.user_id).then((saved) => saved !== false && setAsking(null))} disabled={busy} className="h-11 rounded-xl font-bold">
              Link them
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] font-medium text-zinc-500">{hint}</p>
    </div>
  );
}

/** A player's usual pairing, without payment history or captain-only corrections. */
export function PayTogetherDialog({ open, onOpenChange, player, profiles, options, from, between, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const partnerOf = (id) => profiles.find((p) => p.user_id === profiles.find((p) => p.user_id === id)?.pays_with) || null;

  if (!player) return null;

  const save = async (partnerId) => {
    setBusy(true);
    try {
      await api.dues.setPartner(player.user_id, partnerId);
      await onChanged();
      onOpenChange(false);
      toast({ title: partnerId ? 'Linked as paying together' : 'Unlinked' });
      return true;
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Pay together</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-500">Choose a teammate. One payment covers both shares, and either of you can mark it paid.</p>
        <PartnerPicker
          id="my-pays-with"
          label="Pays together with"
          hint={between
            ? 'From next session on. The session that just ended keeps who paid together then.'
            : `From session ${from.session} on. Earlier sessions keep who paid together then.`}
          player={player}
          current={partnerOf(player.user_id)}
          away={between ? 'not playing next session' : 'not playing this session'}
          options={options.filter((p) => p.user_id !== player.user_id).sort((a, b) => a.display_name.localeCompare(b.display_name))}
          partnerOf={partnerOf}
          busy={busy}
          onPick={save}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * One player's dues for the session: status, what they paid, history, who they
 * pay with, and (captains) a custom amount. Marking someone not paid takes a
 * second tap. Also opens for someone who paid and isn't on the session's active
 * roster, so they can be marked not paid.
 *
 * Who pays together is kept per session. A session that's over (`past`) keeps
 * who paid together then, and only captains change it, for that session only.
 * Otherwise a link counts from the session being played on (`from`). Between
 * sessions (`between`: this is the session that just ended) anyone can link a
 * couple from the next session.
 */
export function PlayerSheet({
  open,
  onOpenChange,
  player,
  team,
  payments,
  history,
  profiles,
  period,
  past = false,
  started = true,
  between = false,
  from = period,
  meId,
  isCaptain,
  onChanged,
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('summary');

  const share = player ? team.shareOf(player.user_id) : null;
  const out = player && !share ? team.notPlayingOf(player.user_id) : null;
  const partner = player && share ? team.partnerOf(player.user_id) : null;
  const payment = player ? payments.find((p) => p.user_id === player.user_id) : null;
  const nameOf = (userId) => profiles.find((p) => p.user_id === userId)?.display_name || '';

  useEffect(() => {
    if (open) {
      setConfirming(false);
      setView('summary');
      setAmount(share?.custom ? String(share.amount) : '');
    }
  }, [open, player?.user_id]);

  if (!player || (!share && !out)) return null;

  const names = [player.display_name, partner?.display_name].filter(Boolean);
  const run = async (work, done) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      if (done) toast({ title: done });
      return true;
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const ids = [player.user_id, partner?.user_id].filter(Boolean);
  const isPaid = share ? share.paid : true;
  const state = share ? team.stateOf(player.user_id) : null;
  // Paid, and the share has gone up since: the difference for them (and their partner) to pay.
  const balance = share?.paid && ids.every((id) => team.shareOf(id).paid) ? team.balanceOf(player.user_id) : 0;
  // What they paid, when it isn't simply their share: part of it (or before it went up), or more than it is now.
  const paidLine = share
    ? share.paid &&
      share.paid_amount !== share.amount &&
      (state === 'topUp'
        ? [`Paid ${dollars(share.paid_amount)}`, `share went up to ${dollars(share.amount)}`, balance > 0 && `${dollars(balance)} more to pay`]
        : share.paid_amount < share.amount
          ? [`Paid ${dollars(share.paid_amount)} of ${dollars(share.amount)}`, balance > 0 && `${dollars(balance)} more to pay`]
          : [`Paid ${dollars(share.paid_amount)}`, `share is now ${dollars(share.amount)}`]
      )
        .filter(Boolean)
        .join(' · ')
    : out.paid_amount != null && `Paid ${dollars(out.paid_amount)}`;
  // Still owed by them (and their partner), for "Paid part of it?".
  const owing = share ? team.owingTogether(player.user_id).filter((p) => p.due > 0) : [];
  const stillOwed = Math.round(owing.reduce((sum, p) => sum + p.due, 0) * 100) / 100;
  const payPart = (amount) => {
    const { userIds, amounts } = partPayment(team, player.user_id, amount);
    const who = owing.map((p) => profiles.find((x) => x.user_id === p.user_id)?.display_name).filter(Boolean);
    return run(
      () => api.dues.markPaid({ year: period.year, session: period.session, userIds, paid: true, paidDate: today(), amounts }),
      `${dollars(amount)} marked paid for ${who.join(' & ')}`,
    );
  };
  const mark = (paid) =>
    run(
      () =>
        api.dues.markPaid({
          year: period.year,
          session: period.session,
          userIds: ids,
          paid,
          paidDate: today(),
          amounts: ids.map((id) => team.shareOf(id)?.amount ?? null),
        }),
      paid && balance ? `${names.join(' & ')}: ${dollars(balance)} more marked paid` : `${names.join(' & ')} marked ${paid ? 'paid' : 'not paid'}`,
    ).then(() => setConfirming(false));

  const saveAmount = (value) =>
    run(async () => {
      const patch = { override_amount: value };
      if (payment) await api.entities.DuesPayment.update(payment.id, patch);
      else {
        const who = player.guest ? { guest_id: player.user_id } : { user_id: player.user_id };
        await api.entities.DuesPayment.create({ season_year: Number(period.year), session: Number(period.session), ...who, ...patch });
      }
    }, value == null ? 'Back on the even split' : 'Custom amount saved');

  // Who pays together now, and who's playing: this session's players, or for the next one, today's.
  const profileOf = (userId) => profiles.find((p) => p.user_id === userId) || null;
  const nowPartnerOf = (userId) => profileOf(profileOf(userId)?.pays_with);
  const byName = (a, b) => a.display_name.localeCompare(b.display_name);
  const playing = team.active.filter((p) => p.user_id !== player.user_id).sort(byName);
  const playingNext = profiles.filter((p) => p.user_id !== player.user_id && p.status === 'active' && !p.removed).sort(byName);
  const fromHere = Number(from.year) === Number(period.year) && Number(from.session) === Number(period.session);

  const setPartner = (partnerId, done) =>
    run(() => api.dues.setPartner(player.user_id, partnerId), partnerId ? done : 'Unlinked');
  const setSessionPartner = (partnerId) =>
    run(
      () => api.dues.setSessionPartner(period, player.user_id, partnerId),
      partnerId ? `Linked as paying together in session ${period.session}` : `Unlinked in session ${period.session}`,
    );
  const events = history.filter((e) => e.user_id === player.user_id);
  const markedBy = payment?.paid_by && payment.paid_by !== player.user_id ? ` by ${nameOf(payment.paid_by).split(' ')[0]}` : '';
  const canPair = !!share && !past;
  const canPairNext = between && player.status === 'active' && !player.removed;
  const canCorrectPair = !!share && past && isCaptain && started;
  const canSetAmount = isCaptain && !!share;
  const hasOptions = stillOwed > 0 || canPair || canPairNext || canCorrectPair || canSetAmount || (player.guest && isCaptain);
  const summary = view === 'summary' || view === 'options';
  const totalShare = share ? share.amount + (partner ? team.shareOf(partner.user_id).amount : 0) : null;
  const hasPayment = share && ids.some((id) => team.shareOf(id).paid);
  const openOption = (next) => {
    if (next === 'amount') setAmount(share.custom ? String(share.amount) : '');
    setView(next);
  };
  const finish = async (saving) => {
    const saved = await saving;
    if (saved) setView('summary');
    return saved;
  };
  const optionButton = (label, next) => (
    <Button variant="ghost" onClick={() => openOption(next)} disabled={busy} className="h-11 w-full justify-start rounded-xl font-semibold">
      {label}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{player.display_name}</DialogTitle>
        </DialogHeader>

        <div className="-mt-2 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-zinc-500" data-testid="player-sheet-amount">
            {share
              ? `${dollars(totalShare)}${share.custom && !partner ? ' · custom amount' : ''}`
              : `Not playing · ${notPlayingLabel(out)}`}
            {player.guest && ' · not joined yet'}
          </span>
          {/* Their own share, as on their line in Team dues; what the two of them owe is on the button below. */}
          <StatusChip
            paid={share ? state === 'paid' : isPaid}
            partial={state === 'part'}
            owes={state === 'topUp' ? share.shortBy : 0}
            date={share ? (state === 'paid' ? share.paid_date : null) : out.paid_date}
          />
        </div>
        {isPaid && (
          <p className="-mt-2 text-xs font-medium text-zinc-500">
            {paidLine && `${paidLine}. `}
            Marked paid {shortDate(share ? share.paid_date : out.paid_date)}
            {markedBy}.{out && " They aren't on this session's roster, so they don't owe anything."}
          </p>
        )}

        {summary && share && (!ids.every((id) => team.shareOf(id).paid) || stillOwed > 0) && !confirming && (
          <Button onClick={() => mark(true)} disabled={busy} className={cn(BIG_BUTTON, 'bg-lime-400 text-black hover:bg-lime-300')}>
            {hasPayment && stillOwed > 0 ? `Mark ${dollars(stillOwed)} more paid` : partner ? 'Mark both paid' : 'Mark paid'}
          </Button>
        )}
        {summary && isPaid && !confirming && (
          <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy} className="h-11 justify-start rounded-xl px-0 text-xs font-semibold text-zinc-500">
            Mark as not paid
          </Button>
        )}
        {isPaid && confirming && (
          <div className="space-y-3 rounded-2xl bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-900">
              {names.join(' and ')} will show as <b>unpaid</b>. The payment stays in the history, so it can be put back.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} className="h-11 rounded-xl bg-white font-bold">
                Keep as paid
              </Button>
              <Button variant="destructive" onClick={() => mark(false)} disabled={busy} className="h-11 rounded-xl font-bold">
                Mark not paid
              </Button>
            </div>
          </div>
        )}
        {partner && (
          <p className="-mt-2 text-xs font-medium text-zinc-500">
            {past ? 'Paid' : 'Pays'} together with {partner.display_name}, so both change together.
          </p>
        )}

        {!confirming && summary && (hasOptions || events.length > 0) && (
          <div className="border-t border-zinc-100 pt-1">
            <div className="flex items-center gap-2">
              {hasOptions && (
                <Button
                  variant="ghost"
                  onClick={() => setView(view === 'options' ? 'summary' : 'options')}
                  disabled={busy}
                  aria-expanded={view === 'options'}
                  aria-controls="dues-options"
                  className="h-11 rounded-xl px-2 text-xs font-semibold text-zinc-500"
                >
                  More options
                  <ChevronDown className={cn('h-4 w-4', view === 'options' && 'rotate-180')} />
                </Button>
              )}
              {events.length > 0 && (
                <Button variant="ghost" onClick={() => setView('history')} disabled={busy} className="h-11 rounded-xl px-2 text-xs font-semibold text-zinc-500">
                  History
                </Button>
              )}
            </div>
            <div id="dues-options" hidden={view !== 'options'} className="space-y-1 rounded-2xl bg-zinc-50 p-1">
              {stillOwed > 0 && optionButton('Record part payment', 'partial')}
              {canPair && optionButton(nowPartnerOf(player.user_id) ? 'Change who pays together' : 'Pay together', 'partner')}
              {canPairNext && optionButton('Pay together from next session', 'next')}
              {canCorrectPair && optionButton('Edit who paid together', 'past')}
              {canSetAmount && optionButton(share.custom ? 'Change custom amount' : 'Set custom amount', 'amount')}
              {player.guest && isCaptain && (
                <Link to="/team" className="flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold hover:bg-zinc-100">View on Team</Link>
              )}
            </div>
          </div>
        )}

        {!confirming && !summary && (
          <div className={SECTION}>
            <Button
              variant="ghost"
              onClick={() => setView(hasOptions ? 'options' : 'summary')}
              disabled={busy}
              className="-ml-2 h-11 rounded-xl px-2 text-xs font-semibold text-zinc-500"
            >
              <ChevronLeft className="h-4 w-4" />
              {hasOptions ? 'Back to options' : 'Back'}
            </Button>
            {view === 'partial' && share && stillOwed > 0 && (
              <PartPayment key={player.user_id} defaultOpen max={stillOwed} both={owing.length > 1} busy={busy} onSave={(paid) => finish(payPart(paid))} />
            )}
            {view === 'partner' && canPair && (
              <PartnerPicker
                id="pays-with"
                label="Pays together with"
                hint={`For couples who send one payment for both. ${
                  fromHere ? 'From this session on' : `Counts from session ${from.session} on`
                }; earlier sessions keep who paid together then.`}
                player={player}
                current={nowPartnerOf(player.user_id)}
                away="not playing this session"
                options={playing}
                partnerOf={nowPartnerOf}
                busy={busy}
                onPick={(id) => finish(setPartner(id, 'Linked as paying together'))}
              />
            )}
            {view === 'next' && canPairNext && (
              <PartnerPicker
                id="pays-with-next"
                label="Pays together from next session"
                hint={`For couples who send one payment for both. Session ${period.session} keeps who paid together then.`}
                player={player}
                current={nowPartnerOf(player.user_id)}
                away="not playing next session"
                options={playingNext}
                partnerOf={nowPartnerOf}
                busy={busy}
                onPick={(id) => finish(setPartner(id, 'Linked from next session'))}
              />
            )}
            {view === 'past' && canCorrectPair && (
              <PartnerPicker
                id="paid-with"
                label={`Paid together in session ${period.session}`}
                hint={`Fixes session ${period.session} only. Other sessions don't change.`}
                player={player}
                current={partner}
                options={playing}
                partnerOf={(id) => team.partnerOf(id)}
                busy={busy}
                onPick={(id) => finish(setSessionPartner(id))}
              />
            )}
            {view === 'amount' && canSetAmount && (
              <div className="space-y-2">
                <Label htmlFor="custom-amount" className={FIELD_LABEL}>Custom amount</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">$</span>
                    <Input
                      id="custom-amount"
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={`${team.perPlayer} (even split)`}
                      className="h-11 rounded-xl pl-7 font-bold"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || amount.trim() === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0}
                    onClick={() => finish(saveAmount(Number(amount)))}
                    className="h-11 rounded-xl font-bold"
                  >Save</Button>
                </div>
                {share.custom && (
                  <button type="button" onClick={() => finish(saveAmount(null))} disabled={busy} className="min-h-11 text-xs font-bold text-zinc-500 underline underline-offset-2">
                    Use the even split ({dollars(team.perPlayer)}) instead
                  </button>
                )}
              </div>
            )}
            {view === 'history' && <HistoryList events={events} nameOf={nameOf} meId={meId} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
