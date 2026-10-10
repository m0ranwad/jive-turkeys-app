import { useEffect, useState } from 'react';
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
            {player.guest && ' · not on the app'}
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

        {isCaptain && player.guest && (
          <GuestSection player={player} profiles={profiles} busy={busy} run={run} onClose={() => onOpenChange(false)} />
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

/**
 * Captains, for a teammate who isn't on the app: rename them, move them to
 * their account when they join, or stop counting them. The last two ask first.
 */
function GuestSection({ player, profiles, busy, run, onClose }) {
  const [name, setName] = useState(player.display_name);
  const [linkTo, setLinkTo] = useState('');
  const [confirm, setConfirm] = useState(null);
  const appPlayers = profiles.filter((p) => !p.guest).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const linkName = appPlayers.find((p) => p.user_id === linkTo)?.display_name;

  const rename = () => run(() => api.entities.DuesGuest.update(player.id, { display_name: name.trim() }), 'Name saved');
  const link = async () => {
    if (await run(() => api.dues.linkGuest(player.id, linkTo), `${player.display_name} moved to ${linkName}'s account`)) onClose();
  };
  const remove = async () => {
    if (await run(() => api.entities.DuesGuest.update(player.id, { active: false }), `${player.display_name} removed from dues`)) onClose();
  };

  const confirmBox = (text, label, action) => (
    <div className="space-y-3 rounded-2xl bg-red-50 p-4" role="alert">
      <p className="text-sm text-red-900">{text}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setConfirm(null)} className="h-11 rounded-xl bg-white font-bold">
          Cancel
        </Button>
        <Button variant="destructive" onClick={action} disabled={busy} className="h-11 rounded-xl font-bold">
          {label}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={cn(SECTION, 'space-y-3')}>
      <span className={cn(FIELD_LABEL, 'block')}>Not on the app</span>
      <div className="space-y-1.5">
        <Label htmlFor="guest-name" className="text-xs font-semibold text-zinc-500">
          Name
        </Label>
        <div className="flex gap-2">
          <Input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11 rounded-xl" />
          <Button
            variant="outline"
            onClick={rename}
            disabled={busy || !name.trim() || name.trim() === player.display_name}
            className="h-11 rounded-xl font-bold"
          >
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guest-link" className="text-xs font-semibold text-zinc-500">
          Joined the app?
        </Label>
        <div className="flex gap-2">
          <select
            id="guest-link"
            value={linkTo}
            onChange={(e) => {
              setLinkTo(e.target.value);
              setConfirm(null);
            }}
            className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-zinc-900"
          >
            <option value="">Pick their account</option>
            {appPlayers.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => setConfirm('link')} disabled={busy || !linkTo} className="h-11 rounded-xl font-bold">
            Move
          </Button>
        </div>
      </div>
      {confirm === 'link' &&
        confirmBox(
          `${player.display_name}'s payments and history move to ${linkName}'s account, and ${player.display_name} leaves this list.`,
          'Move them',
          link,
        )}

      {confirm !== 'remove' ? (
        <button
          type="button"
          onClick={() => setConfirm('remove')}
          className="text-xs font-bold text-red-700 underline underline-offset-2"
        >
          Remove from dues
        </button>
      ) : (
        confirmBox(
          `${player.display_name} won't count in the split any more, so everyone else's share goes up. Their payments stay in the history.`,
          'Remove',
          remove,
        )
      )}
    </div>
  );
}

/** Captains: add a teammate who isn't on the app, or bring back one who was removed. */
export function AddGuestDialog({ open, onOpenChange, guests, meId, onChanged }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const removed = guests.filter((g) => !g.active && !g.linked_user_id);

  const work = async (action, done) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
      onOpenChange(false);
      toast({ title: done, description: 'They count in the split now.' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    work(() => api.entities.DuesGuest.create({ display_name: trimmed, active: true, created_by: meId }), `${trimmed} added`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Add someone not on the app</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-zinc-500">
          They count in the split, show in the list, and anyone can mark them paid. If they join the app later, link
          them to their account from their details.
        </p>
        <form onSubmit={add} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-guest" className="text-xs font-semibold text-zinc-500">
              Name
            </Label>
            <Input
              id="new-guest"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First and last name"
              maxLength={60}
              autoComplete="off"
              className="h-11 rounded-xl"
            />
          </div>
          <Button type="submit" disabled={busy || !name.trim()} className={BIG_BUTTON}>
            Add to dues
          </Button>
        </form>
        {removed.length > 0 && (
          <div className={SECTION}>
            <span className={cn(FIELD_LABEL, 'block')}>Removed earlier</span>
            {removed.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{g.display_name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => work(() => api.entities.DuesGuest.update(g.id, { active: true }), `${g.display_name} added back`)}
                  className="rounded-full font-bold"
                >
                  Add back
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
