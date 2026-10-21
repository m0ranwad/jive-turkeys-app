import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { saveFailedToast } from '@/lib/errors';
import { seasonOf, today, venueText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { JerseyDot } from './GameCard';
import { SeasonPicker } from './SeasonPicker';
import { SessionPicker } from './SessionPicker';

export function GameFormDialog({ open, onOpenChange, game, settings, defaultSession, onSave }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  // The season the picker centers on: the game's own, or the one new games most likely belong to.
  const season = game ? game.season_year : defaultSession?.year || seasonOf(today());

  useEffect(() => {
    if (!open) return;
    setForm(
      game
        ? { ...game }
        : {
            season_year: season,
            session: defaultSession?.session || 1,
            date: '',
            time: '19:00',
            field_number: '',
            opponent: '',
            location: venueText(settings),
            jersey: 'primary',
            notes: '',
          },
    );
  }, [open, game]);

  if (!open || !form) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.date && form.opponent?.trim();

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSave({
        season_year: Number(form.season_year),
        session: Number(form.session),
        date: form.date,
        time: form.time || '',
        field_number: form.field_number || '',
        opponent: form.opponent.trim(),
        location: form.location || '',
        jersey: form.jersey || 'primary',
        notes: form.notes || '',
      });
      onOpenChange(false);
    } catch (err) {
      toast(saveFailedToast(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">
            {game ? 'Edit game' : 'Add game'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Season</Label>
              <SeasonPicker
                value={form.season_year}
                around={season}
                onChange={(season_year) => set({ season_year })}
              />
            </div>
            <div className="space-y-2">
              <Label>Session</Label>
              <SessionPicker value={form.session} onChange={(session) => set({ session })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="game-date">Date</Label>
              <Input id="game-date" type="date" value={form.date || ''} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="game-time">Time</Label>
              <Input id="game-time" type="time" value={form.time || ''} onChange={(e) => set({ time: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="game-opponent">Opponent</Label>
              <Input id="game-opponent" value={form.opponent || ''} onChange={(e) => set({ opponent: e.target.value })} placeholder="Team name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="game-field">Field number</Label>
              <Input id="game-field" value={form.field_number || ''} onChange={(e) => set({ field_number: e.target.value })} placeholder="3" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="game-location">Location</Label>
            <Input id="game-location" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Jersey</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'primary', label: settings?.primary_jersey || 'Primary' },
                { v: 'backup', label: settings?.backup_jersey || 'Backup' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  aria-pressed={form.jersey === opt.v}
                  onClick={() => set({ jersey: opt.v })}
                  className={cn(
                    'flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-xs font-bold transition',
                    form.jersey === opt.v ? 'border-black bg-lime-50' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
                  )}
                >
                  <JerseyDot jersey={opt.v} className="h-3 w-3" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="game-notes">Notes</Label>
            <Textarea
              id="game-notes"
              value={form.notes || ''}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
              placeholder="Anything the team should know"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !valid}>
            {busy ? 'Saving…' : game ? 'Save game' : 'Add game'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
