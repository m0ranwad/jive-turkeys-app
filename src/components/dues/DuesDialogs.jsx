import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveTeamSettings } from '@/lib/actions';
import { cleanPayHandle, dollars, feeTotal } from '@/lib/dues';
import { today } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DIALOG, DIALOG_TITLE, EYEBROW, HistoryList, StatusChip, shortDate } from './DuesParts';

const SECTION = 'space-y-2 border-t border-zinc-100 pt-4';
const FIELD_LABEL = cn(EYEBROW, 'text-zinc-400');
const BIG_BUTTON = 'h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]';

/** Captains: the session fee as the league bills it. */
export function FeeDialog({ open, onOpenChange, period, initial, onSave }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        league_fee: String(initial.league_fee),
        ref_fee: String(initial.ref_fee),
        game_count: String(initial.game_count),
      });
    }
    // Only when it opens, so a reload behind it doesn't wipe what's typed.
  }, [open]);

  const parts = {
    league_fee: Number(form.league_fee) || 0,
    ref_fee: Number(form.ref_fee) || 0,
    game_count: Math.max(0, Math.floor(Number(form.game_count) || 0)),
  };

  const save = async (e) => {
    e.preventDefault();
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
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">{prefix}</span>}
        <Input
          id={`fee-${key}`}
          type="number"
          inputMode={prefix ? 'decimal' : 'numeric'}
          value={form[key] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
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
          <div className="flex items-baseline justify-between rounded-2xl bg-zinc-50 px-4 py-3">
            <span className="text-sm font-semibold text-zinc-500">
              {dollars(parts.league_fee)} + {parts.game_count} × {dollars(parts.ref_fee)}
            </span>
            <span className="font-display text-2xl font-extrabold">{dollars(feeTotal(parts))}</span>
          </div>
          <Button type="submit" disabled={busy} className={BIG_BUTTON}>
            {busy ? 'Saving…' : 'Save fee'}
          </Button>
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
      {hint && <p className="text-[11px] font-medium text-zinc-400">{hint}</p>}
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
 * One player's dues for the session: status, history, who they pay with, and
 * (captains) a custom amount. Marking someone not paid takes a second tap.
 */
export function PlayerSheet({ open, onOpenChange, player, team, payments, history, profiles, period, meId, isCaptain, onChanged }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const share = player ? team.shareOf(player.user_id) : null;
  const partner = player ? team.partnerOf(player.user_id) : null;
  const payment = player ? payments.find((p) => p.user_id === player.user_id) : null;
  const nameOf = (userId) => profiles.find((p) => p.user_id === userId)?.display_name || '';

  useEffect(() => {
    if (open) {
      setConfirming(false);
      setAmount(share?.custom ? String(share.amount) : '');
    }
  }, [open, player?.user_id]);

  if (!player || !share) return null;

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

  const mark = (paid) =>
    run(
      () =>
        api.dues.markPaid({
          year: period.year,
          session: period.session,
          userIds: [player.user_id, partner?.user_id].filter(Boolean),
          paid,
          paidDate: today(),
        }),
      `${names.join(' & ')} marked ${paid ? 'paid' : 'not paid'}`,
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

  const setPartner = (partnerId) =>
    run(() => api.dues.setPartner(player.user_id, partnerId || null), partnerId ? 'Linked as paying together' : 'Unlinked');

  // Anyone to pay with, except guests who no longer count.
  const roster = profiles
    .filter((p) => p.user_id !== player.user_id && !(p.guest && p.status !== 'active'))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const events = history.filter((e) => e.user_id === player.user_id);
  const markedBy = payment?.paid_by && payment.paid_by !== player.user_id ? ` by ${nameOf(payment.paid_by).split(' ')[0]}` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{player.display_name}</DialogTitle>
        </DialogHeader>

        <div className="-mt-2 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-zinc-500">
            {dollars(share.amount)} · {share.custom ? 'custom amount' : 'even split'}
            {player.guest && ' · not joined yet'}
          </span>
          <StatusChip paid={share.paid} date={share.paid_date} />
        </div>
        {share.paid && (
          <p className="-mt-2 text-xs font-medium text-zinc-400">
            Marked paid {shortDate(share.paid_date)}
            {markedBy}.
          </p>
        )}

        {!share.paid && (
          <Button onClick={() => mark(true)} disabled={busy} className={cn(BIG_BUTTON, 'bg-lime-400 text-black hover:bg-lime-300')}>
            {partner ? `Mark both paid` : 'Mark paid'}
          </Button>
        )}
        {share.paid && !confirming && (
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={busy} className={BIG_BUTTON}>
            Mark as not paid
          </Button>
        )}
        {share.paid && confirming && (
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
        {partner && <p className="-mt-2 text-xs font-medium text-zinc-400">Pays together with {partner.display_name}, so both change together.</p>}

        <div className={SECTION}>
          <Label htmlFor="pays-with" className={FIELD_LABEL}>
            Pays together with
          </Label>
          <select
            id="pays-with"
            value={player.pays_with && profiles.some((p) => p.user_id === player.pays_with) ? player.pays_with : ''}
            onChange={(e) => setPartner(e.target.value)}
            disabled={busy}
            className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-zinc-900"
          >
            <option value="">Nobody (pays on their own)</option>
            {roster.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <p className="text-[11px] font-medium text-zinc-400">For couples who send one payment for both.</p>
        </div>

        {isCaptain && (
          <div className={SECTION}>
            <Label htmlFor="custom-amount" className={FIELD_LABEL}>
              Custom amount
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
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
                disabled={busy || amount.trim() === '' || Number.isNaN(Number(amount)) || Number(amount) < 0}
                onClick={() => saveAmount(Number(amount))}
                className="h-11 rounded-xl font-bold"
              >
                Save
              </Button>
            </div>
            {share.custom && (
              <button
                type="button"
                onClick={() => saveAmount(null)}
                disabled={busy}
                className="text-xs font-bold text-zinc-500 underline underline-offset-2"
              >
                Use the even split ({dollars(team.perPlayer)}) instead
              </button>
            )}
          </div>
        )}

        {player.guest && (
          <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-xs font-medium text-zinc-500">
            {player.display_name} hasn't joined the app yet. When they sign up and pick their name, their payments
            come with them.{' '}
            {isCaptain ? (
              <>
                Change their name or status on the{' '}
                <Link to="/team" className="font-bold text-zinc-800 underline underline-offset-2">
                  Team page
                </Link>
                .
              </>
            ) : (
              'Anyone can mark them paid.'
            )}
          </p>
        )}

        <div className={SECTION}>
          <span className={cn(FIELD_LABEL, 'block')}>History</span>
          {events.length ? (
            <HistoryList events={events} nameOf={nameOf} meId={meId} />
          ) : (
            <p className="text-sm text-zinc-400">No changes yet this session.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
