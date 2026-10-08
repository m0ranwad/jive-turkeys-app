import { useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { POSITIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Nudge shown on the Team page until you've picked a position. */
export function PickPositionCard({ profile, onSaved }) {
  const [position, setPosition] = useState('');
  const [busy, setBusy] = useState(false);
  if (!profile || profile.position) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.entities.PlayerProfile.update(profile.id, { position: position || null });
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border-2 border-lime-400 bg-lime-50 p-4">
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.1em] text-lime-900">Pick your spot</h3>
      <p className="mt-1 text-xs font-medium text-lime-900/80">
        Where do you like to play? Captains use this for lineups. You can change it anytime on your profile.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={position || 'none'} onValueChange={(v) => setPosition(v === 'none' ? '' : v)}>
          <SelectTrigger className="h-10 w-44 rounded-2xl border-lime-300 bg-white">
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
        <button
          onClick={save}
          disabled={busy || !position}
          className="rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function InviteDialog({ open, onOpenChange, isCaptain }) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter a valid email address.');
    setBusy(true);
    setError('');
    try {
      await api.users.invite(address, isCaptain ? role : 'user');
      toast({ title: 'Invite sent', description: `${address} can join the team app.` });
      setEmail('');
      onOpenChange(false);
    } catch {
      setError("That invite didn't go through — they may already be on the team. You can also send them the site link to sign up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Invite a teammate</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Their email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@email.com"
            />
          </div>
          {isCaptain && (
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: 'user', l: 'Player' },
                  { v: 'admin', l: 'Captain' },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setRole(opt.v)}
                    className={cn(
                      'rounded-2xl border-2 py-3 text-xs font-bold uppercase tracking-[0.08em] transition',
                      role === opt.v ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs font-medium text-zinc-500">
            They'll get an email invite. Once they sign in they set up their own profile and can RSVP right away.
          </p>
          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
