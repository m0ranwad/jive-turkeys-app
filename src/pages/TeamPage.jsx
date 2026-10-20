import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CalendarPlus, Copy, MessageCircle, Pencil, Phone, UserPlus } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { SessionRosterDialog } from '@/components/dues/SessionRosterDialog';
import { AskSessionDialog } from '@/components/team/AskSessionDialog';
import { Formation } from '@/components/team/Formation';
import { GuestDialog } from '@/components/team/GuestDialog';
import { PickPositionCard, RemovePlayerDialog, UnlinkGuestDialog } from '@/components/team/TeamDialogs';
import { useToast } from '@/components/ui/toast';
import { useSeasonData } from '@/hooks/useSeasonData';
import { CARD, STATUS_CLASS, STATUS_LABEL, STATUS_OPTIONS } from '@/lib/constants';
import { copyText } from '@/lib/clipboard';
import { saveFailedToast } from '@/lib/errors';
import { guestAsPlayer, stepSession } from '@/lib/dues';
import { fmtDateShort, initials, today } from '@/lib/format';
import { askFor, beforeFirstGame, entryFor, isEarlier, sessionRows, stillAsking, unanswered } from '@/lib/roster';
import { codeIsStale } from '@/lib/team-code';
import { likelyAccount, lookalikeAccounts, nameList, skippedRosterName } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const STATUS_ORDER = { active: 0, sub_pool: 1, on_break: 2 };
const SECTION_LABEL = 'px-1 pt-1 text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500';

function StatusButtons({ current, onPick }) {
  return STATUS_OPTIONS.map((opt) => (
    <button
      key={opt.value}
      aria-pressed={(current || 'active') === opt.value}
      onClick={() => onPick(opt.value)}
      className={cn(
        'rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] transition',
        (current || 'active') === opt.value ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
      )}
    >
      {opt.label}
    </button>
  ));
}

