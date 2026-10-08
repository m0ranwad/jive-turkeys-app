import { ShortBanner } from '@/components/schedule/GameCard';
import { CARD } from '@/lib/constants';
import { fmtDateShort, fmtTime, jerseyText, mapsUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

function Group({ label, entries, suspendedIds, tone }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]', tone)}>
          {label} · {entries.length}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.length === 0 && <span className="text-xs font-medium text-zinc-400">Nobody yet</span>}
        {entries.map((entry) => (
          <span
            key={entry.profile.user_id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
              entry.profile.gender === 'F' ? 'border-lime-300 bg-lime-50 text-lime-900' : 'border-zinc-200 bg-white text-zinc-700',
            )}
          >
            {entry.profile.display_name}
            {entry.playing_gk && <span className="text-[9px] font-black uppercase text-zinc-500">GK</span>}
            {suspendedIds.includes(entry.profile.user_id) && (
              <span className="text-[9px] font-black uppercase text-red-600">Susp</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HeadcountPanel({ game, headcount, suspendedIds = [], settings }) {
  const tiles = [
    { label: 'IN', value: headcount.totalIn, tone: 'bg-lime-400 text-black' },
    { label: 'Women field', value: `${headcount.womenFieldIn}/${headcount.minWomen}`, tone: 'bg-zinc-950 text-lime-400' },
    { label: 'MAYBE', value: headcount.groups.maybe.length, tone: 'bg-amber-300 text-black' },
    { label: 'OUT', value: headcount.groups.out.length, tone: 'bg-zinc-100 text-zinc-500' },
    { label: 'No reply', value: headcount.groups.none.length, tone: 'bg-zinc-100 text-zinc-500' },
    { label: 'Men', value: headcount.totalIn - headcount.womenIn, tone: 'bg-zinc-100 text-zinc-500' },
  ];
  const shortParts = [
    headcount.needTotal ? `${headcount.needTotal} player${headcount.needTotal === 1 ? '' : 's'}` : null,
    headcount.needWomen ? `${headcount.needWomen} wom${headcount.needWomen === 1 ? 'an' : 'en'}` : null,
  ].filter(Boolean);

  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Headcount</h3>
          <p className="mt-1 text-xs font-medium text-zinc-500">
            {fmtDateShort(game.date)} · {fmtTime(game.time)} · Field {game.field_number || 'TBD'} · {jerseyText(game.jersey, settings)}
          </p>
        </div>
        <ShortBanner needTotal={headcount.needTotal} needWomen={headcount.needWomen} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className={cn('rounded-2xl px-3 py-2.5', tile.tone)}>
            <div className="font-display text-xl font-extrabold leading-none">{tile.value}</div>
            <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{tile.label}</div>
          </div>
        ))}
      </div>
      {headcount.isShort && (
        <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
          Short on {shortParts.join(' and ')} (min {headcount.minPlayers} players, {headcount.minWomen} women on the field).
        </p>
      )}
      <div className="mt-4 space-y-4">
        <Group label="IN" entries={headcount.groups.in} suspendedIds={suspendedIds} tone="bg-lime-400 text-black" />
        <Group label="MAYBE" entries={headcount.groups.maybe} suspendedIds={suspendedIds} tone="bg-amber-300 text-black" />
        <Group label="OUT" entries={headcount.groups.out} suspendedIds={suspendedIds} tone="bg-zinc-200 text-zinc-600" />
        <Group label="No reply" entries={headcount.groups.none} suspendedIds={suspendedIds} tone="bg-zinc-900 text-white" />
      </div>
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
