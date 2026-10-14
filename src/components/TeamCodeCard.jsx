import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';
import { codeIsStale, randomCode } from '@/lib/team-code';
import { cn } from '@/lib/utils';

const pill = 'inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] transition disabled:opacity-50';

/** Captains: the team code new players enter after signing up, and changing it. */
export function TeamCodeCard({ meId, roster }) {
  const { toast } = useToast();
  // undefined: loading; null: none (before the database has team codes).
  const [row, setRow] = useState(undefined);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRow((await api.entities.TeamJoinCode.list())[0] || null);
    } catch {
      setRow(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!row) return null;

  const save = async (code) => {
    setBusy(true);
    try {
      await api.entities.TeamJoinCode.update(row.id, { code, updated_by: meId });
      await load();
      setDraft(null);
      toast({ title: 'Team code changed', description: 'Invites with the old code stop working. Copy invite has the new one.' });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await copyText(row.code);
    toast({ title: 'Team code copied' });
  };

  const typed = (draft || '').trim().toUpperCase();

  return (
    <section className={cn(CARD, 'space-y-3')} data-testid="team-code">
      <div>
        <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Team code</h2>
        <p className="mt-1 text-xs font-medium text-zinc-500">
          New players enter this after they sign up, before they can see anything. Copy invite on the Team page includes it.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-950 px-4 py-3">
        <span className="font-display text-2xl font-extrabold tracking-[0.3em] text-lime-400" data-testid="team-code-value">
          {row.code}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy the team code"
          className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      {codeIsStale(row, roster) && (
        <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900" data-testid="team-code-stale">
          Session {roster.current.session} has started since the code last changed. Change it so invites from before stop
          working.
        </p>
      )}
      {draft === null ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => save(randomCode())}
            className={cn(pill, 'bg-lime-400 text-black hover:bg-lime-300')}
          >
            New code
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft('')}
            className={cn(pill, 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')}
          >
            Choose my own
          </button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.length >= 4) save(typed);
          }}
        >
          <Label htmlFor="own-code">Your code (4 or more letters or numbers)</Label>
          <Input
            id="own-code"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^a-z0-9]/gi, ''))}
            maxLength={40}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            className="uppercase"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || typed.length < 4}>
              Save code
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
