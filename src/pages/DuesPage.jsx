import { useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { MyDues } from '@/components/dues/MyDues';
import { TeamDues } from '@/components/dues/TeamDues';
import { useTeam } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';

const VIEWS = [
  { value: 'mine', label: 'My dues' },
  { value: 'team', label: 'Team dues' },
];

/** What you owe and how to pay, and the whole team's dues. Anyone can mark players paid; captains set the fee. */
export function DuesPage() {
  const { user, isCaptain, loading, settings, reload } = useTeam();
  const [picked, setPicked] = useState(null);

  if (loading) return <PageSpinner />;
  // Captains usually come here to collect, players to pay.
  const view = picked ?? (isCaptain ? 'team' : 'mine');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dues"
        subtitle={view === 'team' ? "Who has paid and who hasn't. Anyone can mark players paid." : 'What you owe this session and how to pay.'}
      />
      <div className="grid grid-cols-2 gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setPicked(v.value)}
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
      {view === 'team' ? (
        <TeamDues isCaptain={isCaptain} settings={settings} onSettingsSaved={reload} />
      ) : (
        <MyDues user={user} settings={settings} />
      )}
    </div>
  );
}
