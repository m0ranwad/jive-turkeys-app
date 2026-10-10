import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Copy } from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { SessionPicker } from '@/components/schedule/SessionPicker';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveTeamSettings } from '@/lib/actions';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { DUES_DEFAULTS, currentSession, dollars, feeParts, feeTotal, reminderText, splitDues } from '@/lib/dues';
import { today } from '@/lib/format';
import { cn } from '@/lib/utils';

const toForm = (parts) => ({
  league_fee: String(parts.league_fee),
  ref_fee: String(parts.ref_fee),
  game_count: String(parts.game_count),
});
const fromForm = (form) => ({
  league_fee: Number(form.league_fee) || 0,
  ref_fee: Number(form.ref_fee) || 0,
  game_count: Math.max(0, Math.floor(Number(form.game_count) || 0)),
});
const sameParts = (a, b) => a.league_fee === b.league_fee && a.ref_fee === b.ref_fee && a.game_count === b.game_count;

function MoneyInput({ label, value, onChange, prefix = '$', ...props }) {
  return (
    <div className="min-w-0 space-y-2">
      <Label className="block truncate text-xs">{label}</Label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">{prefix}</span>}
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className={cn('font-display text-lg font-extrabold', prefix && 'pl-7')}
          {...props}
        />
      </div>
    </div>
  );
}

