import { useMemo, useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { LegacyTab, OpponentsTab, PlayersTab, StandingsTab } from '@/components/stats/StatsTabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSeasonData } from '@/hooks/useSeasonData';
import { SESSIONS } from '@/lib/constants';

const TAB_CLASS = 'text-[11px] font-bold uppercase tracking-[0.08em]';

export function StatsPage() {
  const data = useSeasonData();
  const [yearFilter, setYearFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const years = useMemo(
    () => [...new Set((data.games || []).map((g) => g.season_year))].sort((a, b) => b - a),
    [data.games],
  );

  if (data.loading) return <PageSpinner />;

  const year = yearFilter === 'all' ? 'all' : Number(yearFilter);
  const session = sessionFilter === 'all' ? 'all' : Number(sessionFilter);
  const shared = { games: data.games || [], stats: data.stats || [], profiles: data.profiles || [], votes: data.votes || [] };

  return (
    <div className="space-y-5">
      <PageHeader title="Stats" subtitle="Results, leaders, and our record against everyone." />
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(yearFilter)} onValueChange={setYearFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All seasons</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(sessionFilter)} onValueChange={setSessionFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sessions</SelectItem>
            {SESSIONS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Session {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs defaultValue="standings">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="standings" className={TAB_CLASS}>
            Standings
          </TabsTrigger>
          <TabsTrigger value="players" className={TAB_CLASS}>
            Players
          </TabsTrigger>
          <TabsTrigger value="opponents" className={TAB_CLASS}>
            Opponents
          </TabsTrigger>
          <TabsTrigger value="legacy" className={TAB_CLASS}>
            Legacy
          </TabsTrigger>
        </TabsList>
        <TabsContent value="standings" className="mt-4">
          <StandingsTab games={shared.games} year={year} session={session} />
        </TabsContent>
        <TabsContent value="players" className="mt-4">
          <PlayersTab {...shared} year={year} session={session} />
        </TabsContent>
        <TabsContent value="opponents" className="mt-4">
          <OpponentsTab games={shared.games} year={year} session={session} />
        </TabsContent>
        <TabsContent value="legacy" className="mt-4">
          <LegacyTab {...shared} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
