import { SESSIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function SessionPicker({ value, onChange, className, buttonClassName = 'py-2.5 text-xs' }) {
  return (
    <div className={cn('grid grid-cols-3 gap-1.5', className)}>
      {SESSIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            'rounded-xl border-2 font-bold transition',
            buttonClassName,
            Number(value) === s
              ? 'border-black bg-lime-400 text-black'
              : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
