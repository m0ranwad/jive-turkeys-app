import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, Phone, UserPlus } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { Formation } from '@/components/team/Formation';
import { GuestDialog } from '@/components/team/GuestDialog';
import { InviteDialog, PickPositionCard } from '@/components/team/TeamDialogs';
import { useToast } from '@/components/ui/toast';
import { useSeasonData } from '@/hooks/useSeasonData';
import { STATUS_CLASS, STATUS_LABEL, STATUS_OPTIONS } from '@/lib/constants';
import { copyText } from '@/lib/clipboard';
import { guestAsPlayer } from '@/lib/dues';
import { initials } from '@/lib/format';
import { sameName } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const STATUS_ORDER = { active: 0, sub_pool: 1, on_break: 2 };
const SECTION_LABEL = 'px-1 pt-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400';

function StatusButtons({ current, onPick }) {
  return STATUS_OPTIONS.map((opt) => (
    <button
      key={opt.value}
      onClick={() => onPick(opt.value)}
      className={cn(
        'rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] transition',
        (current || 'active') === opt.value ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
      )}
    >
      {opt.label}
    </button>
  ));
}

export function TeamPage() {
  const data = useSeasonData();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  // Teammates who aren't on the app: on the roster like everyone else. `guestDialog` is null, 'new' or a guest.
  const [guests, setGuests] = useState([]);
  const [guestDialog, setGuestDialog] = useState(null);

  const loadGuests = useCallback(async () => {
    try {
      setGuests(await api.entities.TeamGuest.list('display_name'));
    } catch {
      setGuests([]);
    }
  }, []);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  const roster = useMemo(
    () =>
      [...(data.profiles || []), ...guests.map(guestAsPlayer).filter((g) => g.status !== 'inactive')].sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.display_name.localeCompare(b.display_name),
      ),
    [data.profiles, guests],
  );

  const totals = useMemo(() => {
    const active = roster.filter((p) => p.status === 'active');
    return {
      notJoined: roster.filter((p) => p.guest).length,
      active: active.length,
      onBreak: roster.filter((p) => p.status === 'on_break').length,
      subPool: roster.filter((p) => p.status === 'sub_pool').length,
      women: active.filter((p) => p.gender === 'F').length,
      men: active.filter((p) => p.gender === 'M').length,
    };
  }, [roster]);

  if (data.loading) return <PageSpinner />;

  // Players on the site first, then everyone still to join, under the invite.
  const joined = roster.filter((p) => !p.guest);
  const notJoined = roster.filter((p) => p.guest);

  const setStatus = async (profile, status) => {
    try {
      if (profile.guest) {
        await api.entities.TeamGuest.update(profile.id, { status });
        await loadGuests();
      } else {
        await api.entities.PlayerProfile.update(profile.id, { status });
        await data.reload();
      }
      toast({ title: `${profile.display_name} marked ${STATUS_LABEL[status]}` });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    }
  };

  // A nudge for the group text, naming everyone still to join.
  const copyInvite = async () => {
    const names = roster.filter((p) => p.guest).map((p) => p.display_name);
    await copyText(
      [
        "🦃 You're on the Jive Turkeys roster! Join the team site:",
        window.location.origin,
        'Sign up with Google or email, then pick your name from the list. Your spot and dues are already there.',
        `Still to join: ${names.join(', ')}`,
      ].join('\n'),
    );
    toast({ title: 'Invite copied', description: 'Paste it into the team group text.' });
  };

  const toggleCaptain = async (profile) => {
    const role = profile.is_captain ? 'user' : 'admin';
    try {
      // The captain badge on the profile follows the account role.
      await api.users.setRole(profile.user_id, role);
      await data.reload();
      toast({
        title: role === 'admin' ? `${profile.display_name} is now a captain` : `${profile.display_name} is back to a player`,
      });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    }
  };

  // One roster card: an app player, or a grey dashed one for a teammate who hasn't joined yet.
  const rosterCard = (p) => {
    const isMe = p.user_id === data.user.id;
    // Captains: someone on the app with a name like this one probably joined without picking it.
    const joinedAs = p.guest && data.isCaptain ? (data.profiles || []).find((a) => sameName(a.display_name, p.display_name)) : null;
    return (
      <div
        key={p.id}
        className={cn(
          'rounded-3xl p-3.5',
          // Not joined yet: a grey dashed outline.
          p.guest ? 'border-2 border-dashed border-zinc-300 bg-zinc-50' : 'border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-xs font-extrabold uppercase',
              p.guest
                ? 'border-2 border-dashed border-zinc-300 bg-white text-zinc-400'
                : p.gender === 'F'
                  ? 'bg-lime-400 text-black'
                  : 'bg-zinc-900 text-lime-400',
            )}
          >
            {initials(p.display_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-sm font-extrabold uppercase tracking-tight">{p.display_name}</span>
              {isMe && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">
                  You
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-semibold text-zinc-500">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]',
                  STATUS_CLASS[p.status] || STATUS_CLASS.active,
                )}
              >
                {STATUS_LABEL[p.status] || 'Active'}
              </span>
              <span className={cn(!p.position && 'text-zinc-400')}>{p.position || 'Floater'}</span>
              {p.guest && (
                <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-500">
                  Not joined yet
                </span>
              )}
              {p.year_joined && <span>Since {p.year_joined}</span>}
              {p.is_captain && (
                <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-lime-400">
                  Captain
                </span>
              )}
            </div>
          </div>
          {p.phone && (
            <a
              href={`tel:${p.phone}`}
              aria-label={`Call ${p.display_name}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
        {joinedAs && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
            Joined as {joinedAs.display_name}? Tap Edit to move this spot to their account.
          </p>
        )}
        {(isMe || data.isCaptain) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-3">
            {isMe && (
              <span className="mr-1 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">My status</span>
            )}
            <StatusButtons current={p.status} onPick={(status) => setStatus(p, status)} />
            {p.guest && data.isCaptain && (
              <button
                onClick={() => setGuestDialog(guests.find((g) => g.id === p.id))}
                aria-label={`Edit ${p.display_name}`}
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-zinc-500 transition hover:bg-zinc-200"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
            {!isMe && !p.guest && data.isCaptain && (
              <button
                onClick={() => toggleCaptain(p)}
                className={cn(
                  'ml-auto rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] transition',
                  p.is_captain ? 'bg-lime-400 text-black' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
                )}
              >
                {p.is_captain ? 'Captain ✓' : 'Make captain'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        subtitle={`${totals.active} active · ${totals.subPool + totals.onBreak} subs (incl. on break)${
          totals.notJoined ? ` · ${totals.notJoined} not joined yet` : ''
        }`}
      >
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
        >
          <UserPlus className="h-3.5 w-3.5" /> Invite teammate
        </button>
      </PageHeader>

      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'Active', v: totals.active, tone: 'bg-lime-400 text-black' },
          { l: 'Women', v: totals.women, tone: 'bg-zinc-950 text-lime-400' },
          { l: 'Men', v: totals.men, tone: 'bg-zinc-100 text-zinc-600' },
        ].map((tile) => (
          <div key={tile.l} className={cn('rounded-2xl px-3 py-3', tile.tone)}>
            <div className="font-display text-xl font-extrabold leading-none">{tile.v}</div>
            <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{tile.l}</div>
          </div>
        ))}
      </div>

      {data.profile && <PickPositionCard profile={data.profile} onSaved={data.reload} />}
      {/* Teammates who haven't joined only show on the field once a captain sets their position. */}
      <Formation players={roster.filter((p) => !p.guest || p.position)} />

      <p className="rounded-2xl bg-lime-50 px-4 py-3 text-xs font-semibold text-lime-900">
        Set your own roster status anytime — On Break puts you in the sub pool for call-ups. Captains can adjust anyone's
        status too, including teammates who haven't joined yet. Active players split the dues.
      </p>

      <section className="space-y-2">
        {joined.length > 0 && <h3 className={SECTION_LABEL}>On the site · {joined.length}</h3>}
        {joined.map(rosterCard)}
        {roster.length === 0 && (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            No players yet. Teammates appear here once they sign up.
          </div>
        )}
      </section>

      {notJoined.length > 0 && (
        <section className="space-y-2">
          <div className="rounded-3xl border-2 border-dashed border-zinc-300 bg-white p-4" data-testid="not-joined">
            <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
              {notJoined.length} {notJoined.length === 1 ? "hasn't" : "haven't"} joined yet
            </h3>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              On the roster and in the dues, but not signed up yet. When they do, they pick their name and their spot and
              dues come with them.
            </p>
            <button
              onClick={copyInvite}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy invite
            </button>
          </div>
          {notJoined.map(rosterCard)}
        </section>
      )}

      {data.isCaptain && (
        <button
          onClick={() => setGuestDialog('new')}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-zinc-300 bg-white py-4 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:border-zinc-900 hover:text-black"
        >
          <UserPlus className="h-4 w-4" />
          Add players to the roster
        </button>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} isCaptain={data.isCaptain} />
      {data.isCaptain && (
        <GuestDialog
          open={!!guestDialog}
          onOpenChange={(open) => !open && setGuestDialog(null)}
          guest={guestDialog === 'new' ? null : guestDialog}
          guests={guests}
          appPlayers={[...(data.profiles || [])].sort((a, b) => a.display_name.localeCompare(b.display_name))}
          meId={data.user.id}
          onChanged={async () => {
            await loadGuests();
            await data.reload();
          }}
        />
      )}
    </div>
  );
}
