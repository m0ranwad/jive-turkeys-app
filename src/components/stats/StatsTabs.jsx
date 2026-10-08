import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ResultBadge } from '@/components/schedule/GameCard';
import { CARD } from '@/lib/constants';
import { seasonLabel } from '@/lib/format';
import { careerStats, filterGames, leaderboard, record, recordVsOpponents, resultOf } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const sectionTitle = 'font-display text-sm font-extrabold uppercase tracking-[0.12em]';

function RecordRow({ label, record: r, highlight }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-2xl px-3.5 py-3',
        highlight ? 'bg-zinc-950 text-white' : 'bg-zinc-50',
      )}
    >
      <span className="truncate font-display text-sm font-extrabold uppercase tracking-tight">{label}</span>
      <span className="w-20 text-center text-xs font-bold">
        {r.w}-{r.l}-{r.d}
      </span>
      <span className={cn('w-16 text-center text-xs font-semibold', highlight ? 'text-white/60' : 'text-zinc-500')}>{r.gf} GF</span>
      <span className={cn('w-16 text-center text-xs font-semibold', highlight ? 'text-white/60' : 'text-zinc-500')}>{r.ga} GA</span>
    </div>
  );
}

export function StandingsTab({ games, year, session }) {
  const overall = record(filterGames(games, year, session));
  const years = [...new Set(games.map((g) => g.season_year))].sort((a, b) => b - a);
  const sessions = [...new Set(games.map((g) => `${g.season_year}-${g.session}`))]
    .map((key) => {
      const [y, s] = key.split('-').map(Number);
      return { y, s, record: record(games.filter((g) => g.season_year === y && g.session === s)) };
    })
    .sort((a, b) => b.y - a.y || b.s - a.s);

  const title =
    session === 'all'
      ? year === 'all'
        ? `All-time record (as of ${new Date().getFullYear()})`
        : `${year} season`
      : seasonLabel(year, session);

  return (
    <div className="space-y-5">
      <section className={CARD}>
        <h3 className={sectionTitle}>{title}</h3>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            { l: 'Won', v: overall.w, tone: 'bg-lime-400 text-black' },
            { l: 'Lost', v: overall.l, tone: 'bg-zinc-950 text-white' },
            { l: 'Draw', v: overall.d, tone: 'bg-zinc-100 text-zinc-600' },
            { l: 'Goals', v: `${overall.gf}-${overall.ga}`, tone: 'bg-zinc-100 text-zinc-600' },
          ].map((tile) => (
            <div key={tile.l} className={cn('rounded-2xl px-3 py-3', tile.tone)}>
              <div className="font-display text-xl font-extrabold leading-none">{tile.v}</div>
              <div className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{tile.l}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs font-semibold text-zinc-500">
          {overall.played} game{overall.played === 1 ? '' : 's'} played
        </p>
      </section>

      {session === 'all' && (
        <section className={CARD}>
          <h3 className={sectionTitle}>By season</h3>
          <div className="mt-3 space-y-2">
            {years.map((y) => (
              <RecordRow key={y} label={`${y}`} record={record(games.filter((g) => g.season_year === y))} />
            ))}
            {years.length === 0 && <p className="text-sm text-zinc-400">No results yet.</p>}
          </div>
        </section>
      )}

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h3 className={sectionTitle}>By session</h3>
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400">W-L-D · GF · GA</span>
        </div>
        <div className="mt-3 space-y-2">
          {sessions.map((s) => (
            <RecordRow
              key={`${s.y}-${s.s}`}
              label={seasonLabel(s.y, s.s)}
              record={s.record}
              highlight={s.y === year && s.s === session}
            />
          ))}
          {sessions.length === 0 && <p className="text-sm text-zinc-400">No results yet.</p>}
        </div>
      </section>
    </div>
  );
}

const LEADER_SORTS = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'games', label: 'Games' },
  { key: 'awards', label: 'Awards' },
];

