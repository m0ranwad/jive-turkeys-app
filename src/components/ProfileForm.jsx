import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POSITIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function ProfileForm({ initial, onSubmit, submitLabel = 'Save profile', busy = false, hidePosition = false }) {
  const id = useId();
  const [form, setForm] = useState({
    display_name: initial?.display_name || '',
    gender: initial?.gender || '',
    phone: initial?.phone || '',
    position: initial?.position || '',
    year_joined: initial?.year_joined || '',
  });
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.display_name.trim()) return setError('Add your display name.');
    if (!form.gender) return setError("Pick male or female — it's only used for coed headcount.");
    setError('');
    try {
      await onSubmit({
        display_name: form.display_name.trim(),
        gender: form.gender,
        phone: form.phone.trim(),
        position: form.position || null,
        year_joined: form.year_joined ? Number(form.year_joined) : null,
      });
    } catch (err) {
      setError(err.message || "Couldn't save your profile.");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${id}-display_name`}>Display name</Label>
        <Input
          id={`${id}-display_name`}
          value={form.display_name}
          onChange={(e) => set({ display_name: e.target.value })}
          placeholder="What the team calls you"
        />
      </div>

      <div className="space-y-2">
        <Label>Gender</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: 'M', l: 'Male' },
            { v: 'F', l: 'Female' },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => set({ gender: opt.v })}
              className={cn(
                'rounded-2xl border-2 py-3 text-sm font-bold uppercase tracking-wide transition',
                form.gender === opt.v
                  ? 'border-black bg-lime-400 text-black'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300',
              )}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">Used only for coed headcount rules.</p>
      </div>

      <div className={cn('grid gap-5', !hidePosition && 'sm:grid-cols-2')}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-phone`}>Phone (optional)</Label>
          <Input
            id={`${id}-phone`}
            type="tel"
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="(555) 555-5555"
          />
          <p className="text-xs text-zinc-500">Visible to logged-in teammates only.</p>
        </div>
        {!hidePosition && (
          <div className="space-y-2">
            <Label>Preferred position (optional)</Label>
            <Select value={form.position || 'none'} onValueChange={(v) => set({ position: v === 'none' ? '' : v })}>
              <SelectTrigger>
                <SelectValue placeholder="Anywhere" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2 sm:max-w-[50%]">
        <Label htmlFor={`${id}-year_joined`}>Year joined (optional)</Label>
        <Input
          id={`${id}-year_joined`}
          type="number"
          inputMode="numeric"
          value={form.year_joined}
          onChange={(e) => set({ year_joined: e.target.value })}
          placeholder="2015"
        />
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}

      <Button type="submit" disabled={busy} className="h-12 w-full text-sm font-bold uppercase tracking-[0.12em]">
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
