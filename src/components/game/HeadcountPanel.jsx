import { ShortBanner } from '@/components/schedule/GameCard';
import { shortageIsUrgent } from '@/lib/calendar';
import { CARD } from '@/lib/constants';
import { fmtDateShort, fmtTime, jerseyText, mapsUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

function Group({ label, note, entries, suspendedIds, tone, onPick }) {
  return (
    <div data-group={label}>
      <div className="flex items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em]', tone)}>
          {label} · {entries.length}
        </span>
        {note && <span className="text-[11px] font-medium text-zinc-500">{note}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.length === 0 && <span className="text-xs font-medium text-zinc-500">Nobody yet</span>}
        {entries.map((entry) => {
          const Chip = onPick ? 'button' : 'span';
          return (
            <Chip
              key={entry.profile.user_id}
              data-player={entry.profile.display_name}
              {...(onPick && { type: 'button', onClick: () => onPick(entry.profile) })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
                entry.profile.gender === 'F'
                  ? 'border-lime-300 bg-lime-50 text-lime-900'
                  : entry.profile.guest
                    ? 'border-zinc-300 bg-zinc-50 text-zinc-500'
                    : 'border-zinc-200 bg-white text-zinc-700',
                // Joining and gender are separate: roster-only women stay green.
                entry.profile.guest && 'border-dashed',
                onPick && 'transition hover:border-zinc-900',
              )}
            >
              {/* Heard as "RSVP for Taylor Brooks GK": the name and tags on screen, in order. */}
              {onPick && <span className="sr-only">RSVP for </span>}
              {entry.profile.display_name}
              {entry.profile.gender === 'F' && <span className="sr-only">, woman</span>}
              {entry.profile.guest && <span className="sr-only">, not joined yet</span>}
              {entry.playing_gk && <span className="text-[11px] font-black uppercase text-zinc-500">GK</span>}
              {suspendedIds.includes(entry.profile.user_id) && (
                <span className="text-[11px] font-black uppercase text-red-600">Susp</span>
              )}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `onPick` (captains): tap a name to set that player's RSVP. How many more we need
 * follows Schedule: grey until 48 hours before kickoff, then red, and gone once
 * the game has a score.
 */
export function HeadcountPanel({ game, headcount, suspendedIds = [], settings, onPick = null }) {
  const tiles = [
    { label: 'IN', value: headcount.totalIn, tone: 'bg-lime-400 text-black' },
    { label: 'Women on field', value: `${headcount.womenFieldIn} of ${headcount.minWomen}`, tone: 'bg-zinc-950 text-lime-400' },
    { label: 'MAYBE', value: headcount.groups.maybe.length, tone: 'bg-amber-300 text-black' },
    { label: 'OUT', value: headcount.groups.out.length, tone: 'bg-zinc-100 text-zinc-600' },
    { label: 'No reply', value: headcount.groups.none.length, tone: 'bg-zinc-100 text-zinc-600' },
    { label: 'Men', value: headcount.totalIn - headcount.womenIn, tone: 'bg-zinc-100 text-zinc-600' },
  ];
  const showNeed = !game.has_result && headcount.isShort;

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Headcount</h3>
          <p className="mt-1 text-xs font-medium text-zinc-500">
            {fmtDateShort(game.date)} · {fmtTime(game.time)} · Field {game.field_number || 'TBD'} · {jerseyText(game.jersey, settings)}
          </p>
        </div>
        {showNeed && (
          <ShortBanner needTotal={headcount.needTotal} needWomen={headcount.needWomen} urgent={shortageIsUrgent(game)} />
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className={cn('rounded-2xl px-3 py-2.5', tile.tone)}>
            <div className="font-display text-xl font-extrabold leading-none">{tile.value}</div>
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em]">{tile.label}</div>
          </div>
        ))}
      </div>
      {showNeed && (
        <p className="mt-3 text-xs font-medium text-zinc-500">
          We need at least {headcount.minPlayers} players, with {headcount.minWomen} women on the field (a woman in goal
          doesn't count).
        </p>
      )}
      {onPick && (
        <p className="mt-3 text-xs font-medium text-zinc-500">
          Tap a name to set their RSVP, for teammates who told you another way or haven't joined the site (dashed outline).
        </p>
      )}
      <div className="mt-4 space-y-4">
        <Group label="IN" entries={headcount.groups.in} suspendedIds={suspendedIds} tone="bg-lime-400 text-black" onPick={onPick} />
        <Group label="MAYBE" entries={headcount.groups.maybe} suspendedIds={suspendedIds} tone="bg-amber-300 text-black" onPick={onPick} />
        <Group label="OUT" entries={headcount.groups.out} suspendedIds={suspendedIds} tone="bg-zinc-200 text-zinc-600" onPick={onPick} />
        <Group label="No reply" entries={headcount.groups.none} suspendedIds={suspendedIds} tone="bg-zinc-900 text-white" onPick={onPick} />
        {headcount.groups.subs.length > 0 && (
          <Group
            label="Subs"
            note="Available to sub, no reply"
            entries={headcount.groups.subs}
            suspendedIds={suspendedIds}
            tone="bg-zinc-100 text-zinc-600"
            onPick={onPick}
          />
        )}
        {headcount.groups.unavailable.length > 0 && (
          <Group label="Unavailable" note="No sub requests" entries={headcount.groups.unavailable} suspendedIds={suspendedIds} tone="bg-zinc-100 text-zinc-600" onPick={onPick} />
        )}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-zinc-500">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-6 shrink-0 rounded-full border border-lime-300 bg-lime-50" />
          Green = women
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-6 shrink-0 rounded-full border border-dashed border-zinc-300 bg-zinc-50" />
          Dashed = not joined
        </span>
      </p>
      {game.location && (
        <a
          href={mapsUrl(game.location)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-between rounded-2xl bg-zinc-50 px-3.5 py-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100"
        >
          <span className="truncate">{game.location}</span>
          <span className="ml-3 shrink-0 font-bold uppercase tracking-[0.1em] text-zinc-900">Directions</span>
        </a>
      )}
    </section>
  );
}
