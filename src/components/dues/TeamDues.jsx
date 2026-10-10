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
import { DUES_DEFAULTS, currentSession, dollars, feeParts, feeTotal, reminderText, teamDues } from '@/lib/dues';
import { shortName, today } from '@/lib/format';
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

/** Couples who send one payment for both. Anyone can link or unlink them. */
function PayingTogether({ profiles, onChanged }) {
  const { toast } = useToast();
  const [pick, setPick] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const roster = [...profiles].sort((x, y) => x.display_name.localeCompare(y.display_name));
  const byUser = new Map(roster.map((p) => [p.user_id, p]));
  const couples = roster.filter((p) => p.pays_with && byUser.has(p.pays_with) && p.display_name.localeCompare(byUser.get(p.pays_with).display_name) < 0);

  const link = async (userId, partnerId) => {
    setBusy(true);
    try {
      await api.dues.setPartner(userId, partnerId);
      setPick({ a: '', b: '' });
      await onChanged();
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const select = (key, label) => (
    <select
      value={pick[key]}
      onChange={(e) => setPick((p) => ({ ...p, [key]: e.target.value }))}
      aria-label={label}
      className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2 text-sm font-semibold outline-none focus:border-zinc-900"
    >
      <option value="">Pick a player</option>
      {roster.map((p) => (
        <option key={p.user_id} value={p.user_id}>
          {p.display_name}
        </option>
      ))}
    </select>
  );

  return (
    <section className={cn(CARD, 'space-y-3')}>
      <div>
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Paying together</h3>
        <p className="mt-1 text-xs font-medium text-zinc-500">
          Couples who send one payment for both. They get one pay button for both shares, and marking one paid marks both.
        </p>
      </div>
      {couples.length > 0 && (
        <div className="divide-y divide-zinc-100">
          {couples.map((p) => (
            <div key={p.user_id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {p.display_name} & {byUser.get(p.pays_with).display_name}
              </span>
              <button
                onClick={() => link(p.user_id, null)}
                disabled={busy}
                className="rounded-full bg-zinc-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500 transition hover:bg-zinc-200"
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        {select('a', 'First player')}
        <span className="text-sm font-bold text-zinc-400">&</span>
        {select('b', 'Second player')}
      </div>
      <Button
        variant="outline"
        onClick={() => link(pick.a, pick.b)}
        disabled={busy || !pick.a || !pick.b || pick.a === pick.b}
        className="h-10 w-full rounded-xl text-[11px] font-bold uppercase tracking-[0.12em]"
      >
        Link as paying together
      </Button>
    </section>
  );
}

/** One session's dues for the whole team. Anyone can mark players paid; captains also set the fee and amounts. */
export function TeamDues({ isCaptain, settings, onSettingsSaved }) {
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

  /** Reloads the session. `fresh` (a new session, or the fee was just saved) also resets the fee form. */
  const load = useCallback(
    async (fresh = true) => {
      if (!period) return;
      if (fresh) setLoading(true);
      try {
        const where = { season_year: Number(period.year), session: Number(period.session) };
        const [allDues, paid, roster] = await Promise.all([
          api.entities.SessionDues.list(),
          api.entities.DuesPayment.filter(where),
          api.entities.PlayerProfile.list(),
        ]);
        const row = allDues.find((d) => d.season_year === where.season_year && d.session === where.session) || null;
        setDuesRow(row);
        if (fresh) {
          // A new session starts from the last fee saved, so there's usually nothing to type.
          const latest = [...allDues].sort((a, b) => b.season_year - a.season_year || b.session - a.session)[0];
          setForm(toForm(row ? feeParts(row) : latest ? feeParts(latest) : DUES_DEFAULTS));
        }
        setPayments(paid);
        setProfiles(roster);
        setDrafts({});
      } finally {
        setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!period) return <PageSpinner />;

  const parts = isCaptain ? fromForm(form) : duesRow ? feeParts(duesRow) : DUES_DEFAULTS;
  const total = isCaptain ? feeTotal(parts) : Number(duesRow?.total_fee) || 0;
  const saved = !!duesRow;
  const changed = isCaptain && saved && !sameParts(parts, feeParts(duesRow));

  const team = teamDues(total, profiles, payments);
  const { active, shareOf, partnerOf } = team;
  const unpaid = active.filter((p) => !shareOf(p.user_id).paid);
  const paidPlayers = active.filter((p) => shareOf(p.user_id).paid);
  const customCount = team.players.filter((s) => s.custom).length;
  const nameOf = (userId) => profiles.find((p) => p.user_id === userId)?.display_name || '';

  const setPeriodField = (patch) => setPeriod((p) => ({ ...p, ...patch }));

  const saveFee = async () => {
    const row = { ...parts, total_fee: total };
    if (duesRow) await api.entities.SessionDues.update(duesRow.id, row);
    else await api.entities.SessionDues.create({ season_year: Number(period.year), session: Number(period.session), ...row });
    await load();
    toast({ title: 'Session fee saved', description: 'Players see their share on their Dues page.' });
  };

  const saveAmount = async (userId, patch) => {
    const existing = payments.find((p) => p.user_id === userId);
    if (existing) await api.entities.DuesPayment.update(existing.id, patch);
    else await api.entities.DuesPayment.create({ season_year: Number(period.year), session: Number(period.session), user_id: userId, ...patch });
    await load(false);
  };

  // A couple are marked together.
  const togglePaid = async (p) => {
    const paid = !shareOf(p.user_id).paid;
    try {
      await api.dues.markPaid({
        year: period.year,
        session: period.session,
        userIds: [p.user_id, partnerOf(p.user_id)?.user_id].filter(Boolean),
        paid,
        paidDate: today(),
      });
      await load(false);
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    }
  };

  const copyReminder = async () => {
    const text = reminderText({
      session: period.session,
      parts,
      perPlayer: team.perPlayer,
      activeCount: active.length,
      unpaid: team.stillToPay,
      link: `${window.location.origin}/dues`,
    });
    await copyText(text);
    toast({ title: 'Reminder copied', description: 'Paste it into the team chat or group text.' });
  };

  const extraNote =
    team.extra > 0
      ? `Rounding up collects ${dollars(team.extra)} more than the ${dollars(total)} fee.`
      : team.extra < 0
        ? `Custom amounts leave ${dollars(-team.extra)} of the ${dollars(total)} fee uncovered.`
        : `That covers the ${dollars(total)} fee exactly.`;

  const playerRow = (p) => {
    const share = shareOf(p.user_id);
    const partner = partnerOf(p.user_id);
    const amount = drafts[p.user_id] ?? String(share.amount);
    const markedBy = share.paid && payments.find((x) => x.user_id === p.user_id)?.paid_by;
    const details = [
      share.custom && 'Custom amount',
      partner && `with ${shortName(partner.display_name)}`,
      share.paid && share.paid_date && `paid ${dayjs(share.paid_date).format('MMM D')}`,
      markedBy && markedBy !== p.user_id && `by ${shortName(nameOf(markedBy))}`,
    ].filter(Boolean);
    return (
      <div key={p.id} className="flex items-center gap-2 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.display_name}</span>
          <span className="block truncate text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">{details.join(' · ')}</span>
        </span>
        {isCaptain ? (
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
                await saveAmount(p.user_id, { override_amount: value === team.perPlayer ? null : value });
              }}
              className="h-9 w-20 rounded-xl border border-zinc-200 pl-6 pr-2 text-right text-sm font-bold outline-none transition focus:border-zinc-900"
            />
          </div>
        ) : (
          <span className="w-14 text-right text-sm font-bold" aria-label={`Amount for ${p.display_name}`}>
            {dollars(share.amount)}
          </span>
        )}
        <button
          onClick={() => togglePaid(p)}
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

  const feeCard = isCaptain ? (
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
  ) : (
    <section className={cn(CARD, 'flex items-center justify-between gap-3')}>
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Session fee</h3>
      <span className="text-sm font-semibold text-zinc-600">
        {dollars(parts.league_fee)} + {parts.game_count} × {dollars(parts.ref_fee)} ={' '}
        <span className="font-display text-lg font-extrabold text-black">{dollars(total)}</span>
      </span>
    </section>
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
      ) : !isCaptain && !saved ? (
        <section className={cn(CARD, 'text-center')}>
          <p className="font-display text-lg font-extrabold uppercase tracking-tight">No fee yet</p>
          <p className="mt-2 text-sm text-zinc-500">Your captain hasn't set the fee for this session.</p>
        </section>
      ) : (
        <>
          {feeCard}

          <section className={cn(CARD, 'space-y-4')}>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
                  {team.paidCount} of {active.length} paid
                </h3>
                <span className="text-xs font-semibold text-zinc-500">
                  {dollars(team.collected)} of {dollars(team.owed)}
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-label="Players paid"
                aria-valuemin={0}
                aria-valuemax={active.length}
                aria-valuenow={team.paidCount}
              >
                <div
                  className="h-full rounded-full bg-lime-400 transition-all"
                  style={{ width: `${active.length ? (team.paidCount / active.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: 'Each player', v: dollars(team.perPlayer), tone: 'bg-lime-400 text-black' },
                { l: 'Collected', v: dollars(team.collected), tone: 'bg-zinc-950 text-lime-400' },
                { l: 'Still to collect', v: dollars(team.stillOwed), tone: 'bg-zinc-100 text-zinc-700' },
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
              <span className="text-right text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">
                {isCaptain ? 'Edit an amount to override' : 'Tap to mark paid'}
              </span>
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

          <PayingTogether profiles={profiles} onChanged={() => load(false)} />
        </>
      )}

      {isCaptain && <PaySettings settings={settings} onSaved={onSettingsSaved} />}
    </div>
  );
}
