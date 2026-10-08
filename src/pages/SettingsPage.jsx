import { useEffect, useState } from 'react';
import { CaptainsOnly, PageHeader, PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { CARD, DEFAULT_SETTINGS } from '@/lib/constants';
import { saveTeamSettings } from '@/lib/actions';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const { settings, isCaptain, loading, reload } = useTeam();
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading) setForm({ ...DEFAULT_SETTINGS, ...(settings || {}) });
  }, [loading, settings]);

  if (loading || !form) return <PageSpinner />;
  if (!isCaptain) return <CaptainsOnly>Team defaults are managed by the captains.</CaptainsOnly>;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      await saveTeamSettings({
        primary_jersey: form.primary_jersey,
        backup_jersey: form.backup_jersey,
        venue_name: form.venue_name,
        venue_address: form.venue_address,
        min_players: Number(form.min_players) || 0,
        min_women: Number(form.min_women) || 0,
        potm_mode: form.potm_mode,
      });
      await reload();
      toast({ title: 'Team settings saved' });
    } catch (err) {
      toast({ title: "Settings didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, props = {}) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={form[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Team settings" subtitle="Defaults for every game, the coed minimums, and awards." />
      <section className={cn(CARD, 'space-y-5')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('Primary jersey', 'primary_jersey')}
          {field('Backup jersey', 'backup_jersey')}
        </div>
        {field('Default venue name', 'venue_name')}
        {field('Default venue address', 'venue_address')}
        <div className="grid gap-4 sm:grid-cols-2">
          {field('Minimum players needed', 'min_players', { type: 'number', inputMode: 'numeric' })}
          {field('Minimum women field players', 'min_women', { type: 'number', inputMode: 'numeric' })}
        </div>
        <div className="space-y-2">
          <Label>Player of the Match</Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'overall', l: 'One overall award' },
              { v: 'separate', l: 'Man & Woman of the Match' },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => set({ potm_mode: opt.v })}
                className={cn(
                  'rounded-2xl border-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.06em] transition',
                  form.potm_mode === opt.v ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-3.5">
          <span className="block text-sm font-bold">RSVP reminders</span>
          <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">
            Use "Copy reminder" on each game to paste a nudge into the team group text.
          </span>
        </div>
        <Button onClick={save} disabled={busy} className="h-12 w-full text-sm font-bold uppercase tracking-[0.12em]">
          {busy ? 'Saving…' : 'Save team settings'}
        </Button>
      </section>
    </div>
  );
}
