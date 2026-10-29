import { Check } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { shortageIsUrgent } from '@/lib/calendar';
import { CARD } from '@/lib/constants';
import { initials, shortName } from '@/lib/format';
import { shortageText } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const spot = 'h-[26px] w-[26px] shrink-0 rounded-full';
const emptySpot = 'box-border border-2 border-dashed';

/**
 * The field as spots (headcount().spots): the goal, the girls' spots and the open ones, then
 * "+N bench". `dark` for the Next game card on Schedule. One picture, so screen readers get one
 * sentence.
 */
export function Spots({ headcount, dark = false, className }) {
  const { goal, girls, open, goalFilled, girlsFilled, openFilled, volunteer, bench } = headcount.spots;
  const caption = cn('mt-1.5 text-[11px] font-bold', dark ? 'text-white/70' : 'text-zinc-600');
  const noKeeper = !volunteer && headcount.totalIn > 0;
  const filled = goalFilled + girlsFilled + openFilled;
  const label = [
    `${filled} of ${goal + girls + open} spots filled`,
    goal ? (volunteer ? 'goal covered' : noKeeper ? 'no goalie yet' : 'goal empty') : null,
    `${girlsFilled} of ${girls} girls' spots`,
    `${openFilled} of ${open} open spots`,
    bench ? `${bench} on the bench` : null,
  ].filter(Boolean);
  const row = (count, filledCount, full, empty) =>
    Array.from({ length: count }, (_, i) => <span key={i} className={cn(spot, i < filledCount ? full : cn(emptySpot, empty))} />);

  return (
    <div role="img" aria-label={label.join(', ')} className={cn('flex items-start gap-3', className)}>
      {goal > 0 && (
        <span
          className={cn(
            'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[11px] font-black',
            volunteer
              ? dark ? 'bg-white text-black' : 'bg-zinc-900 text-white'
              : noKeeper
                ? cn(emptySpot, dark ? 'border-amber-300 text-amber-300' : 'border-amber-600 bg-amber-100 text-amber-800')
                : cn(emptySpot, dark ? 'border-white/40 text-white/70' : 'border-zinc-500 text-zinc-600'),
          )}
        >
          {noKeeper ? '?' : 'GK'}
        </span>
      )}
      {girls > 0 && (
        <div className="flex flex-col">
          <div className="flex gap-[5px]">{row(girls, girlsFilled, dark ? 'bg-lime-400' : 'bg-lime-600', dark ? 'border-lime-400' : 'border-lime-600')}</div>
          <span className={cn(caption, dark ? 'text-lime-300' : 'text-lime-700')}>Girls</span>
        </div>
      )}
      {open > 0 && (
        <div className="flex flex-col">
          <div className="flex gap-[5px]">{row(open, openFilled, dark ? 'bg-white' : 'bg-zinc-900', dark ? 'border-white/40' : 'border-zinc-500')}</div>
          <span className={caption}>Anyone</span>
        </div>
      )}
      {bench > 0 && (
        <div className="flex flex-col items-center">
          <span
            className={cn(
              'flex h-[26px] items-center rounded-full px-2.5 text-xs font-extrabold',
              dark ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-700',
            )}
          >
            +{bench}
          </span>
          <span className={caption}>Bench</span>
        </div>
      )}
    </div>
  );
}

/** "No goalie yet": nobody who's in has said they'll play GK. */
export function NoGoalie({ dark = false, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold',
        dark ? 'border-amber-300/40 bg-amber-300/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800',
        className,
      )}
    >
      No goalie yet
    </span>
  );
}

/** The one headline: grey, red ("Short") within 48 hours of kickoff, lime when the team is full. */
function Status({ game, headcount }) {
  const text = shortageText(headcount);
  if (!text) {
    return (
      <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-lime-400 px-3.5 py-3 text-black">
        <Check className="h-5 w-5 shrink-0" strokeWidth={3} aria-hidden="true" />
        <span className="font-display text-lg font-extrabold tracking-tight">Full team</span>
      </div>
    );
  }
  const urgent = shortageIsUrgent(game);
  return (
    <div className={cn('mt-3.5 flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-3', urgent ? 'bg-red-50' : 'bg-zinc-100')}>
      {urgent && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
          Short
        </span>
      )}
      <span className={cn('font-display text-lg font-extrabold tracking-tight', urgent ? 'text-red-700' : 'text-zinc-900')}>{text}</span>
    </div>
  );
}

/** One player: initials coloured like the Team page, their short name, and GK / Susp tags. */
function Player({ entry, label, suspended, onPick }) {
  const { profile } = entry;
  const girl = profile.gender === 'F';
  const Tag = onPick ? 'button' : 'div';
  return (
    <Tag
      data-player={profile.display_name}
      data-not-joined={profile.guest ? '' : undefined}
      {...(onPick && { type: 'button', onClick: () => onPick(profile) })}
      className={cn(
        'flex min-w-0 flex-col items-center gap-1.5 rounded-2xl py-1',
        onPick && 'transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative grid h-11 w-11 place-items-center rounded-full font-display text-sm font-extrabold uppercase',
          profile.guest
            ? cn('border-2 border-dashed', girl ? 'border-lime-600 bg-lime-50 text-lime-900' : 'border-zinc-400 bg-zinc-100 text-zinc-600')
            : girl
              ? 'bg-lime-400 text-black'
              : 'bg-zinc-900 text-lime-400',
        )}
      >
        {initials(profile.display_name)}
        {entry.playing_gk && (
          <span className="absolute -bottom-1 -right-2 rounded-full border border-zinc-300 bg-white px-1.5 font-sans text-[11px] font-black leading-4 text-zinc-900">
            GK
          </span>
        )}
        {suspended && (
          <span className="absolute -right-2 -top-1 rounded-full bg-red-600 px-1.5 font-sans text-[11px] font-black leading-4 text-white">
            Susp
          </span>
        )}
      </span>
      <span aria-hidden="true" className="max-w-full truncate text-xs font-semibold text-zinc-700">
        {label}
      </span>
      {/* Heard as "RSVP for Dana Wells, girl, not joined yet". */}
      <span className="sr-only">
        {onPick && 'RSVP for '}
        {profile.display_name}
        {girl && ', girl'}
        {profile.guest && ', not joined yet'}
        {entry.playing_gk && ', GK'}
        {suspended && ', suspended'}
      </span>
    </Tag>
  );
}

