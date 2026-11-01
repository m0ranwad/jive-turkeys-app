import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { POSITIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

// Asked at sign-up of someone who isn't a roster name, with nothing picked in advance: a fan or a
// partner who signs up to follow along shouldn't land in the dues split without knowing it.
const JOIN_STATUSES = [
  { value: 'active', label: 'Playing', hint: 'On the team this session. You split the dues.' },
  { value: 'sub_pool', label: 'Available to sub', hint: "We'll ask when we're short." },
  { value: 'on_break', label: 'Just following along', hint: "Fan, partner or friend. You'll show as Unavailable and won't split the dues." },
];

export function ProfileForm({
  initial,
  onSubmit,
  submitLabel = 'Save profile',
  busy = false,
  hidePosition = false,
  hideYearJoined = false,
  askStatus = false,
}) {
  const id = useId();
  const [form, setForm] = useState({
    display_name: initial?.display_name || '',
    gender: initial?.gender || '',
    phone: initial?.phone || '',
    position: initial?.position || '',
    year_joined: initial?.year_joined || '',
    status: (askStatus && initial?.status) || '',
  });
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.display_name.trim()) return setError('Add your display name.');
    if (!form.gender) return setError("Pick male or female — it's only used for coed headcount.");
    if (askStatus && !form.status) return setError("Pick whether you're playing.");
    setError('');
    try {
      await onSubmit({
        display_name: form.display_name.trim(),
        gender: form.gender,
        phone: form.phone.trim(),
        position: form.position || null,
        year_joined: form.year_joined ? Number(form.year_joined) : null,
        ...(askStatus ? { status: form.status } : {}),
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
              aria-pressed={form.gender === opt.v}
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
        <p className="text-xs text-zinc-500">For coed headcounts.</p>
      </div>

      {askStatus && (
        <div className="space-y-2">
          <Label id={`${id}-status`}>Are you playing?</Label>
          <div role="group" aria-labelledby={`${id}-status`} className="grid gap-2">
            {JOIN_STATUSES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={form.status === opt.value}
                onClick={() => set({ status: opt.value })}
                className={cn(
                  'rounded-2xl border-2 px-4 py-3 text-left transition',
                  form.status === opt.value ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 bg-white hover:border-zinc-300',
                )}
              >
                <span className="block text-sm font-bold uppercase tracking-wide">{opt.label}</span>
                <span className={cn('mt-0.5 block text-xs', form.status === opt.value ? 'text-black' : 'text-zinc-600')}>
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">You can change it any time on My Profile.</p>
        </div>
      )}

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
          <p className="text-xs text-zinc-500">Only teammates see this.</p>
        </div>
        {!hidePosition && (
          <div className="space-y-2">
            <Label htmlFor={`${id}-position`}>Preferred position (optional)</Label>
            <Select value={form.position || 'none'} onValueChange={(v) => set({ position: v === 'none' ? '' : v })}>
              <SelectTrigger id={`${id}-position`}>
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

      {!hideYearJoined && (
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
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <Button type="submit" disabled={busy} className="h-12 w-full text-sm font-bold uppercase tracking-[0.12em]">
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
