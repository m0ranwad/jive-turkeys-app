import { Copy, UserPlus } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';

const gameLink = (game) => `${window.location.origin}/games/${game.id}`;
const women = (n) => (n === 1 ? 'woman' : 'women');

/** Copies an RSVP nudge for the team group text. */
export function CopyReminderButton({ game, headcount, settings }) {
  const { toast } = useToast();

  const copy = async () => {
    const pending = headcount.groups.none.map((e) => e.profile.display_name);
    const lines = [
      `🦃 Jive Turkeys — ${fmtDateShort(game.date)} at ${fmtTime(game.time)}`,
      `vs ${game.opponent} · Field ${game.field_number || 'TBD'}`,
      `Jersey: ${jerseyText(game.jersey, settings)}`,
      `Still to RSVP: ${pending.length ? pending.join(', ') : "everyone's in"}`,
    ];
    if (headcount.needTotal || headcount.needWomen) {
      const needs = [];
      if (headcount.needTotal) needs.push(`Need ${headcount.needTotal} more`);
      if (headcount.needWomen) needs.push(`${headcount.needWomen} more ${women(headcount.needWomen)}`);
      lines.push(`${needs.join(' / ')}. Subs, tap IN if you can play.`);
    }
    lines.push(`RSVP: ${gameLink(game)}`);
    await copyText(lines.join('\n'));
    toast({ title: 'Reminder copied', description: 'Paste it into the team group text.' });
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/20"
    >
      <Copy className="h-3.5 w-3.5" />
      Copy reminder
    </button>
  );
}

/** Copies a call-up message naming the sub pool (and players on break). */
export function CallForSubsButton({ game, settings, profiles, rsvps }) {
  const { toast } = useToast();

  const copy = async () => {
    const gameRsvps = (rsvps || []).filter((r) => r.game_id === game.id);
    const inIds = new Set(gameRsvps.filter((r) => r.status === 'in').map((r) => r.user_id));
    const available = (profiles || []).filter(
      (p) => (p.status === 'sub_pool' || p.status === 'on_break') && !inIds.has(p.user_id),
    );
    const subPool = available.filter((p) => p.status === 'sub_pool').map((p) => p.display_name);
    const onBreak = available.filter((p) => p.status === 'on_break').map((p) => p.display_name);

    const lines = [
      `🦃 Jive Turkeys — subs needed for ${fmtDateShort(game.date)} · ${fmtTime(game.time)}`,
      `vs ${game.opponent} · Field ${game.field_number || 'TBD'} · Jersey: ${jerseyText(game.jersey, settings)}`,
    ];
    if (subPool.length) lines.push(`Sub Pool (first call): ${subPool.join(', ')}`);
    if (onBreak.length) lines.push(`On break (if you can play): ${onBreak.join(', ')}`);
    if (!subPool.length && !onBreak.length) lines.push('Everyone in the sub pool is already in ✅');

    const minPlayers = Number(settings?.min_players ?? 8);
    const minWomen = Number(settings?.min_women ?? 3);
    const totalIn = inIds.size;
    const womenFieldIn = (profiles || []).filter((p) => {
      const r = gameRsvps.find((x) => x.user_id === p.user_id);
      return r?.status === 'in' && p.gender === 'F' && !r.playing_gk;
    }).length;
    const needs = [];
    if (totalIn < minPlayers) needs.push(`${minPlayers - totalIn} more`);
    if (womenFieldIn < minWomen) needs.push(`${minWomen - womenFieldIn} more ${women(minWomen - womenFieldIn)}`);
    if (needs.length) lines.push(`Need ${needs.join(' / ')}. Tap IN if you can play.`);
    lines.push(`RSVP: ${gameLink(game)}`);

    await copyText(lines.join('\n'));
    toast({ title: 'Sub call copied', description: 'Paste it into the team group text.' });
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/20"
    >
      <UserPlus className="h-3.5 w-3.5" />
      Call for subs
    </button>
  );
}