/** Where players send their dues. Saved to team settings and shown on every player's Dues page. */
function PaySettings({ settings, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => ({
    pay_venmo: settings.pay_venmo || '',
    pay_cashapp: settings.pay_cashapp || '',
    pay_zelle: settings.pay_zelle || '',
    pay_note: settings.pay_note || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      await saveTeamSettings({
        pay_venmo: form.pay_venmo.trim().replace(/^@/, '') || null,
        pay_cashapp: form.pay_cashapp.trim().replace(/^\$/, '') || null,
        pay_zelle: form.pay_zelle.trim() || null,
        pay_note: form.pay_note.trim() || null,
      });
      await onSaved();
      toast({ title: 'Payment details saved', description: 'Players see them on their Dues page.' });
    } catch (err) {
      toast({ title: "Payment details didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, placeholder) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={form[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={placeholder} aria-label={label} />
    </div>
  );

  return (
    <section className={cn(CARD, 'space-y-4')}>
      <div>
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">How players pay</h3>
        <p className="mt-1 text-xs font-medium text-zinc-500">
          Players get a pay button with their amount filled in. Leave out any you don't use.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('Venmo username', 'pay_venmo', '@your-venmo')}
        {field('Cash App $cashtag', 'pay_cashapp', '$YourCashtag')}
      </div>
      {field('Zelle phone or email', 'pay_zelle', 'you@example.com')}
      {field('Anything else players should know', 'pay_note', 'Cash at the field works too.')}
      <Button onClick={save} disabled={busy} className="h-11 w-full text-sm font-bold uppercase tracking-[0.12em]">
        {busy ? 'Saving…' : 'Save payment details'}
      </Button>
    </section>
  );
}

/** The captains' side: set a session's fee, see who has paid, nudge who hasn't. */
export function TeamDues({ settings, onSettingsSaved }) {
  const { toast } = useToast();
  const [period, setPeriod] = useState(null);
  const [form, setForm] = useState(toForm(DUES_DEFAULTS));
  const [duesRow, setDuesRow] = useState(null);
  const [payments, setPayments] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);

  // Opens on the session of the next game (or the latest one).
  useEffect(() => {
    api.entities.Game.list('-date')
      .then((games) => setPeriod(currentSession(games, today())))
      .catch(() => setPeriod(currentSession([], today())));
  }, []);

  const load = useCallback(async () => {
    if (!period) return;
    setLoading(true);
    try {
      const where = { season_year: Number(period.year), session: Number(period.session) };
      const [allDues, paid, roster] = await Promise.all([
        api.entities.SessionDues.list(),
        api.entities.DuesPayment.filter(where),
        api.entities.PlayerProfile.list(),
      ]);
      const row = allDues.find((d) => d.season_year === where.season_year && d.session === where.session) || null;
      // A new session starts from the last fee saved, so there's usually nothing to type.
      const latest = [...allDues].sort((a, b) => b.season_year - a.season_year || b.session - a.session)[0];
      setDuesRow(row);
      setForm(toForm(row ? feeParts(row) : latest ? feeParts(latest) : DUES_DEFAULTS));
      setPayments(paid);
      setProfiles(roster);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  if (!period) return <PageSpinner />;

  const parts = fromForm(form);
  const total = feeTotal(parts);
  const saved = !!duesRow;
  const changed = saved && !sameParts(parts, feeParts(duesRow));

  const active = profiles.filter((p) => p.status === 'active').sort((a, b) => a.display_name.localeCompare(b.display_name));
  const split = splitDues(total, active.map((p) => p.user_id), payments);
  const shareOf = (userId) => split.players.find((s) => s.user_id === userId);
  const unpaid = active.filter((p) => !shareOf(p.user_id).paid);
  const paidPlayers = active.filter((p) => shareOf(p.user_id).paid);
  const customCount = split.players.filter((s) => s.custom).length;

  const setPeriodField = (patch) => setPeriod((p) => ({ ...p, ...patch }));

  const saveFee = async () => {
    const row = { ...parts, total_fee: total };
    if (duesRow) await api.entities.SessionDues.update(duesRow.id, row);
    else await api.entities.SessionDues.create({ season_year: Number(period.year), session: Number(period.session), ...row });
    await load();
    toast({ title: 'Session fee saved', description: 'Players see their share on their Dues page.' });
  };

  const savePayment = async (userId, patch) => {
    const existing = payments.find((p) => p.user_id === userId);
    if (existing) await api.entities.DuesPayment.update(existing.id, patch);
    else await api.entities.DuesPayment.create({ season_year: Number(period.year), session: Number(period.session), user_id: userId, ...patch });
    await load();
  };

  const copyReminder = async () => {
    const text = reminderText({
      session: period.session,
      parts,
      perPlayer: split.perPlayer,
      activeCount: active.length,
      unpaid: unpaid.map((p) => ({ name: p.display_name, amount: shareOf(p.user_id).amount })),
      link: `${window.location.origin}/dues`,
    });
    await copyText(text);
    toast({ title: 'Reminder copied', description: 'Paste it into the team chat or group text.' });
  };

  const extraNote =
    split.extra > 0
      ? `Rounding up collects ${dollars(split.extra)} more than the ${dollars(total)} fee.`
      : split.extra < 0
        ? `Custom amounts leave ${dollars(-split.extra)} of the ${dollars(total)} fee uncovered.`
        : `That covers the ${dollars(total)} fee exactly.`;

  const playerRow = (p) => {
    const share = shareOf(p.user_id);
    const amount = drafts[p.user_id] ?? String(share.amount);
    return (
      <div key={p.id} className="flex items-center gap-2 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.display_name}</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">
            {share.custom ? 'Custom' : 'Even split'}
            {share.paid && share.paid_date ? ` · paid ${dayjs(share.paid_date).format('MMM D')}` : ''}
          </span>
        </span>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            aria-label={`Amount for ${p.display_name}`}
            onChange={(e) => setDrafts((d) => ({ ...d, [p.user_id]: e.target.value }))}
            onBlur={async () => {
              if (drafts[p.user_id] === undefined) return;
              const value = Number(amount);
              if (drafts[p.user_id].trim() === '' || Number.isNaN(value) || value < 0 || value === share.amount) {
                setDrafts(({ [p.user_id]: _, ...rest }) => rest);
                return;
              }
              // Typing the even split back in clears the custom amount.
              await savePayment(p.user_id, { override_amount: value === split.perPlayer ? null : value });
            }}
            className="h-9 w-20 rounded-xl border border-zinc-200 pl-6 pr-2 text-right text-sm font-bold outline-none transition focus:border-zinc-900"
          />
        </div>
        <button
          onClick={() =>
            savePayment(p.user_id, { paid: !share.paid, paid_date: share.paid ? null : dayjs().format('YYYY-MM-DD') })
          }
          aria-label={`${p.display_name}: ${share.paid ? 'paid' : 'unpaid'}`}
          className={cn(
            'h-9 w-[68px] shrink-0 rounded-xl text-[10px] font-black uppercase tracking-[0.08em] transition',
            share.paid ? 'bg-lime-400 text-black' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
          )}
        >
          {share.paid ? 'Paid' : 'Unpaid'}
        </button>
      </div>
    );
  };

  const groupHeading = (label, count) => (
    <h4 className="pt-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
      {label} ({count})
    </h4>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-2">
          <Label>Season</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={period.year}
            onChange={(e) => setPeriodField({ year: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Session</Label>
          <SessionPicker
            value={period.session}
            onChange={(session) => setPeriodField({ session })}
            buttonClassName="py-2.5 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <section className={cn(CARD, 'space-y-4')}>
            <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Session fee</h3>
            <div className="grid grid-cols-3 gap-2">
              <MoneyInput label="League fee" value={form.league_fee} onChange={(v) => setForm((f) => ({ ...f, league_fee: v }))} />
              <MoneyInput label="Ref fee / game" value={form.ref_fee} onChange={(v) => setForm((f) => ({ ...f, ref_fee: v }))} />
              <MoneyInput
                label="Games"
                prefix=""
                inputMode="numeric"
                value={form.game_count}
                onChange={(v) => setForm((f) => ({ ...f, game_count: v }))}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-3.5 py-3">
              <span className="text-sm font-semibold text-zinc-600">
                {dollars(parts.league_fee)} + {parts.game_count} × {dollars(parts.ref_fee)} ={' '}
                <span className="font-display text-lg font-extrabold text-black">{dollars(total)}</span>
              </span>
              <Button onClick={saveFee} disabled={saved && !changed} className="h-10">
                {saved && !changed ? 'Saved' : 'Save fee'}
              </Button>
            </div>
            {!saved && (
              <p className="rounded-2xl bg-amber-100 px-3.5 py-2.5 text-xs font-bold text-amber-900">
                Not saved yet. Players see their share once you save the fee.
              </p>
            )}
            {changed && (
              <p className="rounded-2xl bg-amber-100 px-3.5 py-2.5 text-xs font-bold text-amber-900">
                Changes not saved. Players still see the {dollars(duesRow.total_fee)} fee.
              </p>
            )}
          </section>

          <section className={cn(CARD, 'space-y-4')}>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
                  {split.paidCount} of {active.length} paid
                </h3>
                <span className="text-xs font-semibold text-zinc-500">
                  {dollars(split.collected)} of {dollars(split.owed)}
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-label="Players paid"
                aria-valuemin={0}
                aria-valuemax={active.length}
                aria-valuenow={split.paidCount}
              >
                <div
                  className="h-full rounded-full bg-lime-400 transition-all"
                  style={{ width: `${active.length ? (split.paidCount / active.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: 'Each player', v: dollars(split.perPlayer), tone: 'bg-lime-400 text-black' },
                { l: 'Collected', v: dollars(split.collected), tone: 'bg-zinc-950 text-lime-400' },
                { l: 'Still to collect', v: dollars(split.stillOwed), tone: 'bg-zinc-100 text-zinc-700' },
              ].map((tile) => (
                <div key={tile.l} className={cn('rounded-2xl px-3 py-3', tile.tone)}>
                  <div className="font-display text-lg font-extrabold leading-none">{tile.v}</div>
                  <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{tile.l}</div>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold text-zinc-500">
              {extraNote}
              {customCount > 0 && ` ${customCount} custom amount${customCount === 1 ? '' : 's'}.`}
            </p>
            {unpaid.length > 0 && (
              <Button
                variant="outline"
                onClick={copyReminder}
                disabled={!saved || changed}
                className="h-11 w-full rounded-2xl text-[11px] font-bold uppercase tracking-[0.12em]"
              >
                <Copy />
                Copy reminder for {unpaid.length} unpaid
              </Button>
            )}
          </section>

          <section className={CARD}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Active players</h3>
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">Edit an amount to override</span>
            </div>
            {unpaid.length > 0 && (
              <div data-testid="dues-unpaid">
                {groupHeading('Still to pay', unpaid.length)}
                <div className="divide-y divide-zinc-100">{unpaid.map(playerRow)}</div>
              </div>
            )}
            {paidPlayers.length > 0 && (
              <div data-testid="dues-paid">
                {groupHeading('Paid', paidPlayers.length)}
                <div className="divide-y divide-zinc-100">{paidPlayers.map(playerRow)}</div>
              </div>
            )}
            {active.length === 0 && (
              <p className="py-3 text-sm text-zinc-400">No active players yet. Set roster statuses on the Team page.</p>
            )}
          </section>
        </>
      )}

      <PaySettings settings={settings} onSaved={onSettingsSaved} />
    </div>
  );
}
