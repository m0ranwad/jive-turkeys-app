import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { copyText } from '@/lib/clipboard';
import { CARD } from '@/lib/constants';

export function AnnouncementsPage() {
  const { user, profile, isCaptain, loading } = useTeam();
  const { toast } = useToast();
  const [posts, setPosts] = useState(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPosts(await api.entities.Announcement.list('-created_date'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async () => {
    if (!draft.title.trim() || !draft.body.trim()) return;
    setBusy(true);
    try {
      await api.entities.Announcement.create({
        title: draft.title.trim(),
        body: draft.body.trim(),
        author_name: profile?.display_name || user?.full_name || 'Captain',
      });
      setComposing(false);
      setDraft({ title: '', body: '' });
      await load();
      toast({ title: 'Announcement posted' });
    } catch (err) {
      toast({ title: "That didn't post", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (a) => {
    await copyText(`🦃 ${a.title}\n\n${a.body}`);
    toast({ title: 'Copied', description: 'Paste it into the team group text.' });
  };

  if (loading || !posts) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <PageHeader title="Announcements" subtitle="Team news from the captains.">
        {isCaptain && (
          <button
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-lime-400 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-lime-300"
          >
            <Plus className="h-3.5 w-3.5" /> New post
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        {posts.map((a) => (
          <article key={a.id} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-lg font-extrabold uppercase leading-tight tracking-tight">{a.title}</h2>
              <button
                onClick={() => copy(a)}
                aria-label="Copy announcement"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">{a.body}</p>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
              {a.author_name || 'Captain'} · {a.created_date ? a.created_date.slice(0, 10) : ''}
            </p>
          </article>
        ))}
        {posts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            No announcements yet.
          </div>
        )}
      </div>

      <Dialog open={composing} onOpenChange={setComposing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">New announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                rows={6}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="What's the news?"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setComposing(false)}>
              Cancel
            </Button>
            <Button onClick={post} disabled={busy || !draft.title.trim() || !draft.body.trim()}>
              {busy ? 'Posting…' : 'Post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
