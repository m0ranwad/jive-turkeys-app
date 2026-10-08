import { useState } from 'react';
import { CircleHelp, LogOut } from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { ProfileForm } from '@/components/ProfileForm';
import { Walkthrough } from '@/components/Walkthrough';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { signOut } from '@/lib/actions';
import { CARD, STATUS_LABEL, STATUS_OPTIONS } from '@/lib/constants';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const softButton =
  'inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.12em] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:bg-zinc-50';

export function ProfilePage() {
  const { user, profile, isCaptain, loading, reload } = useTeam();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  if (loading) return <PageSpinner />;

  const saveProfile = async (values) => {
    setBusy(true);
    try {
      if (profile) await api.entities.PlayerProfile.update(profile.id, values);
      else await api.entities.PlayerProfile.create({ ...values, user_id: user.id, email: user.email, status: 'active' });
      await reload();
      toast({ title: 'Profile saved' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!profile) return;
    setBusy(true);
    try {
      await api.entities.PlayerProfile.update(profile.id, { status });
      await reload();
      toast({ title: `You're now ${STATUS_LABEL[status]}` });
    } finally {
      setBusy(false);
    }
  };

  const name = profile?.display_name || user?.full_name || 'Player';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-zinc-950 p-5 text-white">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              'grid h-14 w-14 shrink-0 place-items-center rounded-full font-display text-lg font-black',
              profile?.gender === 'F' ? 'bg-lime-400 text-black' : 'bg-white/10 text-lime-400',
            )}
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-extrabold uppercase tracking-tight">{name}</h1>
            <p className="mt-0.5 truncate text-xs font-medium text-white/50">{user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-lime-400 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-black">
                {isCaptain ? 'Captain' : 'Player'}
              </span>
              {profile?.status && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/70">
                  {STATUS_LABEL[profile.status]}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
          {profile ? 'Your details' : 'Set up your profile'}
        </h2>
        <p className="mb-4 mt-1 text-xs font-medium text-zinc-500">Your phone number is visible only to logged-in teammates.</p>
        <ProfileForm key={profile?.id || 'new'} initial={profile} onSubmit={saveProfile} busy={busy} />
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <button onClick={() => setWalkthroughOpen(true)} className={cn(softButton, 'text-zinc-700')}>
          <CircleHelp className="h-4 w-4" /> How to use
        </button>
        <button onClick={signOut} className={cn(softButton, 'text-zinc-500')}>
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      {profile && (
        <section className={CARD}>
          <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Roster status</h2>
          <p className="mb-3 mt-1 text-xs font-medium text-zinc-500">
            Set this anytime. On Break puts you in the sub pool for call-ups.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                disabled={busy}
                className={cn(
                  'rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.08em] transition disabled:opacity-50',
                  (profile.status || 'active') === opt.value ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <Walkthrough open={walkthroughOpen} needsProfile={false} profile={profile} onClose={() => setWalkthroughOpen(false)} />
    </div>
  );
}
