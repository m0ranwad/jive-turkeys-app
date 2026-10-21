import { seasonName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The season a game is filed under ("2026–27", saved as 2026): the ones either side of `around`, and `value` if it's further off. */
export function SeasonPicker({ value, around, onChange, className, buttonClassName = 'py-2.5 text-xs' }) {
  const seasons = [...new Set([around - 1, around, around + 1, Number(value)])].sort((a, b) => a - b);
  return (
    <div className={cn('grid gap-1.5', seasons.length > 3 ? 'grid-cols-4' : 'grid-cols-3', className)}>
      {seasons.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={Number(value) === s}
          onClick={() => onChange(s)}
          className={cn(
            'rounded-xl border-2 font-bold transition',
            buttonClassName,
            Number(value) === s
              ? 'border-black bg-lime-400 text-black'
              : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
          )}
        >
          {seasonName(s)}
        </button>
      ))}
    </div>
  );
}
