import { CARD } from '@/lib/constants';
import { cn } from '@/lib/utils';

const LINES = [
  { key: 'Forward', top: '11%', label: 'Forwards' },
  { key: 'Mid-Field', top: '37%', label: 'Mid-field' },
  { key: 'Defense', top: '65%', label: 'Defense' },
  { key: 'Goalie', top: '90%', label: 'Goalie' },
];

function PlayerChip({ player }) {
  return (
    <span className="inline-flex max-w-[46%] items-center gap-1.5 rounded-full bg-white/95 px-2 py-1 shadow-sm">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', player.gender === 'F' ? 'bg-lime-500' : 'bg-zinc-900')} />
      <span className="truncate text-[10px] font-bold text-zinc-800">{player.display_name}</span>
    </span>
  );
}

/** Pitch diagram with everyone at their preferred position. */
export function Formation({ players = [] }) {
  const floaters = players.filter((p) => !p.position);
  const placed = players.filter((p) => p.position);
  const line = 'absolute border-white/20';

  return (
    <section className={cn(CARD, 'overflow-hidden')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">On the field</h3>
          <p className="mt-1 text-xs font-medium text-zinc-500">Where everyone likes to play.</p>
        </div>
        <span className="shrink-0 rounded-full bg-lime-400 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-black">
          {placed.length} placed
        </span>
      </div>
      <div className="relative mt-3 aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#123c22] sm:aspect-[16/11]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(163,230,53,0.14),transparent_60%)]" />
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/20" />
        <div className={cn(line, 'left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border')} />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" />
        <div className={cn(line, 'left-1/2 top-0 h-[14%] w-[52%] -translate-x-1/2 border border-t-0')} />
        <div className={cn(line, 'bottom-0 left-1/2 h-[14%] w-[52%] -translate-x-1/2 border border-b-0')} />
        <div className={cn(line, 'left-1/2 top-0 h-[5%] w-[26%] -translate-x-1/2 border border-t-0')} />
        <div className={cn(line, 'bottom-0 left-1/2 h-[5%] w-[26%] -translate-x-1/2 border border-b-0')} />
        {LINES.map((l) => {
          const here = players.filter((p) => p.position === l.key);
          return (
            <div
              key={l.key}
              className="absolute left-0 right-0 flex flex-wrap items-center justify-center gap-1.5 px-3"
              style={{ top: l.top, transform: 'translateY(-50%)' }}
            >
              {here.length === 0 ? (
                <span className="rounded-full border border-dashed border-white/25 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
                  {l.label}
                </span>
              ) : (
                here.map((p) => <PlayerChip key={p.id} player={p} />)
              )}
            </div>
          );
        })}
      </div>
      {floaters.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
            Floaters · none chosen · {floaters.length}
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {floaters.map((p) => (
              <span
                key={p.id}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold',
                  p.gender === 'F' ? 'border-lime-300 bg-lime-50 text-lime-900' : 'border-zinc-200 text-zinc-700',
                )}
              >
                {p.display_name}
              </span>
            ))}
          </div>
        </div>
      )}
      {players.length === 0 && (
        <p className="mt-3 text-xs font-medium text-zinc-400">Teammates show up here once they set a position.</p>
      )}
    </section>
  );
}
