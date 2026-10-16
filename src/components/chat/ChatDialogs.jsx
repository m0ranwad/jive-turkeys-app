import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, LogOut, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { initials, shortName } from '@/lib/format';
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

// The same labels, buttons and badges as the Team and Dues popups.
const EYEBROW = 'text-[10px] font-black uppercase tracking-[0.14em]';
const FIELD_LABEL = 'text-xs font-semibold text-zinc-500';
const BIG_BUTTON = 'h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]';
const PILL = 'rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]';

/** Initials in a circle, colored like the Team page (women lime, men black). */
function Avatar({ person, small }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-extrabold uppercase',
        small ? 'h-9 w-9 text-[10px]' : 'h-10 w-10 text-xs',
        person.gender === 'F' ? 'bg-lime-400 text-black' : 'bg-zinc-900 text-lime-400',
      )}
    >
      {initials(person.name)}
    </span>
  );
}

/**
 * Teammates to tick: [{ id, name, gender, captain }]. A search box shows once
 * the list is long.
 */
function PeoplePicker({ people, picked, onToggle }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? people.filter((p) => p.name.toLocaleLowerCase().split(/\s+/).some((w) => w.startsWith(q))) : people;
  }, [people, query]);
  if (!people.length) {
    return <p className="rounded-2xl bg-zinc-50 px-3.5 py-3 text-sm text-zinc-500">Everyone on the site is already in it.</p>;
  }
  return (
    <div className="space-y-2">
      {people.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a teammate"
            aria-label="Find a teammate"
            autoComplete="off"
            className="h-11 rounded-xl pl-10"
          />
        </div>
      )}
      <div className="-mx-1 max-h-[38vh] space-y-1 overflow-y-auto px-1 py-0.5">
        {shown.map((p) => {
          const on = picked.has(p.id);
          return (
            <label
              key={p.id}
              className={cn(
                // relative: keeps the hidden checkbox inside its row (otherwise it stretches the window).
                'relative flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 transition',
                on ? 'bg-lime-100/70 ring-1 ring-lime-300' : 'hover:bg-zinc-50',
              )}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(p.id)} aria-label={p.name} />
              <Avatar person={p} small />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{p.name}</span>
              {p.captain && <span className={cn(PILL, 'bg-zinc-950 text-lime-400')}>Captain</span>}
              <span
                aria-hidden
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition',
                  on ? 'border-zinc-950 bg-zinc-950 text-lime-400' : 'border-zinc-200 bg-white',
                )}
              >
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
              </span>
            </label>
          );
        })}
        {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-zinc-400">Nobody by that name.</p>}
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

/** What the add button says: "Add Sam O." or "Add 3 people". */
const addLabel = (picked, people) => {
  if (!picked.size) return 'Pick who to add';
  if (picked.size > 1) return `Add ${picked.size} people`;
  const one = people.find((p) => picked.has(p.id));
  return `Add ${one ? shortName(one.name) : '1 person'}`;
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
      {/* No keyboard popping up over the list on phones. */}
      <DialogContent className={DIALOG} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>New private chat</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 flex items-start gap-2 text-sm text-zinc-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Only the teammates you pick can see it. Captains can't either, unless you add them.
        </p>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <span className={cn(EYEBROW, 'flex items-center justify-between text-zinc-400')}>
              With
              {picked.size > 0 && <span className="text-zinc-950">{picked.size} picked</span>}
            </span>
            <PeoplePicker people={people} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="private-title" className={FIELD_LABEL}>
              Name (optional)
            </Label>
            <Input
              id="private-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="🚗 Ride to Thursday's game"
              className="h-11 rounded-xl"
            />
            <p className="text-[11px] font-medium text-zinc-400">Leave it blank to name it after the people in it.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="private-first" className={FIELD_LABEL}>
              First message (optional)
            </Label>
            <Textarea
              id="private-first"
              rows={2}
              maxLength={2000}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="Say hi…"
              className="rounded-xl text-base"
            />
          </div>
          <Button type="submit" disabled={busy || !picked.size} className={BIG_BUTTON}>
            {busy ? 'Starting…' : 'Start chat'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who's in a private chat. Anyone in it can add teammates (not while it's
 * closed) or leave; its starter can take people out.
 * `members`: [{ id, user_id }] rows; `personOf(userId)`: { name, gender, captain };
 * `people`: everyone who could be added.
 */
export function PeopleDialog({ open, onOpenChange, thread, members, me, personOf, people, onAdd, onRemove, onLeave }) {
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
  const sorted = members
    .map((m) => ({ ...m, person: personOf(m.user_id) }))
    .sort((a, b) => (b.user_id === me) - (a.user_id === me) || a.person.name.localeCompare(b.person.name));

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
      <DialogContent className={DIALOG} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>People in this chat</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 flex items-center gap-2 text-sm text-zinc-500">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Only {members.length === 2 ? 'the two of you' : `these ${members.length} people`} can see it.
        </p>

        <ul aria-label="People in this chat" className="divide-y divide-zinc-100">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <Avatar person={m.person} />
              <div className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">{m.person.name}</span>
                {(m.user_id === me || m.user_id === thread.created_by || m.person.captain) && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {m.user_id === me && <span className={cn(PILL, 'bg-zinc-100 text-zinc-500')}>You</span>}
                    {m.user_id === thread.created_by && <span className={cn(PILL, 'bg-lime-400 text-black')}>Started it</span>}
                    {m.person.captain && <span className={cn(PILL, 'bg-zinc-950 text-lime-400')}>Captain</span>}
                  </span>
                )}
              </div>
              {starter && m.user_id !== me && (
                <button
                  type="button"
                  onClick={() => onRemove(m)}
                  aria-label={`Take ${m.person.name} out`}
                  className="shrink-0 rounded-full px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-red-700 underline-offset-2 transition hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {thread.archived ? (
          <p className="rounded-2xl bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-500">This chat is closed, so nobody can be added.</p>
        ) : adding ? (
          <div className="space-y-3 border-t border-zinc-100 pt-4">
            <span className={cn(EYEBROW, 'block text-zinc-400')}>Add people</span>
            <PeoplePicker people={addable} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
            {addable.length > 0 && (
              <>
                <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                  They'll see the whole chat, earlier messages included.
                </p>
                <Button onClick={add} disabled={busy || !picked.size} className={BIG_BUTTON}>
                  {busy ? 'Adding…' : addLabel(picked, addable)}
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="block w-full text-center text-xs font-bold uppercase tracking-[0.1em] text-zinc-400 transition hover:text-zinc-900"
            >
              Cancel
            </button>
          </div>
        ) : (
          <Button onClick={() => setAdding(true)} className={BIG_BUTTON}>
            <UserPlus /> Add people
          </Button>
        )}

        {!adding && (
          <div className="border-t border-zinc-100 pt-4">
            <button
              type="button"
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 underline-offset-2 hover:underline"
            >
              <LogOut className="h-3.5 w-3.5" /> Leave chat
            </button>
          </div>
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