export function PlayersTab({ games, stats, profiles, votes, year, session }) {
  const [sortKey, setSortKey] = useState('goals');
  const rows = leaderboard({ games, stats, profiles, votes, year, session })
    .filter((r) => r.games > 0 || r.goals > 0 || r.assists > 0)
    .sort(
      (a, b) =>
        b[sortKey] - a[sortKey] || b.goals - a.goals || a.profile.display_name.localeCompare(b.profile.display_name),
    );

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitle}>Player leaderboard</h3>
        <div className="flex gap-1">
          {LEADER_SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSortKey(s.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] transition',
                sortKey === s.key ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 px-1 pb-2 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">
        <span>Player</span>
        <span className="w-8 text-center">GP</span>
        <span className="w-8 text-center">G</span>
        <span className="w-8 text-center">A</span>
        <span className="w-10 text-center">POTM</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((r) => (
          <div key={r.profile.user_id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', r.profile.gender === 'F' ? 'bg-lime-400' : 'bg-zinc-900')} />
              <span className="truncate text-sm font-semibold">{r.profile.display_name}</span>
            </span>
            <span className="w-8 text-center text-sm font-bold">{r.games}</span>
            <span className="w-8 text-center text-sm font-bold">{r.goals}</span>
            <span className="w-8 text-center text-sm font-bold">{r.assists}</span>
            <span className="w-10 text-center text-sm font-bold">
              {r.awards > 0 ? (
                <span className="rounded-full bg-lime-400 px-2 py-0.5 text-black">{r.awards}</span>
              ) : (
                <span className="text-zinc-300">0</span>
              )}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="py-3 text-sm text-zinc-400">No stats recorded for this filter yet.</p>}
      </div>
    </section>
  );
}

export function OpponentsTab({ games, year, session }) {
  const [open, setOpen] = useState(null);
  const rows = recordVsOpponents(filterGames(games, year, session));

  return (
    <section className="space-y-3">
      {rows.length === 0 && (
        <div className={cn(CARD, 'p-5 text-sm text-zinc-400')}>No results recorded for this filter yet.</div>
      )}
      {rows.map((row) => {
        const expanded = open === row.opponent;
        return (
          <div key={row.opponent} className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <button
              onClick={() => setOpen(expanded ? null : row.opponent)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-extrabold uppercase tracking-tight">{row.opponent}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-zinc-500">
                  {row.w}-{row.l}-{row.d} · {row.gf} GF, {row.ga} GA
                </span>
              </span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-zinc-400 transition', expanded && 'rotate-180')} />
            </button>
            {expanded && (
              <div className="border-t border-zinc-100">
                {row.played.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                      {g.season_year} S{g.session}
                    </span>
                    <span className="flex-1 text-xs font-medium text-zinc-500">{g.date}</span>
                    <span className="font-display text-sm font-extrabold">
                      {g.score_us ?? 0}–{g.score_them ?? 0}
                    </span>
                    <ResultBadge result={g.result || resultOf(g)} className="h-6 w-6 rounded-lg text-[10px]" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

const LEGACY_CATEGORIES = [
  { key: 'games', label: 'Games played' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'awards', label: 'Player of the Match' },
];

export function LegacyTab({ games, stats, profiles, votes }) {
  const [open, setOpen] = useState(null);
  const careers = careerStats({ games, stats, profiles, votes }).filter((c) => c.totals.games > 0);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-zinc-950 p-4 text-white">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.18em] text-lime-400">Jive Turkeys Legacy</h3>
        <p className="mt-1 text-xs font-medium text-white/60">All-time leaders, every season on record.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {LEGACY_CATEGORIES.map((cat) => {
            const top = careers
              .map((c) => ({ name: c.profile.display_name, value: c.totals[cat.key] }))
              .filter((x) => x.value > 0)
              .sort((a, b) => b.value - a.value)
              .slice(0, 3);
            return (
              <div key={cat.key} className="rounded-2xl bg-white/5 p-3.5">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">{cat.label}</span>
                <div className="mt-2 space-y-1">
                  {top.length === 0 && <span className="text-xs text-white/40">—</span>}
                  {top.map((x, i) => (
                    <div key={x.name} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'grid h-6 w-6 place-items-center rounded-lg font-display text-[10px] font-black',
                          i === 0 ? 'bg-lime-400 text-black' : 'bg-white/10 text-white/70',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate text-sm font-semibold">{x.name}</span>
                      <span className="ml-auto font-display text-sm font-extrabold">{x.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        {careers.map((c) => {
          const expanded = open === c.profile.user_id;
          return (
            <div key={c.profile.user_id} className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <button
                onClick={() => setOpen(expanded ? null : c.profile.user_id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-display text-base font-extrabold uppercase tracking-tight">
                      {c.profile.display_name}
                    </span>
                    {c.profile.year_joined && (
                      <span className="rounded-full bg-lime-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-lime-800">
                        Since {c.profile.year_joined}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-semibold text-zinc-500">
                    {c.totals.games} GP · {c.totals.goals} G · {c.totals.assists} A · {c.totals.awards} POTM
                  </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-zinc-400 transition', expanded && 'rotate-180')} />
              </button>
              {expanded && (
                <div className="border-t border-zinc-100 px-4 py-3">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 pb-2 text-[9px] font-black uppercase tracking-[0.1em] text-zinc-400">
                    <span>Session</span>
                    <span className="w-7 text-center">GP</span>
                    <span className="w-7 text-center">G</span>
                    <span className="w-7 text-center">A</span>
                    <span className="w-7 text-center">Bl</span>
                    <span className="w-7 text-center">Rd</span>
                    <span className="w-7" />
                  </div>
                  {c.sessions.map((s) => (
                    <div
                      key={`${s.year}-${s.session}`}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] items-center gap-2 border-t border-zinc-50 py-2 text-sm"
                    >
                      <span className="truncate text-xs font-bold uppercase tracking-[0.06em] text-zinc-500">
                        {s.year} · S{s.session}
                      </span>
                      <span className="w-7 text-center font-semibold">{s.games}</span>
                      <span className="w-7 text-center font-semibold">{s.goals}</span>
                      <span className="w-7 text-center font-semibold">{s.assists}</span>
                      <span className="w-7 text-center font-semibold text-sky-700">{s.blue || 0}</span>
                      <span className="w-7 text-center font-semibold text-red-600">{s.red || 0}</span>
                      <span className="w-7" />
                    </div>
                  ))}
                  {c.sessions.length === 0 && <p className="py-2 text-xs text-zinc-400">No sessions recorded.</p>}
                </div>
              )}
            </div>
          );
        })}
        {careers.length === 0 && (
          <div className={cn(CARD, 'p-5 text-sm text-zinc-400')}>Career stats appear once game results are entered.</div>
        )}
      </section>
    </div>
  );
}
