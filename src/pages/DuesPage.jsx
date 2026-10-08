import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { CaptainsOnly, PageHeader, PageSpinner } from '@/components/PageSpinner';
import { SessionPicker } from '@/components/schedule/SessionPicker';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { CARD } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function DuesPage() {
  const { isCaptain, loading: teamLoading } = useTeam();
  const { toast } = useToast();
  const [year, setYear] = useState(dayjs().year());
  const [session, setSession] = useState(1);
  const [fee, setFee] = useState('');
  const [duesId, setDuesId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const where = { season_year: Number(year), session: Number(session) };
      const [dues, paid, roster] = await Promise.all([
        api.entities.SessionDues.filter(where),
        api.entities.DuesPayment.filter(where),
        api.entities.PlayerProfile.list(),
      ]);
      setDuesId(dues[0]?.id || null);
      setFee(dues[0] ? String(dues[0].total_fee ?? '') : '');
      setPayments(paid);
      setProfiles(roster);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, [year, session]);

  useEffect(() => {
    if (isCaptain) load();
  }, [isCaptain, load]);

  if (teamLoading) return <PageSpinner />;
  if (!isCaptain) return <CaptainsOnly>Your captain tracks session dues here.</CaptainsOnly>;
  if (loading) return <PageSpinner />;

  // Even split across active players, rounded up, after any custom amounts.
  const active = profiles.filter((p) => p.status === 'active').sort((a, b) => a.display_name.localeCompare(b.display_name));
  const paymentFor = (userId) => payments.find((p) => p.user_id === userId);
  const overrideFor = (userId) => {
    const value = paymentFor(userId)?.override_amount;
    return value == null ? null : Number(value);
  };
  const total = Number(fee) || 0;
  const custom = active.filter((p) => overrideFor(p.user_id) != null);
  const auto = active.filter((p) => overrideFor(p.user_id) == null);
  const customSum = custom.reduce((sum, p) => sum + overrideFor(p.user_id), 0);
  const perPlayer = auto.length ? Math.ceil(Math.max(0, total - customSum) / auto.length) : 0;
  const owedBy = (p) => (overrideFor(p.user_id) == null ? perPlayer : overrideFor(p.user_id));
  const assigned = active.reduce((sum, p) => sum + owedBy(p), 0);
  const surplus = assigned - total;
  const collected = active.reduce((sum, p) => sum + (paymentFor(p.user_id)?.paid ? owedBy(p) : 0), 0);

  const saveFee = async () => {
    if (duesId) await api.entities.SessionDues.update(duesId, { total_fee: total });
    else await api.entities.SessionDues.create({ season_year: Number(year), session: Number(session), total_fee: total });
    await load();
    toast({ title: 'Session fee saved' });
  };

  const savePayment = async (userId, patch) => {
    const existing = paymentFor(userId);
    if (existing) await api.entities.DuesPayment.update(existing.id, patch);
    else await api.entities.DuesPayment.create({ season_year: Number(year), session: Number(session), user_id: userId, ...patch });
    await load();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dues"
        subtitle="Split evenly across active players, rounded up. Recalculates when the roster changes."
      />

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1 space-y-2">
          <Label>Season</Label>
          <Input type="number" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Session</Label>
          <SessionPicker value={session} onChange={setSession} buttonClassName="py-2.5 text-sm" />
        </div>
      </div>

      <section className={CARD}>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label>Total league fee for this session</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
              <Input
                type="number"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="1200"
                className="pl-7 font-display text-lg font-extrabold"
              />
            </div>
          </div>
          <Button onClick={saveFee} className="h-10">
            Save
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { l: 'Per player', v: `$${perPlayer}`, tone: 'bg-lime-400 text-black' },
            { l: 'Assigned', v: `$${assigned}`, tone: 'bg-zinc-100 text-zinc-700' },
            { l: 'Surplus', v: `$${surplus > 0 ? surplus : 0}`, tone: 'bg-zinc-100 text-zinc-700' },
            { l: 'Collected', v: `$${collected}`, tone: 'bg-zinc-950 text-lime-400' },
          ].map((tile) => (
            <div key={tile.l} className={cn('rounded-2xl px-3 py-3', tile.tone)}>
              <div className="font-display text-lg font-extrabold leading-none">{tile.v}</div>
              <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{tile.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs font-semibold text-zinc-500">
          Owed ${assigned} · collected ${collected}
          {custom.length > 0 && ` · ${custom.length} custom amount${custom.length === 1 ? '' : 's'}`}
        </p>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Active players</h3>
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">Edit an amount to override</span>
        </div>
        <div className="mt-2 divide-y divide-zinc-100">
          {active.map((p) => {
            const payment = paymentFor(p.user_id);
            const paid = !!payment?.paid;
            const amount = drafts[p.user_id] ?? String(owedBy(p));
            return (
              <div key={p.id} className="flex items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.display_name}</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                    {overrideFor(p.user_id) == null ? 'Auto split' : 'Custom'}
                    {paid && payment?.paid_date ? ` · paid ${payment.paid_date}` : ''}
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
                      const value = Number(amount);
                      if (Number.isNaN(value)) return;
                      // Typing the auto amount back in clears the override.
                      await savePayment(p.user_id, { override_amount: value === perPlayer ? null : value });
                    }}
                    className="h-9 w-20 rounded-xl border border-zinc-200 pl-6 pr-2 text-right text-sm font-bold outline-none transition focus:border-zinc-900"
                  />
                </div>
                <button
                  onClick={() => savePayment(p.user_id, { paid: !paid, paid_date: paid ? null : dayjs().format('YYYY-MM-DD') })}
                  className={cn(
                    'h-9 w-[68px] shrink-0 rounded-xl text-[10px] font-black uppercase tracking-[0.08em] transition',
                    paid ? 'bg-lime-400 text-black' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
                  )}
                >
                  {paid ? 'Paid' : 'Unpaid'}
                </button>
              </div>
            );
          })}
          {active.length === 0 && (
            <p className="py-3 text-sm text-zinc-400">No active players yet — set roster statuses on the Team page.</p>
          )}
        </div>
      </section>
    </div>
  );
}
