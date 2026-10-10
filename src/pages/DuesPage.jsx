import { useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { MyDues } from '@/components/dues/MyDues';
import { TeamDues } from '@/components/dues/TeamDues';
import { useTeam } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';

const VIEWS = [
  { value: 'team', label: 'Team dues' },
  { value: 'mine', label: 'My dues' },
];

/** Players see what they owe and how to pay; captains also set the fee and track who has paid. */
export function DuesPage() {
  const { isCaptain, loading, settings, reload } = useTeam();
  const [view, setView] = useState('team');

  if (loading) return <PageSpinner />;
  const showTeam = isCaptain && view === 'team';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dues"
        subtitle={
          showTeam
            ? "Set the session fee, see who has paid, and nudge who hasn't."
            : 'What you owe this session and how to pay.'
        }
      />
      {isCaptain && (
        <div className="grid grid-cols-2 gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              aria-pressed={view === v.value}
              className={cn(
                'rounded-2xl border-2 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.06em] transition',
                view === v.value ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      {showTeam ? <TeamDues settings={settings} onSettingsSaved={reload} /> : <MyDues settings={settings} />}
    </div>
  );
}
