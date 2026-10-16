import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const TITLE = 'font-display text-lg font-extrabold uppercase tracking-tight';

/** Start a thread (title plus an optional first message), or rename one (or a private chat). */
export function ThreadDialog({ open, onOpenChange, thread, onSave }) {
  const renaming = !!thread;
  const chat = thread?.visibility === 'private';
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
          <DialogTitle className={TITLE}>{renaming ? (chat ? 'Rename chat' : 'Rename thread') : 'New thread'}</DialogTitle>
          {!renaming && (
            <p className="text-sm text-zinc-500">
              For side conversations, so Team Chat stays about the team. Everyone can see and join it.
            </p>
          )}
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="thread-title">{chat ? 'Name' : 'Topic'}</Label>
            <Input
              id="thread-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="⚽ Sunday pickup"
              autoFocus
            />
            <p className="text-xs text-zinc-400">Tip: start with an emoji and it becomes the {chat ? "chat's" : "thread's"} icon.</p>
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

/**
 * Teammates to tick: [{ id, name }]. A search box shows once the list is long.
 */
function PeoplePicker({ people, picked, onToggle }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? people.filter((p) => p.name.toLocaleLowerCase().split(/\s+/).some((w) => w.startsWith(q))) : people;
  }, [people, query]);
  if (!people.length) {
    return <p className="rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">Everyone on the site is already in it.</p>;
  }
  return (
    <div className="space-y-2">
      {people.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a teammate"
            aria-label="Find a teammate"
            className="pl-9"
          />
        </div>
      )}
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-black/5 p-1.5">
        {shown.map((p) => {
          const on = picked.has(p.id);
          return (
            <label
              key={p.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold transition',
                on ? 'bg-lime-100/70 text-zinc-950' : 'text-zinc-700 hover:bg-zinc-50',
              )}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(p.id)} aria-label={p.name} />
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-900 font-display text-[10px] font-extrabold uppercase text-lime-400">
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span
                aria-hidden
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                  on ? 'border-zinc-950 bg-zinc-950 text-lime-400' : 'border-zinc-300',
                )}
              >
                {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
              </span>
            </label>
          );
        })}
        {shown.length === 0 && <p className="px-2.5 py-2 text-sm text-zinc-400">Nobody by that name.</p>}
      </div>
    </div>
  );
}

const toggle = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * Start a private chat: pick teammates, optionally name it (otherwise it's
 * everyone's names), optionally say something. `preselected`: the teammate
 * whose Message button brought you here.
 */
export function PrivateChatDialog({ open, onOpenChange, people, preselected, onSave }) {
  const [title, setTitle] = useState('');
  const [first, setFirst] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setFirst('');
      setPicked(new Set(preselected ? [preselected] : []));
    }
    // Only when it opens, so the roster updating doesn't wipe what's picked.
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    if (!picked.size) return;
    setBusy(true);
    try {
      await onSave({ title: title.trim(), userIds: [...picked], first: first.trim() });
      onOpenChange(false);
    } catch {
      // onSave already said what went wrong; keep the dialog open to try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={TITLE}>New private chat</DialogTitle>
          <p className="flex items-start gap-2 text-left text-sm text-zinc-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Only the teammates you pick can see it. Captains can't either, unless you add them.
          </p>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label>
              With {picked.size > 0 && <span className="text-zinc-400">({picked.size})</span>}
            </Label>
            <PeoplePicker people={people} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="private-title">Name (optional)</Label>
            <Input
              id="private-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="🚗 Ride to Thursday's game"
            />
            <p className="text-xs text-zinc-400">Leave it blank to name it after the people in it.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="private-first">First message (optional)</Label>
            <Textarea
              id="private-first"
              rows={2}
              maxLength={2000}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="Say hi…"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !picked.size}>
              {busy ? 'Starting…' : 'Start chat'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who's in a private chat. Anyone in it can add teammates (not while it's
 * closed); its starter can take people out.
 * `members`: [{ id, user_id }] rows; `people`: everyone who could be added.
 */
export function PeopleDialog({ open, onOpenChange, thread, members, me, nameOf, people, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAdding(false);
      setPicked(new Set());
    }
  }, [open]);

  if (!thread) return null;
  const starter = thread.created_by === me;
  const inIt = new Set(members.map((m) => m.user_id));
  const addable = people.filter((p) => !inIt.has(p.id));
  const sorted = [...members].sort(
    (a, b) => (b.user_id === me) - (a.user_id === me) || nameOf(a.user_id).localeCompare(nameOf(b.user_id)),
  );

  const add = async () => {
    setBusy(true);
    try {
      await onAdd([...picked]);
      setAdding(false);
      setPicked(new Set());
    } catch {
      // onAdd already said what went wrong.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={TITLE}>People in this chat</DialogTitle>
          <p className="text-left text-sm text-zinc-500">Only they can see it.</p>
        </DialogHeader>
        <ul className="space-y-1" aria-label="People in this chat">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-900 font-display text-[10px] font-extrabold uppercase text-lime-400">
                {initials(nameOf(m.user_id))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {nameOf(m.user_id)}
                {m.user_id === me && <span className="ml-1.5 text-xs font-medium text-zinc-400">You</span>}
                {m.user_id === thread.created_by && <span className="ml-1.5 text-xs font-medium text-zinc-400">Started it</span>}
              </span>
              {starter && m.user_id !== me && (
                <button
                  onClick={() => onRemove(m)}
                  aria-label={`Take ${nameOf(m.user_id)} out`}
                  className="rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-red-700 underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {thread.archived ? (
          <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-xs font-medium text-zinc-500">This chat is closed, so nobody can be added.</p>
        ) : adding ? (
          <div className="space-y-3 border-t border-zinc-100 pt-4">
            <PeoplePicker people={addable} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
            <p className="text-xs text-zinc-500">They'll see the whole chat, earlier messages included.</p>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button onClick={add} disabled={busy || !picked.size}>
                {busy ? 'Adding…' : 'Add'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)} className="w-full gap-2">
            <UserPlus className="h-4 w-4" /> Add people
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Yes/no for removing a message or thread. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, busyLabel = 'Deleting…', onConfirm }) {
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
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