export function TeamPage() {
  const data = useSeasonData();
  const { toast } = useToast();
  // Teammates who aren't on the app: on the roster like everyone else. `guestDialog` is null, 'new' or a guest.
  const [guests, setGuests] = useState([]);
  const [guestDialog, setGuestDialog] = useState(null);
  // Which account picked which name (team_guest_links), so captains can undo a wrong pick, and
  // captains' answers to the name checks below (team_name_checks).
  const [links, setLinks] = useState([]);
  const [checks, setChecks] = useState([]);
  // Captains: the signed-up player being removed, and the pick being undone ({ guest, player }).
  const [removing, setRemoving] = useState(null);
  const [unlinking, setUnlinking] = useState(null);
  // Captains: asking who's playing a later session, and answering it for teammates.
  const [askOpen, setAskOpen] = useState(false);
  const [answersOpen, setAnswersOpen] = useState(false);

  const loadGuests = useCallback(async () => {
    // Together, so a grey card never shows before we know which accounts it was taken off.
    const [rows, picks, answers] = await Promise.all([
      api.entities.TeamGuest.list('display_name').catch(() => []),
      api.entities.TeamGuestLink.list().catch(() => []),
      api.entities.TeamNameCheck.list().catch(() => []),
    ]);
    setGuests(rows);
    setLinks(picks);
    setChecks(answers);
  }, []);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  // The team code new players enter, for the invite. Null before the database has team codes.
  const [joinCode, setJoinCode] = useState(null);
  useEffect(() => {
    api.entities.TeamJoinCode.list()
      .then((rows) => setJoinCode(rows[0] || null))
      .catch(() => setJoinCode(null));
  }, []);

  const roster = useMemo(
    () =>
      // Removed players and roster names are off the roster.
      [...(data.profiles || []), ...guests.map(guestAsPlayer)].filter((p) => p.status !== 'inactive').sort(
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

  const removedPlayers = data.isCaptain ? (data.profiles || []).filter((p) => p.removed) : [];
  // Captains: the roster name an account picked (or was linked to), and whether that can be undone here.
  const pickedName = (p) => (data.isCaptain && !p.guest ? guests.find((g) => g.linked_user_id === p.user_id) || null : null);
  const canUnlink = (name) => !!name && links.some((l) => l.guest_id === name.id && l.user_id === name.linked_user_id && !l.unlinked_at);
  // Captains answer a name check once, for every captain.
  const answerCheck = async (rows, title) => {
    try {
      await api.entities.TeamNameCheck.bulkCreate(rows.map((r) => ({ other_user_id: null, ...r, checked_by: data.user.id })));
      await loadGuests();
      toast({ title });
    } catch (err) {
      toast(saveFailedToast(err));
    }
  };
  const addBack = async (profile) => {
    try {
      await api.users.setRemoved(profile.user_id, false);
      await data.reload();
      toast({ title: `${profile.display_name} added back`, description: 'They can use the team site again.' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    }
  };

  // Before a new session's first game, captains see who hasn't said if they're playing.
  const current = data.roster?.current;
  const asking = !!current && data.isCaptain && beforeFirstGame(data.games, current, today());
  const onList = (rows) => rows.map((r) => roster.find((p) => p.user_id === (r.user_id ?? r.guest_id))).filter(Boolean);
  const sessionTeam = asking ? onList(sessionRows(data.roster.rows, current).filter((r) => r.status !== 'off')) : [];
  const waiting = asking ? onList(unanswered(data.roster.rows, current)) : [];

  // A session captains asked about ahead ("Playing session N?" before its schedule is out, or while
  // this one has games left), still being asked; or the session they can ask about next.
  const asks = data.roster?.asks || [];
  const askedPeriod =
    current && data.isCaptain
      ? asks
          .map((a) => ({ year: a.season_year, session: a.session }))
          .filter((p) => askFor(asks, p) && !isEarlier(p, current) && !(asking && !isEarlier(current, p)))
          .filter((p) => stillAsking(data.games, p, today(), askFor(asks, p).starts_on))
          .sort((a, b) => (isEarlier(a, b) ? -1 : 1))[0]
      : null;
  const asked = askedPeriod ? askFor(asks, askedPeriod) : null;
  const nextPeriod = current && data.isCaptain && !askedPeriod ? stepSession(current, 1) : null;
  // Everyone on the team, with their answer for the asked session (anyone not on its list yet carries over).
  const askedTeam = askedPeriod
    ? roster
        .map((p) => ({ player: p, entry: entryFor(data.roster.rows, askedPeriod, p.user_id) }))
        .filter(({ entry }) => entry?.status !== 'off')
    : [];
  const askedWaiting = askedTeam.filter(({ entry }) => !entry?.answered_at).map(({ player }) => player);

  const setStatus = async (profile, status) => {
    try {
      if (profile.guest) {
        await api.entities.TeamGuest.update(profile.id, { status });
        // The session's list changed too (who has answered for this session).
        await Promise.all([loadGuests(), data.reload()]);
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
        joinCode
          ? `Sign up with Google or email, enter the team code ${joinCode.code}, then pick your name from the list. Your spot and dues are already there.`
          : 'Sign up with Google or email, then pick your name from the list. Your spot and dues are already there.',
        names.length ? `Still to join: ${names.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
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

  // One roster card: a player on the site, or a grey dashed one for a teammate who hasn't joined yet.
  const rosterCard = (p) => {
    const isMe = p.user_id === data.user.id;
    // Captains: someone on the app with a name like this one probably joined without picking it.
    const joinedAs = p.guest && data.isCaptain ? likelyAccount(p, data.profiles || [], guests, links) : null;
    // Captains: the roster name this account came with, other accounts that look like the same
    // person, and whether they joined without picking a roster name while names were waiting.
    const picked = pickedName(p);
    const lookalikes = data.isCaptain && !p.guest ? lookalikeAccounts(p, joined, guests, checks) : [];
    const lookalikeNames = nameList(lookalikes.map((o) => o.display_name));
    const skipped = data.isCaptain && !p.guest && skippedRosterName(p, guests, checks);
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
                ? 'border-2 border-dashed border-zinc-300 bg-white text-zinc-600'
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
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600">
                  You
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-semibold text-zinc-500">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.1em]',
                  STATUS_CLASS[p.status] || STATUS_CLASS.active,
                )}
              >
                {STATUS_LABEL[p.status] || 'Active'}
              </span>
              <span className={cn(!p.position && 'text-zinc-500')}>{p.position || 'Floater'}</span>
              {p.guest && (
                <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] text-zinc-500">
                  Not joined yet
                </span>
              )}
              {p.year_joined && <span>Since {p.year_joined}</span>}
              {p.is_captain && (
                <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] text-lime-400">
                  Captain
                </span>
              )}
            </div>
          </div>
          {/* A private chat with them (opens the one you already have, if there is one). */}
          {!isMe && !p.guest && p.user_id && (
            <Link
              to={`/banter?dm=${p.user_id}`}
              aria-label={`Message ${p.display_name}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200"
            >
              <MessageCircle className="h-4 w-4" />
            </Link>
          )}
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
        {lookalikes.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900" data-testid="two-accounts">
            <p>
              {lookalikes.length === 1
                ? `Two accounts? ${lookalikeNames} looks like the same person. If so, keep the one they sign in with and remove the other.`
                : `More than one account? ${lookalikeNames} look like the same person. If so, keep the one they sign in with and remove the others.`}
            </p>
            <button
              onClick={() =>
                answerCheck(
                  lookalikes.map((o) => ({ kind: 'different_people', user_id: p.user_id, other_user_id: o.user_id })),
                  `Got it: ${p.display_name} and ${lookalikeNames} are different people`,
                )
              }
              aria-label={`They're different people: ${p.display_name} and ${lookalikeNames}`}
              className="mt-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-amber-900 transition hover:bg-amber-100"
            >
              They're different people
            </button>
          </div>
        )}
        {skipped && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900" data-testid="no-roster-name">
            <p>
              Didn't pick a roster name. If they're one of the grey cards, tap Edit on that card to move it to this
              account.
            </p>
            <button
              onClick={() => answerCheck([{ kind: 'not_on_roster', user_id: p.user_id }], `Got it: ${p.display_name} isn't on the roster`)}
              aria-label={`Not on the roster: ${p.display_name}`}
              className="mt-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-amber-900 transition hover:bg-amber-100"
            >
              Not on the roster
            </button>
          </div>
        )}
        {picked && (
          <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-500" data-testid="joined-as">
            <span className="min-w-0 flex-1">
              Joined as <b className="text-zinc-700">{picked.display_name}</b>
              {!canUnlink(picked) && ' · picked before undo was added'}
            </span>
            {canUnlink(picked) && (
              <button
                onClick={() => setUnlinking({ guest: picked, player: p })}
                aria-label={`Unlink ${picked.display_name} from ${p.display_name}`}
                className="shrink-0 rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-600 transition hover:bg-zinc-200"
              >
                Unlink
              </button>
            )}
          </div>
        )}
        {(isMe || data.isCaptain) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-3">
            {isMe && (
              <span className="mr-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">My status</span>
            )}
            <StatusButtons current={p.status} onPick={(status) => setStatus(p, status)} />
            {p.guest && data.isCaptain && (
              <button
                onClick={() => setGuestDialog(guests.find((g) => g.id === p.id))}
                aria-label={`Edit ${p.display_name}`}
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-600 transition hover:bg-zinc-200"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
            {!isMe && !p.guest && data.isCaptain && (
              <button
                onClick={() => toggleCaptain(p)}
                className={cn(
                  'ml-auto rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] transition',
                  p.is_captain ? 'bg-lime-400 text-black' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                )}
              >
                {p.is_captain ? 'Captain ✓' : 'Make captain'}
              </button>
            )}
            {!isMe && !p.guest && data.isCaptain && (
              <button
                onClick={() => setRemoving(p)}
                aria-label={`Remove ${p.display_name}`}
                className="rounded-full px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-red-700 underline-offset-2 transition hover:underline"
              >
                Remove
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
        subtitle={`${current ? `Session ${current.session} · ` : ''}${totals.active} active · ${totals.subPool + totals.onBreak} subs (incl. on break)${
          totals.notJoined ? ` · ${totals.notJoined} not joined yet` : ''
        }`}
      >
        {/* Emailed invites aren't switched on yet (idea #1), so new players get the site and the team code. */}
        <button
          onClick={copyInvite}
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
        >
          <Copy className="h-3.5 w-3.5" /> Copy invite
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
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em]">{tile.l}</div>
          </div>
        ))}
      </div>

      {waiting.length > 0 && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4" data-testid="session-answers">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em] text-amber-950">
            Playing session {current.session}? · {sessionTeam.length - waiting.length} of {sessionTeam.length} answered
          </h3>
          <p className="mt-1 text-xs font-medium text-amber-900">
            Still to answer: {waiting.map((p) => p.display_name).join(', ')}. If they don't, their status carries over.
            Tap a status below to answer for someone.
          </p>
          {codeIsStale(joinCode, data.roster) && (
            <p className="mt-2 text-xs font-semibold text-amber-950" data-testid="team-code-stale">
              New session: change the team code in{' '}
              <Link to="/settings" className="underline underline-offset-2">
                Team Settings
              </Link>{' '}
              so invites from before stop working.
            </p>
          )}
        </section>
      )}

      {askedPeriod && (
        <section className={CARD} data-testid="session-ask">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
            Playing session {askedPeriod.session}? · {askedTeam.length - askedWaiting.length} of {askedTeam.length} answered
          </h3>
          <p className="mt-1 text-xs font-medium text-zinc-600">
            Asked ahead · starts {fmtDateShort(asked.starts_on)}. Answers only count for session {askedPeriod.session}.
            {askedWaiting.length > 0
              ? ` Still to answer: ${askedWaiting.map((p) => p.display_name).join(', ')}.`
              : ' Everyone has answered.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAnswersOpen(true)}
              className="rounded-full bg-zinc-950 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-white transition hover:bg-zinc-800"
            >
              Answer for someone
            </button>
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              className="rounded-full bg-zinc-100 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-700 transition hover:bg-zinc-200"
            >
              Change date
            </button>
          </div>
        </section>
      )}
      {nextPeriod && (
        <button
          type="button"
          onClick={() => setAskOpen(true)}
          className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-left transition hover:border-zinc-900"
        >
          <CalendarPlus className="h-4 w-4 shrink-0 text-zinc-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-[0.1em]">Ask who's playing session {nextPeriod.session}</span>
            <span className="block text-[11px] font-medium text-zinc-500">Before its schedule is out, or with games still left.</span>
          </span>
        </button>
      )}

      {data.profile && <PickPositionCard profile={data.profile} onSaved={data.reload} />}
      {/* Teammates who haven't joined only show on the field once a captain sets their position. */}
      <Formation players={roster.filter((p) => !p.guest || p.position)} />

      <p className="rounded-2xl bg-lime-50 px-4 py-3 text-xs font-semibold text-lime-900">
        Set your own roster status anytime{current ? ` — it counts for session ${current.session}` : ''}. On Break puts
        you in the sub pool for call-ups. Captains can adjust anyone's status too, including teammates who haven't joined
        yet. Active players split the dues.
      </p>

      <div className="space-y-2">
        {joined.length > 0 && <h3 className={SECTION_LABEL}>On the site · {joined.length}</h3>}
        {joined.map(rosterCard)}
        {roster.length === 0 && (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            No players yet. Teammates appear here once they sign up.
          </div>
        )}
      </div>

      {notJoined.length > 0 && (
        <div className="space-y-2">
          <section className="rounded-3xl border-2 border-dashed border-zinc-300 bg-white p-4" data-testid="not-joined">
            <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
              {notJoined.length} {notJoined.length === 1 ? "hasn't" : "haven't"} joined yet
            </h3>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              {/* Sub Pool and On Break names are listed here too, and they don't share the dues. */}
              Already on the roster, but {notJoined.length === 1 ? "hasn't" : "haven't"} signed up yet. Active players
              share the dues. When they sign up, they pick their name and their spot and dues come with them.
            </p>
            <button
              onClick={copyInvite}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy invite
            </button>
          </section>
          {notJoined.map(rosterCard)}
        </div>
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

      {removedPlayers.length > 0 && (
        <section className="rounded-3xl border border-black/5 bg-white p-4" data-testid="removed-players">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em] text-zinc-500">Removed from the team</h3>
          <p className="mt-1 text-xs font-medium text-zinc-500">Only captains see this. They can't use the team site until you add them back.</p>
          <div className="mt-3 space-y-2">
            {removedPlayers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{p.display_name}</span>
                <button
                  onClick={() => addBack(p)}
                  className="rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-600 transition hover:bg-zinc-200"
                >
                  Add back
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.isCaptain && (
        <GuestDialog
          open={!!guestDialog}
          onOpenChange={(open) => !open && setGuestDialog(null)}
          guest={guestDialog === 'new' ? null : guestDialog}
          guests={guests}
          links={links}
          appPlayers={(data.profiles || []).filter((p) => !p.removed).sort((a, b) => a.display_name.localeCompare(b.display_name))}
          meId={data.user.id}
          onChanged={async () => {
            await loadGuests();
            await data.reload();
          }}
        />
      )}
      {data.isCaptain && (
        <RemovePlayerDialog
          player={removing}
          pickedName={removing && pickedName(removing)}
          canUnlink={!!removing && canUnlink(pickedName(removing))}
          onOpenChange={(open) => !open && setRemoving(null)}
          onRemoved={data.reload}
        />
      )}
      {data.isCaptain && (
        <UnlinkGuestDialog
          unlinking={unlinking}
          onOpenChange={(open) => !open && setUnlinking(null)}
          onUnlinked={async () => {
            await loadGuests();
            await data.reload();
          }}
        />
      )}
      {data.isCaptain && (
        <AskSessionDialog
          open={askOpen}
          onOpenChange={setAskOpen}
          period={askedPeriod || nextPeriod}
          ask={asked}
          onSaved={data.reload}
        />
      )}
      {askedPeriod && (
        <SessionRosterDialog
          open={answersOpen}
          onOpenChange={setAnswersOpen}
          period={askedPeriod}
          members={roster}
          rows={data.roster.rows}
          meId={data.user?.id}
          onSaved={async () => {
            await loadGuests();
            await data.reload();
          }}
          ahead
          current={!isEarlier(current, askedPeriod)}
        />
      )}
    </div>
  );
}