function Group({ label, group, entries, labelOf, suspendedIds, onPick }) {
  if (!entries.length) return null;
  return (
    <div data-group={group}>
      <div className="text-xs font-bold text-zinc-600">
        {label} · {entries.length}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-x-1 gap-y-2.5">
        {entries.map((entry) => (
          <Player
            key={entry.profile.user_id}
            entry={entry}
            label={labelOf(entry.profile)}
            suspended={suspendedIds.includes(entry.profile.user_id)}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

const TAB = 'min-h-10 rounded-full text-[13px] font-bold text-zinc-600 data-[state=active]:bg-white data-[state=active]:text-zinc-900';

/**
 * Who's coming to a game: the spots, one headline, "No goalie yet" when nobody has said they'll
 * play GK, then who's In, Not in yet and Out. `onPick` (captains): tap a name to set that player's
 * RSVP. `me`: the viewer, shown as "You". `bare`: just who said they were in, inside something else
 * (a played game's folded list).
 */
export function HeadcountPanel({ game, headcount, suspendedIds = [], onPick = null, me = null, bare = false }) {
  const { groups } = headcount;
  const everyone = Object.values(groups).flat();
  // Short names ("Jordan R."), unless two people would share one.
  const shorts = new Map();
  everyone.forEach((e) => {
    const short = shortName(e.profile.display_name);
    shorts.set(short, (shorts.get(short) || 0) + 1);
  });
  const labelOf = (p) => {
    const short = shortName(p.display_name);
    return p.user_id === me ? 'You' : shorts.get(short) > 1 ? p.display_name : short;
  };
  const shared = { labelOf, suspendedIds, onPick };
  const girlsIn = groups.in.filter((e) => e.profile.gender === 'F');
  const guysIn = groups.in.filter((e) => e.profile.gender !== 'F');

  const inList = (
    <div data-group="IN" className="space-y-3.5">
      {groups.in.length === 0 && <p className="text-sm font-medium text-zinc-500">{bare ? 'Nobody' : 'Nobody yet'}</p>}
      <Group label="Girls" group="Girls" entries={girlsIn} {...shared} />
      <Group label="Guys" group="Guys" entries={guysIn} {...shared} />
    </div>
  );
  if (bare) return <div className="px-5 pb-5 pt-2">{inList}</div>;

  const waiting = groups.maybe.length + groups.none.length + groups.subs.length;
  const away = groups.out.length + groups.unavailable.length;
  const hasGuest = everyone.some((e) => e.profile.guest);

  return (
    <section className={CARD}>
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Who's coming</h3>
      <Spots headcount={headcount} className="mt-3.5" />
      {!game.has_result && <Status game={game} headcount={headcount} />}
      {!game.has_result && !headcount.spots.volunteer && headcount.totalIn > 0 && <NoGoalie className="mt-2.5" />}

      <Tabs defaultValue="in" className="mt-4">
        <TabsList className="grid h-auto w-full grid-cols-3 rounded-full bg-zinc-100 p-1">
          <TabsTrigger value="in" className={TAB}>
            In {groups.in.length}
          </TabsTrigger>
          <TabsTrigger value="waiting" className={TAB}>
            Not in yet {waiting}
          </TabsTrigger>
          <TabsTrigger value="out" className={TAB}>
            Out {away}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="in" className="mt-4">
          {inList}
        </TabsContent>
        <TabsContent value="waiting" className="mt-4 space-y-3.5">
          {waiting === 0 && <p className="text-sm font-medium text-zinc-500">Everyone has answered</p>}
          <Group label="Maybe" group="MAYBE" entries={groups.maybe} {...shared} />
          <Group label="No reply" group="No reply" entries={groups.none} {...shared} />
          <Group label="Can sub" group="Subs" entries={groups.subs} {...shared} />
        </TabsContent>
        <TabsContent value="out" className="mt-4 space-y-3.5">
          {away === 0 && <p className="text-sm font-medium text-zinc-500">Nobody</p>}
          <Group label="Out" group="OUT" entries={groups.out} {...shared} />
          <Group label="Unavailable" group="Unavailable" entries={groups.unavailable} {...shared} />
        </TabsContent>
      </Tabs>

      {(hasGuest || onPick) && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[11px] font-semibold text-zinc-500">
          {hasGuest && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="box-border h-3 w-3 rounded-full border-2 border-dashed border-zinc-400" />
              Not on the site yet
            </span>
          )}
          {onPick && <span>Tap a name to answer for them</span>}
        </p>
      )}
    </section>
  );
}
