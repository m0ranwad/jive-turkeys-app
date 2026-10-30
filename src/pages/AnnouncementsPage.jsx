import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Copy, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api';
import { ConfirmDialog } from '@/components/chat/ChatDialogs';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { PostToChatDialog } from '@/components/PostToChatDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { ANNOUNCEMENTS_READ_EVENT, newestPostAt } from '@/lib/announcements';
import { copyText } from '@/lib/clipboard';
import { CARD, DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { saveFailedToast } from '@/lib/errors';
import { cn } from '@/lib/utils';

const EMPTY = { title: '', body: '' };

export function AnnouncementsPage() {
  const { user, profile, isCaptain, loading } = useTeam();
  const { toast } = useToast();
  const [posts, setPosts] = useState(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  // The post a captain is fixing: { post, title, body }. A new post's draft is kept apart, so it's still there after.
  const [editing, setEditing] = useState(null);
  // The post whose Edit / Delete options are open, and the one waiting on "Delete?".
  const [options, setOptions] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // The announcement a captain is posting in Team Chat (offered right after a new one, too).
  const [sharing, setSharing] = useState(null);
  const shareMessage = useCallback(() => (sharing ? `📣 ${sharing.title}\n\n${sharing.body}` : ''), [sharing]);

  const form = editing || draft;
  const setForm = (next) => (editing ? setEditing({ ...editing, ...next }) : setDraft({ ...draft, ...next }));
  const filled = !!form.title.trim() && !!form.body.trim();
  const unchanged = !!editing && form.title.trim() === editing.post.title && form.body.trim() === editing.post.body;

  const load = useCallback(async () => {
    const rows = await api.entities.Announcement.list('-created_date');
    setPosts(rows);
    // Opening Announcements (and posting one) marks them read, so the menu's badge goes.
    const newest = newestPostAt(rows);
    if (newest) {
      api.announcements
        .markRead(newest)
        .then(() => window.dispatchEvent(new Event(ANNOUNCEMENTS_READ_EVENT)))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeForm = () => {
    setComposing(false);
    setEditing(null);
  };

  const save = async () => {
    if (!filled || unchanged) return;
    const title = form.title.trim();
    const body = form.body.trim();
    setBusy(true);
    let created = null;
    try {
      if (editing) {
        await api.entities.Announcement.update(editing.post.id, { title, body });
      } else {
        created = await api.entities.Announcement.create({
          title,
          body,
          author_name: profile?.display_name || user?.full_name || 'Captain',
        });
      }
    } catch (err) {
      // What was typed stays in the window to try again.
      toast(saveFailedToast(err));
      setBusy(false);
      return;
    }
    if (created) setDraft(EMPTY);
    closeForm();
    setBusy(false);
    toast({ title: created ? 'Announcement posted' : 'Announcement saved' });
    await load().catch(() => {});
    if (created) setSharing(created);
  };

  const remove = async () => {
    try {
      await api.entities.Announcement.delete(deleting.id);
    } catch (err) {
      toast(saveFailedToast(err));
      throw err;
    }
    toast({ title: 'Announcement deleted' });
    await load().catch(() => {});
  };

  const copy = async (a) => {
    await copyText(`🦃 ${a.title}\n\n${a.body}`);
    toast({ title: 'Copied' });
  };

  if (loading || !posts) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <PageHeader title="Announcements">
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
              {isCaptain ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => setSharing(a)}
                    aria-label="Post in Team Chat"
                    title="Post in Team Chat"
                    className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setOptions(a)}
                    aria-label="Announcement options"
                    title="Edit or delete"
                    className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => copy(a)}
                  aria-label="Copy announcement"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
                >
                  <Copy className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">{a.body}</p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              {a.author_name || 'Captain'} · {a.created_date ? dayjs(a.created_date).format('MMM D, YYYY') : ''}
              {a.edited_date && ' · Edited'}
            </p>
          </article>
        ))}
        {posts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            No announcements yet.
          </div>
        )}
      </div>

      <PostToChatDialog
        open={!!sharing}
        onOpenChange={(open) => !open && setSharing(null)}
        title="Post in Team Chat?"
        intro="So everyone sees it where they already are. @team buzzes everyone with notifications on."
        message={shareMessage}
        everyone
      />

      <Dialog open={!!options} onOpenChange={(open) => !open && setOptions(null)}>
        <DialogContent className={cn(DIALOG, 'sm:max-w-sm')} onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader className="text-left">
            <DialogTitle className={DIALOG_TITLE}>Announcement options</DialogTitle>
          </DialogHeader>
          <p className="truncate text-sm font-semibold text-zinc-600">{options?.title}</p>
          <div className="space-y-1">
            <OptionButton
              icon={Pencil}
              label="Edit"
              onClick={() => {
                setEditing({ post: options, title: options.title, body: options.body });
                setOptions(null);
              }}
            />
            <OptionButton
              icon={Trash2}
              label="Delete"
              danger
              onClick={() => {
                setDeleting(options);
                setOptions(null);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete announcement?"
        body={`"${deleting?.title || ''}" is removed for everyone. This can't be undone. If it was posted in Team Chat, that message stays.`}
        confirmLabel="Delete"
        onConfirm={remove}
      />

      <Dialog open={composing || !!editing} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">
              {editing ? 'Edit announcement' : 'New announcement'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input id="announcement-title" value={form.title} onChange={(e) => setForm({ title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="announcement-body">Message</Label>
              <Textarea
                id="announcement-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ body: e.target.value })}
                placeholder="What's the news?"
              />
            </div>
            {editing && <p className="text-xs text-zinc-500">Fixing a post doesn't notify anyone or show it as new again.</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !filled || unchanged}>
              {editing ? (busy ? 'Saving…' : 'Save') : busy ? 'Posting…' : 'Post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OptionButton({ icon: Icon, label, danger, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-sm font-semibold transition hover:bg-zinc-50',
        danger ? 'text-red-600' : 'text-zinc-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
