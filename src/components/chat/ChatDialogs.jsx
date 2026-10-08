import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';

const TITLE = 'font-display text-lg font-extrabold uppercase tracking-tight';

/** Start a thread (title plus an optional first message), or rename one. */
export function ThreadDialog({ open, onOpenChange, thread, onSave }) {
  const renaming = !!thread;
  const [title, setTitle] = useState('');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(thread?.title || '');
      setFirst('');
    }
    // Only when it opens, so a live update to the thread doesn't wipe what's typed.
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave({ title: title.trim(), first: first.trim() });
      onOpenChange(false);
    } catch {
      // onSave already said what went wrong; keep the dialog open to try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={TITLE}>{renaming ? 'Rename thread' : 'New thread'}</DialogTitle>
          {!renaming && (
            <p className="text-sm text-zinc-500">
              For side conversations, so Team Chat stays about the team. Everyone can see and join it.
            </p>
          )}
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="thread-title">Topic</Label>
            <Input
              id="thread-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="⚽ Sunday pickup"
              autoFocus
            />
            <p className="text-xs text-zinc-400">Tip: start with an emoji and it becomes the thread's icon.</p>
          </div>
          {!renaming && (
            <div className="space-y-2">
              <Label htmlFor="thread-first">First message (optional)</Label>
              <Textarea
                id="thread-first"
                rows={3}
                maxLength={2000}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="Kick it off…"
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? 'Saving…' : renaming ? 'Save' : 'Start thread'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Yes/no for removing a message or thread. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // onConfirm already said what went wrong.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className={TITLE}>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-600">{body}</p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
